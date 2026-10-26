<script lang="ts">
	import { T, useStage, useTask, useThrelte } from '@threlte/core';
	import { readTraversal } from '../mechanics/avatar.ts';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Group, PerspectiveCamera, Ray, Vector3 } from 'three';
	import { testing } from './testing.ts';
	import { golden } from './golden.ts';
	import type { LifeFrame, LivingWorld } from '../life/index.ts';
	import { lighting } from '../render/stylized.ts';
	import { LIGHT } from '../style/palette.ts';
	import { ATLAS_SOURCE } from '../avatar/catalog.ts';
	import type { Soundscape } from '../audio/soundscape.ts';
	import type { AvatarProfile } from '../data/local-save.ts';
	import type { GameBridge } from '../../abi.ts';
	import { AvatarAnimator, createAvatarInput, readCharacter } from '../animation/avatar-animator.ts';
	import { AVATAR_LAYOUT, BLOCKY_RIG } from '../animation/joints.ts';
	import { applyToRig, bindRig, type RigBinding } from '../animation/rig.ts';
	import { applyCameraPose } from '../engine/camera.ts';
	import { placeObject } from '../engine/character.ts';
	import { CAMERA_FOV, CAMERA_NEAR } from '../engine/constants.ts';
	import type { PlayerController } from '../engine/controller.ts';
	import type { SceneEnvironment } from './environment.ts';
	import { attachInput, type InputModel } from '../engine/input.ts';
	import {
		DprGovernor,
		FrameBudget,
		QUALITY,
		ShadowRig,
		applyFog,
		createHemisphere,
		debugSnapshot,
		collectTextures,
		textureBytes,
		dprLimit,
		fogSettings,
		lodProfilesFor,
		pickQuality,
		readCapabilities,
		watchContextLoss,
		type Quality
	} from '../render/index.ts';
	import { loadAvatar, type AvatarInstance } from './avatar.ts';
	import { AvatarWiring } from './avatar-wiring.ts';

	import { horizontalFov, verticalFov } from './projection.ts';
	import type { GameDebug, HudState } from './types.ts';
	import type { LoadingProgress } from '../ui/loading/loading.ts';

	let {
		wrapper,
		controller,
		input,
		environment,
		avatarProfile,
		bridge,
		onHud,
		onFrame,
		paused,
		sound,
		loading
	}: {
		wrapper: HTMLElement;
		controller: PlayerController;
		input: InputModel;
		environment: SceneEnvironment;
		avatarProfile: AvatarProfile;
		bridge: GameBridge;
		onHud: (state: HudState) => void;
		onFrame: () => void;
		paused: boolean;
		/** The game's sounds; owned (created and disposed) by Root. */
		sound?: Soundscape;
		/** Loading screen progress (ui/loading): every load below is tracked, then `ready()` once drawn. */
		loading?: LoadingProgress;
	} = $props();
	const { renderer, scene, dpr, mainStage, renderStage, invalidate } = useThrelte();
	const context = renderer.getContext();
	const choice = pickQuality(
		readCapabilities(
			context instanceof WebGL2RenderingContext ? context : null,
			navigator,
			matchMedia('(pointer: coarse)').matches
		),
		{ mobileMedium: false }
	);
	let quality: Quality = testing ? 'low' : golden.enabled ? golden.tier : choice.quality;
	let simulationTime = 0;
	let goldenReady = false;
	let goldenFrames = 0;
	let goldenPlaced = false;
	let visualTime = 0;
	const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, fogSettings(quality).far);
	const visual = new Group();
	const proxies = untrack(() => environment.createVisual());
	const actor = new Group();
	visual.add(proxies.object, actor, createHemisphere(golden.enabled && golden.night ? 'night' : 'daylight'));
	lighting.uHemisphereSky.value.set(
		golden.enabled && golden.night ? LIGHT.night.hemisphereSky : LIGHT.daylight.hemisphereSky
	);
	lighting.uHemisphereGround.value.set(
		golden.enabled && golden.night ? LIGHT.night.hemisphereGround : LIGHT.daylight.hemisphereGround
	);
	const shadows = new ShadowRig(renderer, { blobs: 48 });
	if (golden.enabled && golden.night) shadows.setVariant('night');
	visual.add(shadows.object);
	shadows.addReceiver(proxies.object);
	shadows.addCaster(proxies.object, 'static');
	const avatarBlob = shadows.blobs.add('actor');
	const grid = untrack(() => environment.grid);
	let storyAssets: Awaited<ReturnType<NonNullable<SceneEnvironment['loadStoryAssets']>>> | undefined;
	let life: LivingWorld | undefined;
	let lifeRevision = -1;
	const lifeFrame: LifeFrame = {
		dt: 0,
		camera,
		time: 0,
		reducedMotion: false,
		playerPosition: untrack(() => controller.character.position),
		playerVelocity: untrack(() => controller.character.velocity)
	};
	let forest: Awaited<ReturnType<SceneEnvironment['loadPlacements']>> | undefined;
	const budget = new FrameBudget(renderer, { quality });
	const preset = QUALITY[quality];
	const governor = new DprGovernor({ start: preset.dprStart, max: preset.dprMax });
	const lens = { fov: CAMERA_FOV, aspect: 1, near: CAMERA_NEAR };
	const canopyHead = new Vector3();
	const shadowRay = new Ray(new Vector3(), new Vector3(0, -1, 0));
	const animator = new AvatarAnimator();
	const animationInput = createAvatarInput();
	const avatarWiring = new AvatarWiring(
		animator,
		untrack(() => environment.story)
	);
	let rig: RigBinding | undefined;
	let avatarInstance: AvatarInstance | undefined;
	let appearanceGeneration = 0;
	let currentProfile: AvatarProfile | undefined;
	export async function setAvatarProfile(profile: AvatarProfile) {
		if (!avatarInstance) throw new Error('avatar-not-ready');
		const generation = ++appearanceGeneration;
		await avatarInstance.appearance.apply(profile);
		if (generation === appearanceGeneration) {
			currentProfile = profile;
			animator.hairStyle = profile.style === 'classic' ? (profile.hairStyle ?? 'curto') : null;
			invalidate();
		}
	}
	let ready = $state(false);
	let hidden = $state(document.hidden);
	let contextLost = $state(false);
	let loadError = '';
	let notice = 'Siga em frente e explore. Arraste à direita para olhar.';
	let lastHud = 0;
	let splashUntil = 0;
	let lastYaw = 0;
	$effect(() => {
		if (paused) input.releaseAll();
		controller.resume();
		budget.reset();
		governor.reset();
	});
	const debug = golden.enabled || new URLSearchParams(location.search).has('debug');
	const motion = matchMedia('(prefers-reduced-motion: reduce)');
	function fit() {
		if (golden.enabled) {
			dpr.set(1);
			return;
		}
		const preset = QUALITY[quality];
		governor.setLimit(
			Math.min(
				preset.dprMax,
				dprLimit(wrapper.clientWidth, wrapper.clientHeight, devicePixelRatio, preset.maxPixels)
			)
		);
		dpr.set(governor.dpr);
	}
	function setQuality(next: Quality) {
		quality = next;
		budget.quality = next;
		applyFog(scene, camera, fogSettings(next));
		// The CSS sky is a gradient whose horizon matches the fog. Do not replace it with a flat clear colour.
		scene.background = null;
		shadows.setTier(next, scene);
		if (golden.enabled && golden.lineup) {
			scene.fog = null;
			camera.far = 120;
			camera.updateProjectionMatrix();
		}
		if (golden.enabled && golden.night) {
			if (scene.fog) scene.fog.color.set(LIGHT.night.horizon);
			lighting.uHemisphereSky.value.set(LIGHT.night.hemisphereSky);
			lighting.uHemisphereGround.value.set(LIGHT.night.hemisphereGround);
		}
		life?.setQuality(next);
		if (forest?.setQuality) forest.setQuality(next);
		else if (forest) for (const pool of forest.pools.pools.values()) pool.lod = lodProfilesFor(next).tree;
		governor.reset();
		budget.reset();
		fit();
	}
	const readDebug = (): GameDebug => {
		const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
		return {
			...debugSnapshot(),
			...(debug && new URLSearchParams(location.search).has('textureDebug') ? { textureBreakdown: [...collectTextures(scene), ...(proxies.textures??[]), ...(lighting.uShadeMap.value?[lighting.uShadeMap.value]:[])].map(texture=>({name:texture.name,width:texture.image?.width??0,height:texture.image?.height??0,bytes:textureBytes([texture])})) } : {}),
			streaming: environment.streaming?.debug(),
			goldenReady,
			visualTime,
			textureBytes: (() => {
				const textures = collectTextures(scene);
				if (lighting.uShadeMap.value) textures.add(lighting.uShadeMap.value);
				for (const texture of proxies.textures ?? []) textures.add(texture);
				return textureBytes(textures);
			})(),
			worldKind: environment.kind,
			testing,
			simulationTime,
			life: life?.debug(),
			cameraYaw: controller.camera.yaw,
			storyProgress:
				environment.story?.level.missions
					.filter((m) => m.id >= 1 && m.id <= 6)
					.map((m) => environment.story?.progress(m.id)) ?? [],
			park: environment.park
				? {
						mode: environment.park.traversal.mode,
						house: environment.story?.completed(0) ?? false,
						ziplineUnlocked: environment.story?.completed(6) ?? false,
						photoCount: environment.park.photo.validCount
					}
				: undefined,
			storyFinished: environment.story?.finished ?? false,
			ready: ready && (!environment.streaming || environment.streaming.ready),
			verticalFov: camera.fov,
			horizontalFov: horizontalFov(camera.fov, camera.aspect),
			...(memory ? { heapMB: memory.usedJSHeapSize / 1048576 } : {}),
			x: controller.frame.position.x,
			y: controller.frame.position.y,
			z: controller.frame.position.z,
			grounded: controller.frame.grounded,
			checkpoint: controller.checkpoints?.current.id ?? 'start',
			animation: animator.state,
			avatarContext: {
				surface: animationInput.surface ?? 'ground',
				slope: animationInput.slope ?? 0,
				edgeAhead: animationInput.edgeAhead ?? Infinity,
				talking: animationInput.talking,
				look: animationInput.lookTarget ? { ...animationInput.lookTarget } : null,
				gesture: animator.states.emote,
				lastGesture: avatarWiring.lastGesture,
				hairPitch: animator.hair.pitch,
				hairRoll: animator.hair.roll,
				hairAppliedPitch: avatarInstance?.hair?.dangles.find((d) => d.visible)?.rotation.x ?? 0
			},
			avatarStyle: currentProfile?.style ?? avatarProfile.style,
			avatarHair: currentProfile?.hairStyle ?? avatarProfile.hairStyle ?? 'curto',
			avatarSkin: currentProfile?.kenneySkin ?? avatarProfile.kenneySkin,
			avatarTextureVersion: avatarInstance?.appearance.texture.version ?? 0,
			avatarAtlasSource: ATLAS_SOURCE,
			proxyDraws: proxies.object.children.length,
			floraDraws: forest?.pools.drawCalls ?? 0,
			geometryLods: forest?.stats?.(),
			cameraMode: controller.camera.mode,
			cameraDistance: controller.frame.pose.distance,
			canopiesFading: forest?.canopies?.fading ?? 0,
			floraInstances: environment.placements,
			qualityReason: golden.enabled ? 'golden-forced' : choice.reason,
			shadowRenders: shadows.renders,
			fogNear: fogSettings(quality).near,
			fogFar: camera.far,
			...(sound ? { audio: { state: sound.audio.state, voices: sound.audio.voices, ...sound.timing() } } : {})
		};
	};
	onMount(() => {
		if (environment.story) environment.story.onGesture = avatarWiring.enqueue;
		const abort = new AbortController();
		setQuality(quality);
		environment.streaming?.relocate(controller.character.position);
		const detach = attachInput(wrapper, input, {
			wantsPointerLock: () => input.shiftLock || controller.camera.firstPerson
		});
		wrapper.focus({ preventScroll: true });
		const reset = () => {
			controller.resume();
			governor.reset();
			budget.reset();
			fit();
		};
		const resize = new ResizeObserver(reset);
		resize.observe(wrapper);
		document.addEventListener(
			'visibilitychange',
			() => {
				hidden = document.hidden;
				reset();
			},
			{ signal: abort.signal }
		);
		const stopLoss = watchContextLoss(
			renderer.domElement,
			{
				lost() {
					contextLost = true;
					input.releaseAll();
					notice = 'Recarregando gráficos…';
				},
				restored() {
					shadows.invalidate();
					reset();
					contextLost = false;
					notice = 'Os gráficos estão prontos.';
					invalidate();
				},
				failed() {
					bridge.exit();
				}
			},
			{ signal: abort.signal }
		);
		if (debug) globalThis.__gameDebug = readDebug;
		if (golden.enabled)
			globalThis.__gameGoldenMask = (hide) => {
				proxies.setBackgroundVisible?.(!hide);
				invalidate();
			};
		const loads = [
			environment.loadStoryAssets?.(abort.signal).then((value) => {
				if (abort.signal.aborted) {
					value.dispose();
					return;
				}
				storyAssets = value;
				visual.add(value.object);
				shadows.addCaster(value.object, 'static');
				shadows.addReceiver(value.object);
			}),
			loadAvatar(abort.signal, avatarProfile).then((instance) => {
				if (abort.signal.aborted) {
					instance.dispose();
					return;
				}
				avatarInstance = instance;
				const model = instance.model;
				currentProfile = avatarProfile;
				animator.hairStyle = avatarProfile.style === 'classic' ? (avatarProfile.hairStyle ?? 'curto') : null;
				rig = bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG);
				actor.add(model);
				shadows.addCaster(actor, 'actor');
				shadows.addReceiver(actor);
			}),
			sound?.preloadEssential(abort.signal),
			environment
				.loadLife?.(quality, abort.signal, shadows.blobs, (event) => {
					sound?.audio.play('howler', { x: event.x, y: event.y, z: event.z, gain: event.chorus ? 1.1 : 1 });
				})
				.then((value) => {
					if (abort.signal.aborted) {
						value.dispose();
						return;
					}
					life = value;
					environment.park?.setLife(value);
					avatarWiring.setLife(value);
					visual.add(value.object3d);
					if (golden.enabled && golden.lifeScenario)
						value.onStory({
							completed: (id) => id === 1 || (golden.lifeScenario === 'butterflies' && id === 4),
							progress: (id) => (id === 4 && golden.lifeScenario === 'butterflies' ? 6 : 0)
						});
					else if (environment.story) value.onStory(environment.story);
				}),
			Promise.all([
				proxies.load?.(abort.signal),
				environment.loadPlacements(quality, abort.signal).then((value) => {
					if (abort.signal.aborted) {
						value.dispose();
						return;
					}
					forest = value;
					if (!golden.enabled) controller.camera.extraOcclusion = value.canopies?.occlusion;
					visual.add(value.pools.object);
					shadows.addCaster(value.pools.object, 'static');
					shadows.addReceiver(value.pools.object);
				})
			])
		];
		// Loading screen stages, in the order of `loads`, with their share of the bar.
		const stages = [
			['story', 2],
			['avatar', 1],
			['sound', 1],
			['life', 2],
			['placements', 3]
		] as const;
		loading?.reserve('compile', 2);
		for (const [index, [id, weight]] of stages.entries()) loading?.track(id, loads[index], weight);
		void Promise.all(loads)
			.then(async () => {
				if (abort.signal.aborted) return;
				if (golden.enabled) {
					placeGolden();
					visualTime = golden.time;
					animationInput.x = controller.character.position.x;
					animationInput.y = controller.character.position.y;
					animationInput.z = controller.character.position.z;
					animationInput.yaw = golden.avatar?.[2] ?? initialYaw();
					animationInput.grounded = true;
					animationInput.reducedMotion = motion.matches;
					environment.avatarGround?.update(animationInput, {
						position: controller.character.position,
						previousPosition: controller.character.previousPosition,
						groundNormal: controller.character.groundNormal,
						grounded: true
					});
					for (let i = 0; i < Math.round(golden.time * 60); i++) {
						avatarWiring.update(animationInput, 1 / 60);
						applyAvatarPose(1 / 60);
						storyAssets?.update(1 / 60);
						lifeFrame.dt = 1 / 60;
						lifeFrame.time = (i + 1) / 60;
						lifeFrame.reducedMotion = motion.matches;
						life?.update(lifeFrame);
					}
				}
				const compiled = renderer.compileAsync(scene, camera);
				loading?.track('compile', compiled, 2);
				await compiled;
				if (!abort.signal.aborted) {
					ready = true;
					loading?.ready();
					invalidate();
					void sound?.startNature(abort.signal);
				}
			})
			.catch((error: unknown) => {
				if (!abort.signal.aborted) {
					loading?.fail(error);
					loadError = 'Não foi possível abrir a clareira. Saia e tente novamente.';
					onHud({ notice: loadError, shiftLock: false, ready: false, debug: debug ? readDebug() : null });
				}
			});
		return () => {
			avatarWiring.dispose();
			abort.abort();
			detach();
			resize.disconnect();
			stopLoss();
			if (globalThis.__gameDebug === readDebug) {
				delete globalThis.__gameDebug;
				delete globalThis.__gameGoldenMask;
			}
		};
	});
	function applyAvatarPose(delta: number) {
		if (rig) applyToRig(animator.update(delta, animationInput), rig);
		const hair = avatarInstance?.hair;
		if (hair)
			for (const dangle of hair.dangles)
				if (dangle.visible) dangle.rotation.set(animator.hair.pitch, 0, animator.hair.roll, 'YXZ');
	}
	function animateAvatar(delta: number, intent = 0) {
		readCharacter(animationInput, controller.character, delta);
		animationInput.jumped = controller.frame.jumped;
		animationInput.yaw = controller.frame.yaw;
		animationInput.intent = intent;
		animationInput.reducedMotion = motion.matches;
		animationInput.talking = environment.story?.dialogue?.speaker.includes('Iara') ?? false;
		if (paused) animationInput.speed = 0;
		environment.avatarGround?.update(animationInput, controller.character);
		if (environment.park) readTraversal(animationInput, environment.park.traversal);
		avatarWiring.update(animationInput, delta);
		applyAvatarPose(delta);
	}
	function present(p: { x: number; y: number; z: number }) {
		proxies.update?.(p.x, p.y, p.z, environment.target);
		shadowRay.origin.set(p.x, p.y + 0.1, p.z);
		const hit = controller.world.raycast(shadowRay, 12);
		if (hit === null) shadows.blobs.hide(avatarBlob);
		else shadows.blobs.set(avatarBlob, p.x, shadowRay.origin.y - hit, p.z, 0.68, Math.max(0, hit - 0.1));
	}
	function updateLife(delta: number, grounded: boolean, jumped: boolean) {
		if (life) {
			const story = environment.story;
			if (story && story.revision !== lifeRevision) {
				lifeRevision = story.revision;
				life.onStory(story);
			}
			lifeFrame.dt = delta;
			lifeFrame.time = visualTime;
			lifeFrame.reducedMotion = motion.matches;
			lifeFrame.playerGrounded = grounded;
			lifeFrame.playerJumped = jumped;
			lifeFrame.light =
				environment.streaming?.light(visualTime) ?? (golden.enabled && golden.night ? 'night' : 'day');
			life.update(lifeFrame);
		}
	}
	function placeGolden() {
		if (goldenPlaced) return;
		const p = controller.character.position;
		placeObject(actor, p, golden.avatar?.[2] ?? controller.frame.yaw);
		actor.visible = true;
		const c = golden.lineup ? [35, 15, 60, 35, 5, 20, 70] : golden.camera;
		if (c) {
			camera.position.set(c[0], c[1], c[2]);
			camera.lookAt(c[3], c[4], c[5]);
			camera.fov = c[6] ?? 70;
			camera.updateProjectionMatrix();
		} else {
			let frame = controller.frame;
			for (let i = 0; i < 60; i++) frame = controller.update(1 / 60, input.sample(0), lens);
			placeObject(actor, frame.position, frame.yaw);
			applyCameraPose(camera, frame.pose);
		}
		camera.updateMatrixWorld(true);
		goldenPlaced = true;
	}
	const initialYaw = () => controller.frame.yaw;
	const budgetStage = useStage(Symbol('game-budget'), { before: mainStage });
	useTask(
		(delta) => {
			budget.beginFrame(performance.now());
			if (!golden.enabled && governor.sample(delta * 1000)) dpr.set(governor.dpr);
			if (!golden.enabled && governor.saturated >= 3 && quality !== 'low') {
				setQuality(quality === 'high' ? 'medium' : 'low');
				void renderer.compileAsync(scene, camera);
			}
		},
		{
			stage: budgetStage,
			autoInvalidate: false,
			running: () => ready && !hidden && (!paused || !!environment.story?.dialogue) && !contextLost
		}
	);
	useTask(
		(delta) => {
			if (
				environment.streaming &&
				!environment.streaming.update(controller.character.position, controller.character.yaw)
			) {
				controller.resume();
				return;
			}
			if (golden.enabled) {
				placeGolden();
				present(controller.character.position);
				return;
			}
			visualTime += delta;
			if (paused) {
				storyAssets?.update(delta);
				updateLife(delta, controller.frame.grounded, false);
				animateAvatar(delta);
				return;
			}
			const frameInput = input.sample(delta);
			const park = environment.park;
			const photographing = park?.photo.phase === 'framing';
			const shutter = photographing && frameInput.actionPressed;
			if (photographing) frameInput.actionPressed = false;
			const parkAction = park?.context(controller.character.position);
			lens.aspect = camera.aspect;
			const fov = verticalFov(camera.aspect);
			if (camera.fov !== fov) {
				camera.fov = fov;
				camera.updateProjectionMatrix();
			}
			lens.fov = fov;
			const frame = controller.update(delta, frameInput, lens);
			simulationTime += frame.ticks / 60;
			placeObject(actor, frame.position, frame.yaw);
			applyCameraPose(camera, frame.pose);
			if (photographing) camera.position.copy(frame.pose.focus);
			if (park?.traversal.mode === 'zipline') {
				// P26 pulley at uniform 0.7 scale puts its handle at the P28 hand height.
				actor.position.x -= Math.sin(frame.yaw) * 0.389;
				actor.position.z -= Math.cos(frame.yaw) * 0.389;
			}
			if (photographing) park?.evaluate(camera);
			if (shutter) park?.shutter();
			canopyHead.set(frame.position.x, frame.position.y + controller.camera.focusHeight, frame.position.z);
			forest?.canopies?.update(camera.position, canopyHead, delta, motion.matches);
			actor.visible = !photographing && frame.pose.avatarOpacity > 0.05;
			updateLife(delta, frame.grounded, frame.jumped);
			if (frameInput.emotePressed)
				notice = animator.playEmote('wave') ? 'Um aceno para a floresta.' : 'Pare um instante para acenar.';
			animateAvatar(delta, Math.hypot(frameInput.moveX, frameInput.moveY));
			if (
				frame.speed > 0.01 ||
				!frame.grounded ||
				frame.jumped ||
				frame.landed ||
				animator.state === 'emote' ||
				Math.abs(frame.yaw - lastYaw) > 0.001
			)
				shadows.markMoved();
			lastYaw = frame.yaw;
			for (const event of frame.events) {
				if (event.type === 'fell') {
					splashUntil = performance.now() + 450;
					notice = 'Água funda ou queda. Voltando ao ponto seguro…';
				}
				if (event.type === 'respawn') {
					animator.reset();
					notice = 'Você voltou ao último ponto seguro.';
				}
				if (event.type === 'checkpoint') {
					if (environment.kind === 'graybox' && event.checkpoint.id === 'summit') {
						bridge.earnBadge();
						notice = 'Você chegou! Seu emblema ficou guardado neste celular.';
					} else
						notice =
							environment.kind === 'map'
								? 'Você alcançou um ponto seguro.'
								: 'Ponto seguro alcançado. Pule perto da borda para atravessar.';
				}
			}
			sound?.update(delta, camera, frame, animator.footstep, animator.states.runWeight);
			environment.story?.visit(controller.character.position, frame.grounded);
			if (frameInput.actionPressed && !parkAction && (!park || park.traversal.mode === 'walk')) {
				if (environment.story) environment.story.act(controller.character.position);
				else environment.nextTarget();
				notice = environment.target.name;
			}
			storyAssets?.update(delta);
			present(controller.frame.position);
			onFrame();
		},
		{ running: () => ready && !hidden && (!paused || !!environment.story?.dialogue) && !contextLost }
	);
	const cullStage = useStage(Symbol('game-cull'), { after: mainStage, before: renderStage });
	useTask(
		() => {
			lighting.uSunSpots.value = motion.matches ? 0 : 1;
			lighting.uGameEye.value.copy(camera.position);
			proxies.prepareFrame?.(
				camera,
				motion.matches ? 0 : visualTime,
				quality,
				(golden.enabled && golden.night) || environment.streaming?.light(visualTime) === 'night'
			);
			grid.update(camera);
			shadows.blobs.sync();
			const p = controller.frame.position;
			if (environment.park) {
				environment.park.eye.x = camera.position.x;
				environment.park.eye.y = camera.position.y;
				environment.park.eye.z = camera.position.z;
				storyAssets?.update(0);
			}
			shadows.update(p.x, p.y, p.z);
		},
		{ stage: cullStage, autoInvalidate: false, running: () => ready && !hidden && !contextLost }
	);
	const hudStage = useStage(Symbol('game-hud'), { after: renderStage });
	useTask(
		() => {
			if (environment.park?.pendingCapture)
				environment.park.capture({
					source: renderer.domElement,
					width: renderer.domElement.width,
					height: renderer.domElement.height,
					background: [LIGHT.daylight.skyTop, LIGHT.daylight.horizon]
				});
			if (golden.enabled && ready && ++goldenFrames >= 2) goldenReady = true;
			if (performance.now() - lastHud < 250) return;
			lastHud = performance.now();
			onHud({
				notice: loadError || notice,
				shiftLock: input.shiftLock,
				ready,
				target: environment.target.name,
				distance: Math.round(
					Math.hypot(
						environment.target.x - controller.frame.position.x,
						environment.target.z - controller.frame.position.z
					) * 0.47
				),
				splash: performance.now() < splashUntil,
				debug: debug ? readDebug() : null
			});
		},
		{ stage: hudStage, autoInvalidate: false }
	);
	onDestroy(() => {
		life?.dispose();
		storyAssets?.dispose();
		controller.camera.extraOcclusion = undefined;
		forest?.dispose();
		appearanceGeneration++;
		avatarInstance?.dispose();
		proxies.dispose();
		shadows.dispose();
		budget.dispose();
		visual.clear();
	});
</script>

<T is={camera} makeDefault />
<T is={visual} dispose={false} />
