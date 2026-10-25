<!--
	The class's living forest. Paints the SVG first (prerendered, instant),
	then, on capable devices, loads the 3D scene in its own chunk and fades
	it in on top. Fills its parent.

	Only one diorama per page renders 3D at a time (the newest one, e.g. the
	gains sheet over the map); the others keep showing their SVG.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import DioramaSvg from './DioramaSvg.svelte';
	import { describe } from './describe.ts';
	import { getEngine, host, join, leave, type Seen } from './host.svelte.ts';
	import type { Engine } from './scene/createDiorama.ts';

	interface Props {
		/** Missions completed (0..5): each one grows a new layer of the forest. */
		missions: number;
		/** Oath taken: fireflies and a short celebration. */
		oath?: boolean;
		label?: string;
	}

	let { missions, oath = false, label = 'Paisagem da floresta' }: Props = $props();

	const stage = $derived(Math.max(0, Math.min(5, Math.floor(missions) || 0)));
	const reduced = new MediaQuery('(prefers-reduced-motion: reduce)');

	let id = $state(0);
	let from = $state<Seen | null>(null);
	let engine = $state.raw<Engine | null>(null);
	let ready = $state(false);
	const active = $derived(id !== 0 && host.tier !== 'svg' && host.active === id);

	onMount(() => {
		from = host.seen ?? { stage, oath };
		host.seen = { stage, oath };
		id = join();
		return () => {
			host.seen = { stage, oath };
			leave(id);
		};
	});

	/** Borrows the page's 3D canvas while this diorama is the active one. */
	function scene3d(el: HTMLElement) {
		let alive = true;
		let attached: Engine | null = null;
		const onTap = () => attached?.poke(reduced.current);
		el.addEventListener('click', onTap);
		untrack(getEngine)
			.then((e) => {
				if (!alive) return;
				attached = e;
				e.attach(el, { stage, oath, animate: !reduced.current }, from, () => {
					if (alive) ready = true;
				});
				engine = e;
			})
			.catch(() => {
				// No 3D on this device: the SVG stays.
			});
		return () => {
			alive = false;
			el.removeEventListener('click', onTap);
			attached?.detach(el);
			engine = null;
			ready = false;
		};
	}

	$effect(() => {
		const view = { stage, oath, animate: !reduced.current };
		engine?.update(view);
	});
</script>

<div class="diorama" role="img" aria-label="{label}. {describe(stage, oath)}">
	<DioramaSvg {stage} {oath} {from} hidden={active && ready} />
	{#if active}
		{#key host.generation}
			<div class="scene3d" class:ready {@attach scene3d}></div>
		{/key}
	{/if}
</div>

<style>
	.diorama {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		isolation: isolate;
	}

	/* The 3D canvas is transparent: the sky and the sun (a moon in Mata) are CSS. */
	.scene3d {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, var(--sky-top), var(--sky-bottom));
		opacity: 0;
		transition: opacity 520ms ease;
		-webkit-tap-highlight-color: transparent;
	}

	.scene3d::before {
		content: '';
		position: absolute;
		left: 82.5%;
		top: 23%;
		height: 16%;
		aspect-ratio: 1;
		translate: -50% -50%;
		border-radius: 50%;
		background: var(--sun);
		box-shadow: 0 0 2.2em 0.6em color-mix(in srgb, var(--sun) 28%, transparent);
	}

	.scene3d.ready {
		opacity: 1;
	}
</style>
