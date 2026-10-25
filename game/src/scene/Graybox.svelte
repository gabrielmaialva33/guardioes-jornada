<script lang="ts">
	import { T, useStage, useTask, useThrelte } from '@threlte/core';
	import { onDestroy, onMount } from 'svelte';
	import { CircleGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Ray, Vector3 } from 'three';
	import type { GameBridge } from '../../abi.ts';
	import { AvatarAnimator, createAvatarInput, readCharacter } from '../animation/avatar-animator.ts';
	import { AVATAR_LAYOUT, BLOCKY_RIG } from '../animation/joints.ts';
	import { applyToRig, bindRig, type RigBinding } from '../animation/rig.ts';
	import { applyCameraPose } from '../engine/camera.ts';
	import { placeObject } from '../engine/character.ts';
	import { CAMERA_FOV, CAMERA_NEAR } from '../engine/constants.ts';
	import type { PlayerController } from '../engine/controller.ts';
	import { proxyGeometry, type Graybox } from '../engine/graybox.ts';
	import { attachInput, type InputModel } from '../engine/input.ts';
	import { disposeModel, loadAvatar } from './avatar.ts';
	import { FrameStats } from './frame-stats.ts';
	import type { GameDebug, HudState } from './types.ts';

	let { wrapper, controller, input, level, bridge, onHud, onFrame }: {
		wrapper: HTMLElement; controller: PlayerController; input: InputModel; level: Graybox;
		bridge: GameBridge; onHud: (state: HudState) => void; onFrame: () => void;
	} = $props();
	const { renderer, renderStage } = useThrelte();
	const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, 160);
	const visual = new Group();
	const actor = new Group();
	const palette = { ground: 0x47765a, box: 0xb9aa76, ramp: 0xdd985c, log: 0x855c41 };
	const materials = new Map<number, MeshLambertMaterial>();
	for (const proxy of level.proxies) {
		const color = proxy.name === 'ground' ? palette.ground : proxy.name.includes('pad') ? 0xe3c75c : palette[proxy.kind];
		let material = materials.get(color);
		if (!material) { material = new MeshLambertMaterial({ color, flatShading: true }); materials.set(color, material); }
		visual.add(new Mesh(proxyGeometry(proxy), material));
	}
	visual.add(actor);
	const blob = new Mesh(new CircleGeometry(0.68, 16), new MeshBasicMaterial({ color: 0x10271b, transparent: true, opacity: 0.3, depthWrite: false }));
	blob.rotation.x = -Math.PI / 2;
	visual.add(blob);
	const shadowRay = new Ray(new Vector3(), new Vector3(0, -1, 0));
	const lens = { fov: CAMERA_FOV, aspect: 1, near: CAMERA_NEAR };
	const animator = new AvatarAnimator();
	const animationInput = createAvatarInput();
	let rig: RigBinding | undefined;
	let avatar: Group | undefined;
	let ready = $state(false);
	let hidden = $state(document.hidden);
	let loadError = '';
	let notice = 'Siga em frente até as plataformas amarelas. Arraste à direita para olhar.';
	let lastHud = 0;
	let sampled = { fps: 0, frameP95Ms: 0 };
	const stats = new FrameStats();
	const debug = new URLSearchParams(location.search).has('debug');
	const motion = matchMedia('(prefers-reduced-motion: reduce)');
	const oldReset = renderer.info.autoReset;
	renderer.info.autoReset = false;
	renderer.info.reset();
	let lastCalls = 0;
	let lastTriangles = 0;
	const readDebug = (): GameDebug => {
		const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
		return { ...sampled, drawCalls: lastCalls, triangles: lastTriangles, dpr: renderer.getPixelRatio(), quality: 'low',
			geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
			programs: renderer.info.programs?.length ?? 0, ...(memory ? { heapMB: memory.usedJSHeapSize / 1048576 } : {}),
			x: controller.frame.position.x, y: controller.frame.position.y, z: controller.frame.position.z,
			grounded: controller.frame.grounded, checkpoint: controller.checkpoints?.current.id ?? 'start',
			animation: animator.state };
	};
	onMount(() => {
		const abort = new AbortController();
		const detach = attachInput(wrapper, input, { wantsPointerLock: () => input.shiftLock || controller.camera.firstPerson });
		wrapper.focus({ preventScroll: true });
		document.addEventListener('visibilitychange', () => { hidden = document.hidden; controller.resume(); stats.reset(); }, { signal: abort.signal });
		if (debug) globalThis.__gameDebug = readDebug;
		void loadAvatar(abort.signal).then((model) => {
			if (abort.signal.aborted) { disposeModel(model); return; }
			avatar = model;
			rig = bindRig(model, AVATAR_LAYOUT, BLOCKY_RIG);
			actor.add(model);
			ready = true;
		}).catch(() => {
			if (!abort.signal.aborted) { loadError = 'Não foi possível abrir o personagem. Saia e tente novamente.'; onHud({ notice: loadError, shiftLock: false, ready: false, debug: debug ? readDebug() : null }); }
		});
		return () => { abort.abort(); detach(); if (globalThis.__gameDebug === readDebug) delete globalThis.__gameDebug; };
	});

	useTask((delta) => {
		const frameInput = input.sample(delta);
		lens.aspect = camera.aspect;
		const frame = controller.update(delta, frameInput, lens);
		placeObject(actor, frame.position, frame.yaw);
		applyCameraPose(camera, frame.pose);
		actor.visible = frame.pose.avatarOpacity > 0.05;
		readCharacter(animationInput, controller.character, delta);
		animationInput.jumped = frame.jumped;
		animationInput.yaw = frame.yaw;
		animationInput.intent = Math.hypot(frameInput.moveX, frameInput.moveY);
		animationInput.reducedMotion = motion.matches;
		if (frameInput.emotePressed) notice = animator.playEmote('wave') ? 'Um aceno para a floresta.' : 'Pare um instante para acenar.';
		if (rig) applyToRig(animator.update(delta, animationInput), rig);
		for (const event of frame.events) {
			if (event.type === 'respawn') { animator.reset(); notice = 'Você voltou ao último ponto seguro.'; }
			if (event.type === 'checkpoint') {
				if (event.checkpoint.id === 'summit') { bridge.earnBadge(); notice = 'Você chegou! Seu emblema ficou guardado neste celular.'; }
				else notice = 'Ponto seguro alcançado. Pule perto da borda para atravessar.';
			}
		}
		if (frameInput.actionPressed) notice = 'Explore rampas e troncos. As plataformas amarelas ficam em frente à base.';
		shadowRay.origin.copy(frame.position); shadowRay.origin.y += 0.1;
		const hit = controller.world.raycast(shadowRay, 12);
		blob.visible = hit !== null;
		if (hit !== null) { blob.position.set(frame.position.x, shadowRay.origin.y - hit + 0.025, frame.position.z); blob.scale.setScalar(Math.max(0.45, 1 - hit * 0.04)); }
		stats.add(delta);
		onFrame();
	}, { running: () => ready && !hidden });

	const afterRender = useStage(Symbol('game-statistics'), { after: renderStage });
	useTask(() => {
		// autoReset=false includes every render pass; reset once, after the final stage.
		lastCalls = renderer.info.render.calls;
		lastTriangles = renderer.info.render.triangles;
		renderer.info.reset();
		if (performance.now() - lastHud < 250) return;
		lastHud = performance.now();
		sampled = stats.read();
		onHud({ notice: loadError || notice, shiftLock: input.shiftLock, ready, debug: debug ? readDebug() : null });
	}, { stage: afterRender, autoInvalidate: false });

	onDestroy(() => {
		if (avatar) disposeModel(avatar);
		for (const child of visual.children) if (child instanceof Mesh) child.geometry.dispose();
		for (const material of materials.values()) material.dispose();
		blob.material.dispose();
		renderer.info.autoReset = oldReset;
		visual.clear();
	});
</script>

<T is={camera} makeDefault />
<T.Color attach="background" args={['#adc6b5']} />
<T.Fog attach="fog" args={['#adc6b5', 65, 130]} />
<T.HemisphereLight intensity={2.2} color="#ecf5e8" groundColor="#536849" />
<T.DirectionalLight intensity={1.6} position={[-20, 35, -10]} />
<T is={visual} dispose={false} />
