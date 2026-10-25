<script lang="ts">
	import { Canvas } from '@threlte/core';
	import { onDestroy } from 'svelte';
	import { NoToneMapping, SRGBColorSpace, type WebGLRenderer } from 'three';
	import type { GameBridge } from '../abi.ts';
	import { CheckpointTracker } from './engine/checkpoints.ts';
	import { PlayerController } from './engine/controller.ts';
	import { buildCollisionWorld, createGraybox } from './engine/graybox.ts';
	import { InputModel, type ButtonRole } from './engine/input.ts';
	import Graybox from './scene/Graybox.svelte';
	import { LIGHT } from './style/palette.ts';
	import type { HudState } from './scene/types.ts';

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
	const input = new InputModel();
	const level = createGraybox();
	const world = buildCollisionWorld(level);
	const checkpoints = new CheckpointTracker(level.start, level.checkpoints, level.killY);
	const controller = new PlayerController(world, level.start.spawn, { yaw: level.start.yaw, checkpoints });
	onDestroy(() => world.dispose());
	function drawControls() {
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
		controller.respawnAt(level.start);
		controller.resume();
		wrapper?.focus({ preventScroll: true });
	}
</script>

<div
	bind:this={wrapper}
	class="secret-game"
	style:background={`linear-gradient(${LIGHT.daylight.skyTop}, ${LIGHT.daylight.horizon} 65%)`}
	data-game-root
	tabindex="-1"
	role="application"
	aria-label="Trilha secreta. Use W A S D para andar, espaço para pular e arraste para olhar."
>
	<div class="world">
		<Canvas
			dpr={[0.75, 1]}
			shadows={false}
			toneMapping={NoToneMapping}
			colorSpace={SRGBColorSpace}
			{createRenderer}
			>{#if wrapper}<Graybox
					{wrapper}
					{controller}
					{input}
					{level}
					{bridge}
					onHud={(state) => (hud = state)}
					onFrame={drawControls}
				/>{/if}</Canvas
		>
	</div>
	<div class="top-bar">
		<button
			type="button"
			onpointerdown={(event) => event.stopPropagation()}
			onkeydown={keyboardButton}
			onkeyup={keyboardButton}
			onclick={backToBase}>Voltar à base</button
		>
		<button
			type="button"
			onpointerdown={(event) => event.stopPropagation()}
			onkeydown={keyboardButton}
			onkeyup={keyboardButton}
			onclick={() => bridge.exit()}>Voltar à jornada</button
		>
	</div>
	<p class="notice" aria-live="polite">{hud.notice}</p>
	<div class="stick-zone" aria-hidden="true">Arraste para andar</div>
	<div bind:this={stickBase} class="stick-base" aria-hidden="true"></div>
	<div bind:this={stickThumb} class="stick-thumb" aria-hidden="true"></div>
	{#if hud.shiftLock}<div class="crosshair" aria-hidden="true">+</div>{/if}
	<div bind:this={sideButtons} class="side-buttons">
		<button
			type="button"
			data-game-button="shiftLock"
			aria-pressed={hud.shiftLock}
			onkeydown={keyboardButton}
			onkeyup={keyboardButton}
			onclick={(event) => activate(event, 'shiftLock')}>Travar câmera</button
		>
		<button
			type="button"
			data-game-button="emote"
			onkeydown={keyboardButton}
			onkeyup={keyboardButton}
			onclick={(event) => activate(event, 'emote')}>Acenar</button
		>
		<button
			type="button"
			data-game-button="action"
			onkeydown={keyboardButton}
			onkeyup={keyboardButton}
			onclick={(event) => activate(event, 'action')}>Explorar</button
		>
	</div>
	<button
		bind:this={jump}
		class="jump"
		type="button"
		data-game-button="jump"
		onkeydown={keyboardButton}
		onkeyup={keyboardButton}
		onclick={(event) => activate(event, 'jump')}>Pular</button
	>
	{#if hud.debug}
		<output class="debug" aria-label="Desempenho do jogo"
			>{hud.debug.fps.toFixed(0)} FPS · p95 {hud.debug.frameP95Ms.toFixed(1)} ms<br />{hud.debug.drawCalls} chamadas
			· {hud.debug.triangles} triângulos<br />DPR {hud.debug.dpr.toFixed(2)} · {hud.debug.quality}<br />{hud
				.debug.geometries} geometrias · {hud.debug.textures} texturas · {hud.debug.programs} programas</output
		>
	{/if}
</div>

<style>
	.secret-game {
		position: fixed;
		inset: 0;
		z-index: 50;
		width: 100%;
		height: 100dvh;
		overflow: hidden;
		background: #adc6b5;
		color: #f1f6ed;
		font: 0.875rem var(--font-ui, system-ui);
		touch-action: none;
		user-select: none;
		-webkit-touch-callout: none;
		outline-offset: -4px;
	}
	.world {
		position: absolute;
		inset: 0;
	}
	.top-bar {
		position: absolute;
		top: max(0.75rem, env(safe-area-inset-top));
		left: max(0.75rem, env(safe-area-inset-left));
		right: max(0.75rem, env(safe-area-inset-right));
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}
	button {
		min-height: 3rem;
		border: 1px solid #ffffff55;
		border-radius: 1rem;
		padding: 0.6rem 0.85rem;
		background: #173a2bed;
		color: #f1f6ed;
		font: inherit;
		font-weight: 700;
		touch-action: none;
		cursor: pointer;
	}
	button:focus-visible,
	.secret-game:focus-visible {
		outline: 3px solid #f6d968;
		outline-offset: 3px;
	}
	.notice {
		position: absolute;
		top: calc(max(0.75rem, env(safe-area-inset-top)) + 3.5rem);
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		width: min(80%, 32rem);
		text-align: center;
		padding: 0.4rem 0.6rem;
		border-radius: 0.6rem;
		background: #173a2bdc;
		pointer-events: none;
	}
	.side-buttons {
		position: absolute;
		right: max(0.75rem, env(safe-area-inset-right));
		bottom: 11rem;
		display: grid;
		gap: 0.4rem;
	}
	.jump {
		position: absolute;
		right: 25px;
		bottom: 20px;
		width: 70px;
		height: 70px;
		border-radius: 50%;
		background: #f1d364ed;
		color: #173a2b;
	}
	.stick-zone {
		position: absolute;
		left: 5%;
		bottom: 5%;
		max-width: 32%;
		pointer-events: none;
		color: #10271b;
		text-shadow: 0 1px #ffffff90;
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
	.crosshair {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		font-size: 1.5rem;
		color: #fff;
		text-shadow: 0 1px 2px #000;
		pointer-events: none;
	}
	.debug {
		position: absolute;
		top: 8rem;
		left: 0.75rem;
		padding: 0.5rem;
		background: #10271be8;
		font:
			0.7rem ui-monospace,
			monospace;
		pointer-events: none;
	}
	@media (orientation: landscape) and (max-height: 500px) {
		.side-buttons {
			bottom: 6.5rem;
			display: flex;
		}
		.notice {
			max-width: 58%;
		}
		.debug {
			top: 7rem;
		}
	}
</style>
