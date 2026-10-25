<!--
	SVG version of the diorama (same composition as Landscape.svelte): the
	first paint, the fallback when 3D is off, and what inactive dioramas show
	while another one holds the page's single WebGL canvas. Decorative: the
	text alternative lives on <Diorama>.
-->
<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		stage: number;
		oath?: boolean;
		/** Grow from this state on mount (CSS transitions), e.g. in the gains sheet. */
		from?: { stage: number; oath: boolean } | null;
		hidden?: boolean;
	}

	let { stage, oath = false, from = null, hidden = false }: Props = $props();

	const uid = $props.id();
	let mounted = $state(false);
	onMount(() => {
		// One frame at the previous state, then let the transitions grow it.
		const id = requestAnimationFrame(() => (mounted = true));
		return () => cancelAnimationFrame(id);
	});

	const shownStage = $derived(!mounted && from && from.stage < stage ? from.stage : stage);
	const shownOath = $derived(!mounted && from && !from.oath ? false : oath);
	const has = (n: number) => shownStage >= n;

	const backForest = [
		{ x: 18, y: 138, r: 14, tone: 'dark' },
		{ x: 42, y: 136, r: 12, tone: 'mid' },
		{ x: 66, y: 139, r: 15, tone: 'dark' },
		{ x: 226, y: 134, r: 13, tone: 'mid' },
		{ x: 252, y: 132, r: 16, tone: 'dark' },
		{ x: 300, y: 137, r: 12, tone: 'mid' },
		{ x: 356, y: 133, r: 15, tone: 'dark' },
		{ x: 384, y: 131, r: 12, tone: 'mid' }
	];

	const trees: { kind: 'canela' | 'cedro'; x: number; y: number; s: number }[] = [
		{ kind: 'cedro', x: 118, y: 150, s: 0.9 },
		{ kind: 'canela', x: 150, y: 152, s: 1 },
		{ kind: 'canela', x: 322, y: 150, s: 0.85 },
		{ kind: 'cedro', x: 352, y: 154, s: 1.05 }
	];

	const fireflies = [
		{ x: 60, y: 112, d: 0 },
		{ x: 104, y: 128, d: 0.8 },
		{ x: 182, y: 104, d: 1.6 },
		{ x: 214, y: 140, d: 0.4 },
		{ x: 316, y: 110, d: 1.2 },
		{ x: 340, y: 132, d: 2 },
		{ x: 378, y: 118, d: 0.6 },
		{ x: 150, y: 120, d: 1.4 }
	];
</script>

<svg
	class="diorama-svg"
	class:hidden
	viewBox="0 0 400 200"
	preserveAspectRatio="xMidYMax slice"
	aria-hidden="true"
	focusable="false"
