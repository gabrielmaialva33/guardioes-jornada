<script lang="ts">
	import { createLineupEnvironment } from './scene/lineup.ts';
	import { golden } from './scene/golden.ts';
	import { Canvas } from '@threlte/core';
	import { onDestroy, onMount } from 'svelte';
	import { NoToneMapping, SRGBColorSpace, type WebGLRenderer } from 'three';
	import type { GameBridge } from '../abi.ts';
	import { CheckpointTracker } from './engine/checkpoints.ts';
	import { PlayerController } from './engine/controller.ts';
	import { buildCollisionWorld, createGraybox } from './engine/graybox.ts';
	import { InputModel } from './engine/input.ts';
	import Graybox from './scene/Graybox.svelte';
	import { StoryGame } from './missions/story.ts';
	import { storyView, type StoryView } from './missions/view.ts';
	import StoryPanel from './missions/StoryPanel.svelte';
	import AvatarChooser from './scene/AvatarChooser.svelte';
	import { AVATAR_PRESETS, DEFAULT_AVATAR, KENNEY_SKINS } from './avatar/catalog.ts';
	import { createLocalSave, type AvatarProfile } from './data/local-save.ts';
	import { forestLayout } from './scene/forest-layout.ts';
	import HudIcon from './scene/HudIcon.svelte';
	import TouchControls from './scene/TouchControls.svelte';
	import ControlSettings from './scene/ControlSettings.svelte';
	import type { ControlPreferences } from './scene/controls.ts';
	import { LIGHT } from './style/palette.ts';
	import { generateWorld } from './survival/generate.ts';
	import { buildStoryWorld } from './level/build.ts';
	import { createMapEnvironment } from './world-runtime/environment.ts';
	import { BlockGrid } from './render/index.ts';
	import { createGrayboxVisual } from './scene/graybox-visual.ts';
	import { loadForest } from './scene/forest.ts';
	import type { SceneEnvironment } from './scene/environment.ts';
	import type { HudState } from './scene/types.ts';
	import { createGameAudio } from './audio/engine.ts';
	import { Soundscape } from './audio/soundscape.ts';
	import SoundSettings from './audio/SoundSettings.svelte';

	let {
		bridge,
		createRenderer
	}: { bridge: GameBridge; createRenderer: (canvas: HTMLCanvasElement) => WebGLRenderer } = $props();
	let wrapper: HTMLDivElement | undefined = $state();
	let touchControls: { draw(): void } | undefined = $state();
	let safeArea: HTMLDivElement;
	let tooltip = $state('');
	let tooltipTimer: ReturnType<typeof setTimeout> | undefined;
	let hud: HudState = $state({ notice: 'Abrindo a clareira…', shiftLock: false, ready: false, debug: null });
	let portrait = $state(innerWidth < innerHeight);
	let allowPortrait = $state(false);
	let hasMoved = $state(false);
	const gameSave = createLocalSave(
		DEFAULT_AVATAR,
		golden.enabled ? { getItem: () => null, setItem: () => {} } : undefined
	);
	let controls = $state.raw(gameSave.controls());
	let controlsError = $state('');
	let avatarProfile = $state.raw(golden.enabled ? DEFAULT_AVATAR : gameSave.avatar());
	let choosing = $state(false);
	let missionMenu = $state(false);
	let saveMessage = $state('');
	let sceneRef: { setAvatarProfile: (profile: AvatarProfile) => Promise<void> } | undefined = $state();
	let chooserGeneration = 0;
	let disposed = false;
	const rotate = $derived(!golden.enabled && portrait && !allowPortrait && !choosing);
	const showNotice = $derived(saveMessage || !hasMoved || !hud.notice.startsWith('Siga em frente'));
	const input = new InputModel();
	input.configure(gameSave.controls());
	const query = new URLSearchParams(location.search);
	const debugGraybox = query.has('graybox');
	const mapData =
		debugGraybox || (golden.enabled && golden.lineup)
			? null
			: query.get('world') === 'survival'
				? { world: generateWorld(golden.enabled ? golden.seed : 20261025), level: undefined }
				: buildStoryWorld();
	const story = mapData?.level
		? new StoryGame(mapData.level, {
				value: gameSave.story(),
				persist: (data) => gameSave.setStory(data),
				badge: () => bridge.earnBadge()
			})
		: undefined;
	let storyUi = $state.raw<StoryView | undefined>(undefined);
	let lastStoryKey = '';
	const map = mapData ? createMapEnvironment(mapData.world, mapData.level, gameSave, story) : null;
	const level = debugGraybox ? createGraybox() : null;
	const forest = debugGraybox ? forestLayout() : null;
	function oldEnvironment(): SceneEnvironment {
		if (!level || !forest) throw new Error('graybox-fixture');
		level.proxies.push(...forest.colliders);
		const grid = BlockGrid.covering(-40, -30, 40, 80);
		const target = { ...level.checkpoints[1].spawn, name: 'Plataformas de madeira' };
		return {
			kind: 'graybox',
			start: level.start,
			checkpoints: level.checkpoints,
			collision: buildCollisionWorld(level),
			grid,
			placements: forest.placements.count,
			createVisual: () => createGrayboxVisual(level),
			loadPlacements: (quality, signal) => loadForest(grid, quality, forest.placements, signal),
			target,
			nextTarget() {}
		};
	}
	const environment =
		golden.enabled && golden.lineup ? createLineupEnvironment() : (map?.environment ?? oldEnvironment());
	const world = environment.collision;
	const checkpoints =
		map?.tracker ?? new CheckpointTracker(environment.start, environment.checkpoints, level?.killY ?? -20);
	const initial =
		(query.has('debug') ? map?.debugPoses[query.get('pose') ?? ''] : undefined) ??
		map?.checkpoint ??
		environment.start;
	const goldenSpawn =
		golden.enabled && golden.avatar && mapData
			? {
					x: golden.avatar[0],
					z: golden.avatar[1],
					y: mapData.world.heights[
						Math.round(golden.avatar[1]) * mapData.world.grid + Math.round(golden.avatar[0])
					]
				}
			: initial.spawn;
	const controller = new PlayerController(world, goldenSpawn, {
		yaw: golden.enabled && golden.avatar ? golden.avatar[2] : initial.yaw,
		checkpoints
	});
	controller.camera.mode = matchMedia('(pointer: coarse)').matches ? 'follow' : 'classic';
	story?.repairBadge();
	// Settings are written 400 ms after the last change (a slider drag fires many), and on exit.
	let audioSaveTimer: ReturnType<typeof setTimeout> | undefined;
	const saveAudio = () => {
		audioSaveTimer = undefined;
		gameSave.setAudio(soundscape.audio.settings());
	};
	const soundscape = new Soundscape({
		audio: createGameAudio({
			settings: gameSave.audio() ?? undefined,
			onSettingsChange(settings) {
				audioSettings = settings;
				clearTimeout(audioSaveTimer);
				audioSaveTimer = setTimeout(saveAudio, 400);
			}
		}),
		map: mapData,
		story
	});
	let audioSettings = $state.raw(soundscape.audio.settings());
	// Entering the trail was a tap: while that activation lasts the context may start at once.
	if ((navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive)
		void soundscape.audio.unlock();
	onDestroy(() => {
		disposed = true;
		clearTimeout(tooltipTimer);
		chooserGeneration++;
		world.dispose();
		if (audioSaveTimer !== undefined) {
			clearTimeout(audioSaveTimer);
			saveAudio();
		}
		void soundscape.dispose();
	});
	function openChooser() {
		chooserGeneration++;
		choosing = true;
		input.releaseAll();
		controller.resume();
	}
	function closeChooser() {
		chooserGeneration++;
		choosing = false;
		input.releaseAll();
		controller.resume();
		void sceneRef?.setAvatarProfile(avatarProfile).catch(() => {});
		wrapper?.focus({ preventScroll: true });
	}
	async function applyAvatar(value: AvatarProfile) {
		if (!sceneRef) throw new Error('avatar-not-ready');
		const generation = chooserGeneration;
		await sceneRef.setAvatarProfile(value);
		if (disposed || generation !== chooserGeneration) return;
		avatarProfile = { ...value, colors: { ...value.colors } };
		saveMessage = gameSave.setAvatar(avatarProfile)
			? ''
			: 'A aparência mudou só nesta partida. Não foi possível guardar neste celular.';
		closeChooser();
	}
	onMount(() => {
		const listeners = new AbortController();
		const resize = () => {
			portrait = innerWidth < innerHeight;
			const padding = getComputedStyle(safeArea);
			input.configure({
				...controls,
				insets: {
					left: parseFloat(padding.paddingLeft) || 0,
					right: parseFloat(padding.paddingRight) || 0,
					top: parseFloat(padding.paddingTop) || 0,
					bottom: parseFloat(padding.paddingBottom) || 0
				}
			});
			input.releaseAll();
			controller.resume();
		};
		resize();
		window.addEventListener('resize', resize, { signal: listeners.signal });
		// UI taps on HUD and panel buttons; jump and the contextual action have their own sounds.
		wrapper?.addEventListener(
			'click',
			(event) => {
				const button = event.target instanceof Element ? event.target.closest('button') : null;
				if (button && !button.matches('[data-game-button="jump"],[data-game-button="action"]'))
					soundscape.uiTap();
			},
			{ signal: listeners.signal, capture: true }
		);
		return () => listeners.abort();
	});
	function playPortrait() {
		allowPortrait = true;
		input.releaseAll();
		controller.resume();
		wrapper?.focus({ preventScroll: true });
	}
	function refreshStory() {
		if (!story) return;
		storyUi = storyView(story, controller.character.position);
		soundscape.syncStory();
	}
	function storyChoice(id: string) {
		story?.choose(id, controller.character.position);
		refreshStory();
		input.releaseAll();
	}
	function storyClose() {
		story?.closeDialogue();
		refreshStory();
		input.releaseAll();
		controller.resume();
		wrapper?.focus({ preventScroll: true });
	}
	function restartStory() {
		story?.restart();
		backToBase();
		refreshStory();
		input.releaseAll();
	}
	function drawControls() {
		if (story) {
			const action = story.context(controller.character.position);
			const key = `${story.revision}:${action?.id ?? ''}:${action?.disabled ?? false}`;
			if (key !== lastStoryKey) {
				lastStoryKey = key;
				refreshStory();
			}
		}

		if (saveMessage && controller.frame.speed > 0.1) saveMessage = '';
		if (!hasMoved && controller.frame.speed > 0.1) hasMoved = true;
		touchControls?.draw();
	}
	function keyboardButton(event: KeyboardEvent) {
		if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
	}
	function changeControls(patch: Partial<ControlPreferences>) {
		controls = { ...controls, ...patch };
		input.configure(controls);
		controlsError = gameSave.setControls(controls)
			? ''
			: 'Não foi possível guardar os controles neste celular.';
	}
	function hint(id: string, label: string) {
		if (controls.hintsSeen.includes(id)) return;
		changeControls({ hintsSeen: [...controls.hintsSeen, id] });
		tooltip = label;
		clearTimeout(tooltipTimer);
		tooltipTimer = setTimeout(() => {
			tooltip = '';
		}, 2200);
	}
	function nextTarget() {
		if (story && storyUi) {
			const available = storyUi.missions.filter((m) => m.available && !m.completed);
			const current = available.findIndex((m) => m.id === storyUi?.selected);
			const next = available[(current + 1) % available.length];
			if (next) story.select(next.id);
			refreshStory();
		} else environment.nextTarget();
		hint('compass', 'Bússola: aponta para o próximo destino');
	}
	function backToBase() {
		input.releaseAll();
		checkpoints.reset();
		controller.respawnAt(environment.start);
		controller.resume();
		wrapper?.focus({ preventScroll: true });
	}
</script>

<div
	bind:this={wrapper}
	class="secret-game"
	class:golden={golden.enabled}
	class:choosing
	style:background={`linear-gradient(${golden.enabled && golden.night ? LIGHT.night.skyTop : LIGHT.daylight.skyTop}, ${golden.enabled && golden.night ? LIGHT.night.horizon : LIGHT.daylight.horizon} 65%)`}
	data-game-root
	tabindex="-1"
	role="application"
	aria-label="Trilha secreta. Use W A S D para andar, espaço para pular e arraste para olhar."
>
	<div bind:this={safeArea} class="safe-area" aria-hidden="true"></div>
	<div class="world">
		<Canvas dpr={1} shadows={false} toneMapping={NoToneMapping} colorSpace={SRGBColorSpace} {createRenderer}
			>{#if wrapper}<Graybox
					{wrapper}
					bind:this={sceneRef}
					paused={rotate || choosing || missionMenu || !!storyUi?.dialogue}
					{avatarProfile}
					{controller}
					{input}
					{environment}
					{bridge}
					sound={soundscape}
					onHud={(state) => (hud = state)}
					onFrame={drawControls}
				/>{/if}</Canvas
		>
	</div>
	<div class="hud" inert={rotate || choosing || missionMenu || !!storyUi?.dialogue}>
		<div class="top-bar">
			<button
				type="button"
				aria-label="Voltar à jornada"
				title="Voltar à jornada"
				onpointerdown={(event) => event.stopPropagation()}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={() => bridge.exit()}><HudIcon name="back" /></button
			>
			<button
				type="button"
				aria-label="Voltar à base"
				title="Voltar à base"
				onpointerdown={(event) => event.stopPropagation()}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={backToBase}><HudIcon name="base" /></button
			>
			<button
				type="button"
				aria-label="Personalizar personagem"
				title="Personalizar personagem"
				disabled={!hud.ready}
				onpointerdown={(event) => event.stopPropagation()}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={() => {
					hint('avatar', 'Personagem, som e controles');
					openChooser();
				}}><HudIcon name="avatar" /></button
			>
			<button
				type="button"
				data-game-button="shiftLock"
				aria-label="Travar câmera"
				title="Travar câmera"
				aria-pressed={hud.shiftLock}
				onpointerdown={(e) => e.stopPropagation()}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={() => {
					input.tapButton('shiftLock');
					hint('lock', 'Travar câmera: olhe para onde seu personagem aponta');
				}}><HudIcon name="lock" /></button
			>
			<button
				type="button"
				aria-label="Próximo destino"
				title="Próximo destino"
				onpointerdown={(e) => e.stopPropagation()}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={nextTarget}><HudIcon name="explore" /></button
			>
			<button
				type="button"
				data-game-button="emote"
				aria-label="Acenar"
				title="Acenar"
				onpointerdown={(e) => e.stopPropagation()}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={() => {
					input.tapButton('emote');
					hint('emote', 'Acenar: dê um oi para a floresta');
				}}><HudIcon name="wave" /></button
			>
			<button
				type="button"
				aria-label="Som"
				aria-pressed={!audioSettings.muted.master}
				title={audioSettings.muted.master ? 'Ligar o som' : 'Desligar o som'}
				onpointerdown={(event) => event.stopPropagation()}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={() => soundscape.audio.mute(!audioSettings.muted.master)}
				><HudIcon name={audioSettings.muted.master ? 'muted' : 'sound'} /></button
			>
		</div>
		{#if tooltip}<p class="tooltip" role="status">{tooltip}</p>{/if}
		{#if showNotice && (!story || !hud.ready)}<p
				class="notice"
				class:sr-only={!!hud.debug}
				aria-live="polite"
			>
				{saveMessage || hud.notice}
			</p>{/if}
		<TouchControls
			bind:this={touchControls}
			{input}
			action={storyUi?.action}
			preferences={controls}
			moved={hasMoved}
			ready={hud.ready}
		/>
		{#if environment.kind === 'map'}<div class="mission" aria-live="polite">
				<span>Exploração do mapa</span><strong>{hud.target ?? environment.target.name}</strong><span
					>{hud.distance ?? 0} m · {story
						? 'Escolha o destino na lista de missões'
						: 'Toque na bússola para mudar o destino'}</span
				>
			</div>{/if}
		{#if hud.splash}<div class="splash" role="status">Água funda. Voltando ao ponto seguro…</div>{/if}
		{#if hud.shiftLock}<div class="crosshair" aria-hidden="true"><HudIcon name="lock" /></div>{/if}
	</div>
	{#if storyUi && !rotate && !choosing}<StoryPanel
			view={storyUi}
			onmenu={(open) => {
				missionMenu = open;
				input.releaseAll();
				controller.resume();
				if (!open) wrapper?.focus({ preventScroll: true });
			}}
			onchoice={storyChoice}
			onclose={storyClose}
			onselect={(id) => {
				story?.select(id);
				refreshStory();
			}}
			onrestart={restartStory}
			onexit={() => bridge.exit()}
		/>{/if}
	{#if choosing}<AvatarChooser
			profile={avatarProfile}
			presets={AVATAR_PRESETS}
			kenneyUrls={KENNEY_SKINS}
			onapply={applyAvatar}
			onclose={closeChooser}
			>{#snippet sound()}<ControlSettings
					settings={controls}
					onchange={changeControls}
					error={controlsError}
				/><SoundSettings
					settings={audioSettings}
					onvolume={(bus, volume) => soundscape.audio.setBusVolume(bus, volume)}
					onmute={(muted) => soundscape.audio.mute(muted)}
				/>{/snippet}</AvatarChooser
		>{/if}

	{#if rotate}
		<div
			class="rotate"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-labelledby="rotate-title"
			onpointerdown={(event) => event.stopPropagation()}
			onkeydown={(event) => event.stopPropagation()}
			onkeyup={(event) => event.stopPropagation()}
		>
			<div class="rotate-card">
				<HudIcon name="rotate" />
				<h2 id="rotate-title">Gire o celular para jogar como no Roblox</h2>
				<button
					class="continue"
					type="button"
					{@attach (node) => {
						node.focus({ preventScroll: true });
					}}
					onclick={playPortrait}>Jogar assim mesmo</button
				>
				<button
					type="button"
					aria-label="Voltar à jornada"
					title="Voltar à jornada"
					onclick={() => bridge.exit()}><HudIcon name="back" /></button
				>
			</div>
		</div>
	{/if}
	{#if hud.debug}
		<output class="debug" aria-label="Desempenho do jogo"
			>{hud.debug.fps.toFixed(0)} FPS · p95 {hud.debug.frameP95Ms.toFixed(1)} ms<br />{hud.debug.drawCalls} chamadas
			· {hud.debug.triangles} triângulos<br />DPR {hud.debug.dpr.toFixed(2)} · {hud.debug.quality}<br />{hud
				.debug.geometries} geometrias · {hud.debug.textures} texturas · {hud.debug.programs} programas</output
		>
	{/if}
</div>

<style>
	.secret-game.golden {
		width: 960px;
		height: 432px;
		position: relative;
	}
	.golden > :global(:not(.world)) {
		visibility: hidden;
	}
	.secret-game {
		position: fixed;
		inset: 0;
		z-index: 50;
		width: 100%;
		height: 100dvh;
		overflow: hidden;
		color: #f1f6ed;
		font: 0.875rem var(--font-ui, system-ui);
		touch-action: none;
		user-select: none;
		-webkit-touch-callout: none;
		outline-offset: -4px;
	}
	.secret-game.choosing {
		touch-action: auto;
	}
	.world,
	.hud {
		position: absolute;
		inset: 0;
	}
	.hud {
		pointer-events: none;
	}
	.top-bar {
		position: absolute;
		top: max(12px, env(safe-area-inset-top));
		left: max(12px, env(safe-area-inset-left));
		display: flex;
		gap: 4px;
	}
	button {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 1px solid #ffffff66;
		border-radius: 50%;
		padding: 0;
		background: #163829b8;
		color: #f1f6ed;
		font: inherit;
		touch-action: none;
		cursor: pointer;
		pointer-events: auto;
	}
	button[aria-pressed='true'] {
		background: #74c69ddf;
		color: #173a2b;
	}
	button:focus-visible,
	.secret-game:focus-visible {
		outline: 3px solid #74c69d;
		outline-offset: 3px;
	}
	.notice {
		position: absolute;
		top: max(72px, calc(env(safe-area-inset-top) + 60px));
		left: max(12px, env(safe-area-inset-left));
		width: min(28vw, 17rem);
		box-sizing: border-box;
		margin: 0;
		padding: 8px 10px;
		border-radius: 12px;
		background: #173a2bdc;
		font-size: 0.75rem;
		line-height: 1.4;
	}
	.safe-area {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
		padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
			env(safe-area-inset-left);
	}
	.tooltip {
		position: absolute;
		top: 64px;
		left: max(12px, env(safe-area-inset-left));
		max-width: 18rem;
		margin: 0;
		padding: 8px 12px;
		border-radius: 10px;
		background: #10271bf0;
		font-size: 0.75rem;
	}
	.mission {
		position: absolute;
		top: max(68px, calc(env(safe-area-inset-top) + 56px));
		right: max(12px, env(safe-area-inset-right));
		display: grid;
		gap: 3px;
		max-width: 30vw;
		padding: 8px 10px;
		background: #173a2be8;
		border-radius: 12px;
		font-size: 0.7rem;
	}
	.mission strong {
		font-size: 0.8rem;
	}
	.splash {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: #2f7fb066;
		text-shadow: 0 1px 3px #173a2b;
	}
	.crosshair {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		color: #fff;
		filter: drop-shadow(0 1px 2px #10271b);
	}
	.debug {
		position: absolute;
		top: max(72px, calc(env(safe-area-inset-top) + 60px));
		left: max(12px, env(safe-area-inset-left));
		padding: 6px;
		background: #10271be8;
		font:
			0.65rem ui-monospace,
			monospace;
		pointer-events: none;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.rotate {
		position: absolute;
		inset: 0;
		z-index: 2;
		display: grid;
		place-items: center;
		background: #10271bf0;
		padding: 24px;
	}
	.rotate-card {
		display: grid;
		justify-items: center;
		gap: 20px;
		max-width: 22rem;
		text-align: center;
	}
	.rotate-card > :global(svg) {
		width: 56px;
		height: 56px;
	}
	h2 {
		margin: 0;
		font: 1.7rem var(--font-story, system-ui);
	}
	.continue {
		width: auto;
		padding: 12px 20px;
		min-height: 48px;
		border-radius: 999px;
		background: #74c69d;
		color: #173a2b;
		font-weight: 700;
	}
</style>
