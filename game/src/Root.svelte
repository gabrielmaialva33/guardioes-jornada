<script lang="ts">
	import { Canvas } from '@threlte/core';
	import type { WebGLRenderer } from 'three';
	import type { GameBridge } from '../abi.ts';
	import Placeholder from './scene/Placeholder.svelte';

	let {
		bridge,
		createRenderer
	}: {
		bridge: GameBridge;
		createRenderer: (canvas: HTMLCanvasElement) => WebGLRenderer;
	} = $props();
</script>

<div class="secret-game" data-game-root>
	<div class="world"><Canvas dpr={1} shadows={false} {createRenderer}><Placeholder /></Canvas></div>
	<div class="controls">
		<p>Uma clareira para novas aventuras.</p>
		<button type="button" onclick={() => bridge.earnBadge()}>Conquistar o emblema da prévia</button>
		<button type="button" onclick={() => bridge.exit()}>Voltar para a trilha secreta</button>
	</div>
</div>

<style>
	.secret-game {
		position: relative;
		height: min(75dvh, 42rem);
		min-height: 18rem;
		overflow: hidden;
		border-radius: 1rem;
		background: #102c20;
		color: #edf6ef;
		font: 1rem var(--font-ui, system-ui);
	}
	.world {
		position: absolute;
		inset: 0;
	}
	.controls {
		position: absolute;
		inset: auto 1rem 1rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	p {
		width: 100%;
		margin: 0;
	}
	button {
		min-height: 3rem;
		border: 0;
		border-radius: 0.8rem;
		padding: 0.65rem 1rem;
		background: #65b887;
		color: #10271b;
		font: inherit;
		cursor: pointer;
	}
	button:focus-visible {
		outline: 3px solid #edc957;
		outline-offset: 3px;
	}
</style>
