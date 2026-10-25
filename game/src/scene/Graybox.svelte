<script lang="ts">
	import { T, useStage, useTask, useThrelte } from '@threlte/core';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Group, PerspectiveCamera, Ray, Vector3 } from 'three';
	import type { GameBridge } from '../../abi.ts';
	import { AvatarAnimator, createAvatarInput, readCharacter } from '../animation/avatar-animator.ts';
	import { AVATAR_LAYOUT, BLOCKY_RIG } from '../animation/joints.ts';
	import { applyToRig, bindRig, type RigBinding } from '../animation/rig.ts';
	import { applyCameraPose } from '../engine/camera.ts';
	import { placeObject } from '../engine/character.ts';
	import { CAMERA_FOV, CAMERA_NEAR } from '../engine/constants.ts';
	import type { PlayerController } from '../engine/controller.ts';
	import type { Graybox } from '../engine/graybox.ts';
	import { attachInput, type InputModel } from '../engine/input.ts';
	import {
		BlockGrid,
		DprGovernor,
		FrameBudget,
		QUALITY,
		ShadowRig,
		applyFog,
		createHemisphere,
		debugSnapshot,
		dprLimit,
		fogSettings,
		lodProfilesFor,
		pickQuality,
		readCapabilities,
		watchContextLoss,
		type PlacementArrays,
		type Quality
	} from '../render/index.ts';
	import { disposeModel, loadAvatar } from './avatar.ts';
	import { loadForest } from './forest.ts';
	import type { ForestKind } from './forest-layout.ts';
	import { createGrayboxVisual } from './graybox-visual.ts';
	import { horizontalFov, verticalFov } from './projection.ts';
	import type { GameDebug, HudState } from './types.ts';

	let {
		wrapper,
		controller,
		input,
		level,
		forestPlacements,
		bridge,
		onHud,
		onFrame,
		paused
	}: {
		wrapper: HTMLElement;
		controller: PlayerController;
		input: InputModel;
		level: Graybox;
		forestPlacements: PlacementArrays<ForestKind>;
		bridge: GameBridge;
		onHud: (state: HudState) => void;
		onFrame: () => void;
		paused: boolean;
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
	let quality: Quality = choice.quality;
	const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, fogSettings(quality).far);
	const visual = new Group();
	const proxies = untrack(() => createGrayboxVisual(level));
	const actor = new Group();
	visual.add(proxies.object, actor, createHemisphere());
	const shadows = new ShadowRig(renderer, { blobs: 48 });
	visual.add(shadows.object);
	shadows.addReceiver(proxies.object);
	shadows.addCaster(proxies.object, 'static');
	const avatarBlob = shadows.blobs.add('actor');
	const grid = BlockGrid.covering(-40, -30, 40, 80);
	let forest: Awaited<ReturnType<typeof loadForest>> | undefined;
	const budget = new FrameBudget(renderer, { quality });
	const preset = QUALITY[quality];
	const governor = new DprGovernor({ start: preset.dprStart, max: preset.dprMax });
	const lens = { fov: CAMERA_FOV, aspect: 1, near: CAMERA_NEAR };
	const shadowRay = new Ray(new Vector3(), new Vector3(0, -1, 0));
	const animator = new AvatarAnimator();
	const animationInput = createAvatarInput();
	let rig: RigBinding | undefined;
	let avatar: Group | undefined;
	let ready = $state(false);
	let hidden = $state(document.hidden);
	let contextLost = $state(false);
	let loadError = '';
	let notice = 'Siga em frente até as plataformas de madeira. Arraste à direita para olhar.';
	let lastHud = 0;
	let lastYaw = 0;
	const debug = new URLSearchParams(location.search).has('debug');
	const motion = matchMedia('(prefers-reduced-motion: reduce)');
	function fit() {
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
		if (forest) for (const pool of forest.pools.pools.values()) pool.lod = lodProfilesFor(next).tree;
		governor.reset();
		budget.reset();
		fit();
	}
	const readDebug = (): GameDebug => {
		const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
		return {
			...debugSnapshot(),
			ready,
			verticalFov: camera.fov,
			horizontalFov: horizontalFov(camera.fov, camera.aspect),
			...(memory ? { heapMB: memory.usedJSHeapSize / 1048576 } : {}),
			x: controller.frame.position.x,
			y: controller.frame.position.y,
			z: controller.frame.position.z,
			grounded: controller.frame.grounded,
			checkpoint: controller.checkpoints?.current.id ?? 'start',
			animation: animator.state,
			proxyDraws: proxies.object.children.length,
			floraDraws: forest?.pools.drawCalls ?? 0,
			floraInstances: forestPlacements.count,
			qualityReason: choice.reason,
			shadowRenders: shadows.renders,
			fogNear: fogSettings(quality).near,
			fogFar: camera.far
		};
	};
	onMount(() => {
		const abort = new AbortController();
		setQuality(quality);
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
		void Promise.all([
			loadAvatar(abort.signal).then((model) => {
				if (abort.signal.aborted) {
					disposeModel(model);
					return;
				}
				avatar = model;
				rig = bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG);
				actor.add(model);
				shadows.addCaster(actor, 'actor');
				shadows.addReceiver(actor);
			}),
			loadForest(grid, quality, forestPlacements, abort.signal).then((value) => {
				if (abort.signal.aborted) {
					value.dispose();
					return;
				}
				forest = value;
				visual.add(value.pools.object);
				shadows.addCaster(value.pools.object, 'static');
				shadows.addReceiver(value.pools.object);
			})
		])
			.then(async () => {
				if (abort.signal.aborted) return;
				await renderer.compileAsync(scene, camera);
				if (!abort.signal.aborted) {
					ready = true;
					invalidate();
				}
			})
			.catch(() => {
				if (!abort.signal.aborted) {
					loadError = 'Não foi possível abrir a clareira. Saia e tente novamente.';
					onHud({ notice: loadError, shiftLock: false, ready: false, debug: debug ? readDebug() : null });
				}
			});
		return () => {
			abort.abort();
			detach();
			resize.disconnect();
			stopLoss();
			if (globalThis.__gameDebug === readDebug) delete globalThis.__gameDebug;
		};
	});
	const budgetStage = useStage(Symbol('game-budget'), { before: mainStage });
	useTask(
		(delta) => {
			budget.beginFrame(performance.now());
			if (governor.sample(delta * 1000)) dpr.set(governor.dpr);
			if (governor.saturated >= 3 && quality !== 'low') {
				setQuality(quality === 'high' ? 'medium' : 'low');
				void renderer.compileAsync(scene, camera);
			}
		},
		{ stage: budgetStage, autoInvalidate: false, running: () => ready && !hidden && !paused && !contextLost }
	);
	useTask(
		(delta) => {
			const frameInput = input.sample(delta);
			lens.aspect = camera.aspect;
			const fov = verticalFov(camera.aspect);
			if (camera.fov !== fov) {
				camera.fov = fov;
				camera.updateProjectionMatrix();
			}
			lens.fov = fov;
			const frame = controller.update(delta, frameInput, lens);
			placeObject(actor, frame.position, frame.yaw);
			applyCameraPose(camera, frame.pose);
			actor.visible = frame.pose.avatarOpacity > 0.05;
			readCharacter(animationInput, controller.character, delta);
			animationInput.jumped = frame.jumped;
			animationInput.yaw = frame.yaw;
			animationInput.intent = Math.hypot(frameInput.moveX, frameInput.moveY);
			animationInput.reducedMotion = motion.matches;
			if (frameInput.emotePressed)
				notice = animator.playEmote('wave') ? 'Um aceno para a floresta.' : 'Pare um instante para acenar.';
			if (rig) applyToRig(animator.update(delta, animationInput), rig);
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
				if (event.type === 'respawn') {
					animator.reset();
					notice = 'Você voltou ao último ponto seguro.';
				}
				if (event.type === 'checkpoint') {
					if (event.checkpoint.id === 'summit') {
						bridge.earnBadge();
						notice = 'Você chegou! Seu emblema ficou guardado neste celular.';
					} else notice = 'Ponto seguro alcançado. Pule perto da borda para atravessar.';
				}
			}
			if (frameInput.actionPressed)
				notice = 'Explore rampas e troncos. As plataformas de madeira ficam em frente à base.';
			shadowRay.origin.copy(frame.position);
			shadowRay.origin.y += 0.1;
			const hit = controller.world.raycast(shadowRay, 12);
			if (hit === null) shadows.blobs.hide(avatarBlob);
			else
				shadows.blobs.set(
					avatarBlob,
					frame.position.x,
					shadowRay.origin.y - hit,
					frame.position.z,
					0.68,
					Math.max(0, hit - 0.1)
				);
			onFrame();
		},
		{ running: () => ready && !hidden && !paused && !contextLost }
	);
	const cullStage = useStage(Symbol('game-cull'), { after: mainStage, before: renderStage });
	useTask(
		() => {
			grid.update(camera);
			shadows.blobs.sync();
			const p = controller.frame.position;
			shadows.update(p.x, p.y, p.z);
		},
		{ stage: cullStage, autoInvalidate: false, running: () => ready && !hidden && !contextLost }
	);
	const hudStage = useStage(Symbol('game-hud'), { after: renderStage });
	useTask(
		() => {
			if (performance.now() - lastHud < 250) return;
			lastHud = performance.now();
			onHud({
				notice: loadError || notice,
				shiftLock: input.shiftLock,
				ready,
				debug: debug ? readDebug() : null
			});
		},
		{ stage: hudStage, autoInvalidate: false }
	);
	onDestroy(() => {
		forest?.dispose();
		if (avatar) disposeModel(avatar);
		proxies.dispose();
		shadows.dispose();
		budget.dispose();
		visual.clear();
	});
</script>

<T is={camera} makeDefault />
<T is={visual} dispose={false} />