>
	<defs>
		<linearGradient id="{uid}-sky" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" style="stop-color: var(--sky-top)" />
			<stop offset="1" style="stop-color: var(--sky-bottom)" />
		</linearGradient>
	</defs>

	<rect width="400" height="200" fill="url(#{uid}-sky)" />
	<circle cx="330" cy="46" r="16" class="sun" />

	<g class="layer rise" class:shown={has(4)}>
		<path
			d="M0 122 L36 98 L70 112 L112 76 L150 104 L196 84 L240 108 L286 70 L330 100 L370 86 L400 96 V200 H0Z"
			class="hill-far"
		/>
	</g>

	<path d="M0 148 C60 134 120 140 180 136 C250 131 320 142 400 132 V200 H0Z" class="hill" />

	<g class="layer grow" class:shown={has(3)}>
		{#each backForest as t (t.x)}
			<circle cx={t.x} cy={t.y} r={t.r} class={t.tone === 'dark' ? 'canopy-dark' : 'canopy'} />
		{/each}
	</g>

	<g class="layer" class:shown={has(2)}>
		<path d="M38 146 C70 150 82 160 112 165 C150 171 150 186 188 200" class="river" />
		<path d="M38 146 C70 150 82 160 112 165 C150 171 150 186 188 200" class="river-shine" />
		<circle cx="38" cy="146" r="3.5" class="spring" />
	</g>

	<g class="layer" class:shown={has(1)}>
		<path d="M300 200 C290 186 250 184 242 172 C234 162 248 156 238 146" class="trail" />
		{#each trees as t (t.x)}
			<g transform="translate({t.x} {t.y}) scale({t.s})">
				<g class="tree">
					{#if t.kind === 'canela'}
						<path d="M-1.6 0 L-1 -14 L1 -14 L1.6 0Z" class="bark" />
						<ellipse cx="0" cy="-23" rx="11" ry="13" class="canopy-dark" />
						<ellipse cx="-4" cy="-27" rx="4" ry="5" class="canopy" />
					{:else}
						<path d="M-1.2 0 L-0.8 -9 L0.8 -9 L1.2 0Z" class="bark" />
						<path d="M0 -38 L-8 -25 L8 -25Z" class="canopy-light" />
						<path d="M0 -31 L-10 -17 L10 -17Z" class="canopy-light" />
						<path d="M0 -23 L-12 -8 L12 -8Z" class="canopy-light" />
						<circle cx="-4" cy="-20" r="1.3" class="blossom" />
						<circle cx="5" cy="-14" r="1.3" class="blossom" />
						<circle cx="-6" cy="-11" r="1.2" class="blossom" />
					{/if}
				</g>
			</g>
		{/each}
	</g>

	<path d="M0 176 C90 168 170 182 260 174 C320 169 360 176 400 172 V200 H0Z" class="ground" />
	<circle cx="40" cy="186" r="2" class="blossom" />
	<circle cx="54" cy="190" r="1.6" class="sun" />
	<circle cx="352" cy="188" r="2" class="blossom" />
	<circle cx="368" cy="184" r="1.6" class="sun" />

	<g class="layer fade" class:shown={has(3)}>
		<path d="M196 58 q5 -5 10 0 q5 -5 10 0" class="bird" />
		<path d="M222 70 q4 -4 8 0 q4 -4 8 0" class="bird" />
		<path d="M176 74 q3.5 -3.5 7 0 q3.5 -3.5 7 0" class="bird" />
	</g>

	<g class="layer grow" class:shown={has(5)}>
		<circle cx="270" cy="110" r="44" class="glow" />
		<g transform="translate(270 176)">
			<path d="M-2.6 0 L-1.4 -80 L1.4 -80 L2.6 0Z" class="bark" />
			<path d="M-38 -64 Q0 -44 38 -64 L33 -69 Q0 -54 -33 -69Z" class="canopy-dark" />
			<path d="M-30 -74 Q0 -57 30 -74 L25 -79 Q0 -66 -25 -79Z" class="canopy" />
			<path d="M-20 -83 Q0 -71 20 -83 L15 -88 Q0 -79 -15 -88Z" class="canopy-light" />
		</g>
	</g>

	<g class="layer fade" class:shown={shownOath}>
		{#each fireflies as f (f.x)}
			<circle cx={f.x} cy={f.y} r="1.8" class="firefly" style="animation-delay: {f.d}s" />
		{/each}
	</g>
</svg>

<style>
	.diorama-svg {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Stays visible until the 3D canvas has faded in over it. */
	.hidden {
		visibility: hidden;
		transition: visibility 0s linear 560ms;
	}

	.sun {
		fill: var(--sun);
	}
	.hill-far {
		fill: var(--hill-far);
	}
	.hill {
		fill: var(--hill);
	}
	.ground {
		fill: var(--ground);
	}
	.bark {
		fill: var(--bark);
	}
	.canopy-dark {
		fill: var(--canopy-dark);
	}
	.canopy {
		fill: var(--canopy);
	}
	.canopy-light {
		fill: var(--canopy-light);
	}
	.blossom {
		fill: var(--blossom);
	}
	.spring {
		fill: var(--water);
	}
	.glow {
		fill: var(--sun);
		opacity: 0.18;
	}

	.river {
		fill: none;
		stroke: var(--water);
		stroke-width: 6;
		stroke-linecap: round;
	}

	.river-shine {
		fill: none;
		stroke: #fff;
		stroke-opacity: 0.45;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-dasharray: 5 16;
		animation: flow 4s linear infinite;
	}

	.trail {
		fill: none;
		stroke: var(--bark);
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-dasharray: 1 6;
	}

	.bird {
		fill: none;
		stroke: var(--text-soft);
		stroke-width: 1.4;
		stroke-linecap: round;
	}

	.firefly {
		fill: var(--gold);
		animation: twinkle 2.4s ease-in-out infinite;
	}

	/* Layers appear when the class unlocks them. */
	.layer {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: 50% 100%;
		transition:
			opacity 700ms ease,
			transform 1100ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.layer.rise {
		transform: translateY(18px);
	}
	.layer.grow {
		transform: scaleY(0.15);
	}
	.layer.shown {
		opacity: 1;
		transform: none;
	}

	.tree {
		transform-box: fill-box;
		transform-origin: 50% 100%;
		transform: scale(0.2);
		transition: transform 1100ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	.shown .tree {
		transform: none;
	}

	/* Hidden behind the 3D canvas: no point animating. */
	.hidden .river-shine,
	.hidden .firefly {
		animation: none;
	}

	@keyframes flow {
		to {
			stroke-dashoffset: -42;
		}
	}

	@keyframes twinkle {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}
</style>
