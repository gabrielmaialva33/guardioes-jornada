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
	import { InputModel, type ButtonRole } from './engine/input.ts';
	import Graybox from './scene/Graybox.svelte';
	import { StoryGame } from './missions/story.ts';
	import { storyView, type StoryView } from './missions/view.ts';
	import StoryPanel from './missions/StoryPanel.svelte';
	import AvatarChooser from './scene/AvatarChooser.svelte';
	import { AVATAR_PRESETS, DEFAULT_AVATAR, KENNEY_SKINS } from './avatar/catalog.ts';
	import { createLocalSave, type AvatarProfile } from './data/local-save.ts';
	import { forestLayout } from './scene/forest-layout.ts';
	import HudIcon from './scene/HudIcon.svelte';
	import { DURATION } from './style/motion.ts';
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
	let stickBase: HTMLDivElement;
	let stickThumb: HTMLDivElement;
	let jump: HTMLButtonElement;
	let sideButtons: HTMLDivElement;
	let hud: HudState = $state({ notice: 'Abrindo a clareira…', shiftLock: false, ready: false, debug: null });
	let portrait = $state(innerWidth < innerHeight);
	let allowPortrait = $state(false);
	let hasMoved = $state(false);
	const gameSave = createLocalSave(
		DEFAULT_AVATAR,
		golden.enabled ? { getItem: () => null, setItem: () => {} } : undefined
	);
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
			input.releaseAll();
			controller.resume();
		};
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
		const stick = input.stick;
		stickBase.style.display = stick.active ? 'block' : 'none';
		stickBase.style.transform = `translate(${stick.originX}px, ${stick.originY}px)`;
		stickThumb.style.transform = `translate(${stick.x}px, ${stick.y}px)`;
		stickThumb.style.display = stick.active ? 'block' : 'none';
		const rect = input.layout.jumpButton;
		sideButtons.style.bottom = `${wrapper ? wrapper.clientHeight - rect.y + 16 : 106}px`;
		jump.style.left = `${rect.x}px`;
		jump.style.top = `${rect.y}px`;
		jump.style.width = `${rect.width}px`;
		jump.style.height = `${rect.height}px`;
	}
	function keyboardButton(event: KeyboardEvent) {
		if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
	}
	function activate(event: MouseEvent, role: ButtonRole) {
		if (event.detail === 0) input.tapButton(role);
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
				onclick={openChooser}><HudIcon name="avatar" /></button
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
		{#if showNotice && (!story || !hud.ready)}<p
				class="notice"
				class:sr-only={!!hud.debug}
				aria-live="polite"
			>
				{saveMessage || hud.notice}
			</p>{/if}
		<div
			class="stick-zone"
			class:moved={hasMoved}
			style:--hint-duration={`${DURATION.state}s`}
			aria-hidden="true"
		>
			Arraste para andar
		</div>
		<div bind:this={stickBase} class="stick-base" aria-hidden="true"></div>
		<div bind:this={stickThumb} class="stick-thumb" aria-hidden="true"></div>
		{#if environment.kind === 'map'}<div class="mission" aria-live="polite">
				<span>Exploração do mapa</span><strong>{hud.target ?? environment.target.name}</strong><span
					>{hud.distance ?? 0} m · {story
						? 'Escolha o destino na lista de missões'
						: 'Toque na bússola para mudar o destino'}</span
				>
			</div>{/if}
		{#if hud.splash}<div class="splash" role="status">Água funda. Voltando ao ponto seguro…</div>{/if}
		{#if hud.shiftLock}<div class="crosshair" aria-hidden="true"><HudIcon name="lock" /></div>{/if}
		<div bind:this={sideButtons} class="side-buttons">
			<button
				type="button"
				data-game-button="shiftLock"
				aria-label="Travar câmera"
				title="Travar câmera"
				aria-pressed={hud.shiftLock}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={(event) => activate(event, 'shiftLock')}><HudIcon name="lock" /></button
			>
			<button
				type="button"
				data-game-button="emote"
				aria-label="Acenar"
				title="Acenar"
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={(event) => activate(event, 'emote')}><HudIcon name="wave" /></button
			>
			<button
				type="button"
				data-game-button="action"
				aria-label={storyUi?.action?.label ?? 'Explorar'}
				title={storyUi?.action?.label ?? 'Explorar'}
				aria-disabled={story ? !storyUi?.action || !!storyUi.action.disabled : false}
				onkeydown={keyboardButton}
				onkeyup={keyboardButton}
				onclick={(event) => activate(event, 'action')}
				><HudIcon name="explore" />{#if storyUi?.action}<span class="action-label"
						>{storyUi.action.label}</span
					>{/if}</button
			>
		</div>
		<button
			bind:this={jump}
			class="jump"
			type="button"
			data-game-button="jump"
			aria-label="Pular"
			title="Pular"
			onkeydown={keyboardButton}
			onkeyup={keyboardButton}
			onclick={(event) => activate(event, 'jump')}><HudIcon name="jump" /></button
		>
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
			>{#snippet sound()}<SoundSettings
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
		gap: 8px;
	}
	button {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
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
		background: #f1d364df;
		color: #173a2b;
	}
	button:focus-visible,
	.secret-game:focus-visible {
		outline: 3px solid #f6d968;
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
	.side-buttons button[data-game-button='action'] {
		position: relative;
	}
	.action-label {
		position: absolute;
		right: calc(100% + 8px);
		min-width: 7rem;
		max-width: 11rem;
		padding: 6px 8px;
		border-radius: 8px;
		background: #173a2be8;
		font-size: 0.75rem;
		line-height: 1.2;
		pointer-events: none;
	}
	.side-buttons {
		position: absolute;
		right: max(12px, env(safe-area-inset-right));
		bottom: 106px;
		display: grid;
		gap: 8px;
	}
	.jump {
		position: absolute;
		right: 25px;
		bottom: 20px;
		width: 70px;
		height: 70px;
		background: #f1d364b8;
		color: #173a2b;
	}
	.jump :global(svg) {
		width: 36px;
		height: 36px;
	}
	.stick-zone {
		position: absolute;
		left: max(20px, env(safe-area-inset-left));
		bottom: max(20px, env(safe-area-inset-bottom));
		padding: 8px 12px;
		border-radius: 999px;
		background: #173a2be8;
		color: #f1f6ed;
		text-shadow: 0 1px 2px #10271b;
		transition: opacity var(--hint-duration) ease;
	}
	.stick-zone.moved {
		opacity: 0;
	}
	.stick-base,
	.stick-thumb {
		display: none;
		position: absolute;
		left: -40px;
		top: -40px;
		width: 80px;
		height: 80px;
		border: 2px solid #ffffffaa;
		border-radius: 50%;
		background: #173a2b60;
		pointer-events: none;
	}
	.stick-thumb {
		left: -19px;
		top: -19px;
		width: 38px;
		height: 38px;
		background: #f1f6edb0;
	}
	.mission {
		position: absolute;
		top: max(12px, env(safe-area-inset-top));
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
		background: #f1d364;
		color: #173a2b;
		font-weight: 700;
	}
	@media (prefers-reduced-motion: reduce) {
		.stick-zone {
			transition: none;
		}
	}
</style>
