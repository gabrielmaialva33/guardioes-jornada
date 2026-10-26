<script lang="ts">
	import { untrack } from 'svelte';
	import { golden } from '../../scene/golden.ts';
	import { ACCENT, LIGHT, RAMPS } from '../../style/palette.ts';
	import { FACTS, factIndex } from './facts.ts';
	import type { LoadingProgress, LoadingSnapshot } from './loading.ts';
	import { ARAUCARIA, crowns, FRONDS, mix } from './scenery.ts';

	let {
		model,
		firstFact = 0,
		onexit,
		ondone
	}: {
		model: LoadingProgress;
		/** Index of the first "Você sabia?" fact; the loader picks one at random. */
		firstFact?: number;
		onexit?: () => void;
		/** After the fade-out: the owner unmounts the screen. */
		ondone?: () => void;
	} = $props();

	let view: LoadingSnapshot = $state(untrack(() => model.update()));
	let frame = 0;
	const tick = () => {
		view = model.update();
		if (view.phase === 'done') {
			frame = 0;
			ondone?.();
		} else frame = requestAnimationFrame(tick);
	};
	$effect(() => {
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});

	const fact = $derived(FACTS[factIndex(view.elapsed, firstFact)]);
	const sky = LIGHT.daylight;
	// Aerial perspective: the farther the ridge, the more it takes the sky's colour.
	const colors = [
		`--sky-top:${sky.skyTop}`,
		`--horizon:${sky.horizon}`,
		`--sun:${sky.sun}`,
		`--far:${mix(RAMPS.leaf[2], sky.hemisphereSky, 0.62)}`,
		`--mid:${mix(RAMPS.leaf[2], sky.hemisphereSky, 0.32)}`,
		`--back:${RAMPS.leaf[1]}`,
		`--front:${RAMPS.leaf[0]}`,
		`--soil:${RAMPS.soil[1]}`,
		`--soil-light:${RAMPS.soil[3]}`,
		`--print:${RAMPS.soil[0]}`,
		`--gold:${ACCENT.gold}`,
		`--ink:${RAMPS.leaf[0]}`,
		`--fur:#ffa828`,
		`--fur-shade:#d97214`,
		`--face:#6e565e`
	].join(';');
	const back = crowns(7, 300, 26, 46, 1200);
	const front = crowns(3, 352, 34, 60, 1200);
	// Spread so a phone in portrait (the middle third of the scene) still sees each kind.
	const araucarias = [470, 1040, 90];
	const palms = [735, 250];
	const ridge = [
		[505, 246],
		[548, 240],
		[778, 206],
		[1010, 238]
	];
</script>

{#if !golden.enabled}
	<div
		class="loading"
		class:leaving={view.phase === 'leaving'}
		class:done={view.phase === 'done'}
		style={colors}
		style:--p={view.fraction}
		data-phase={view.phase}
	>
		<div class="sky" aria-hidden="true"></div>
		<svg class="land far" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
			<path
				d="M0 400V214C80 192 140 150 220 160S360 118 430 138 560 200 640 170 780 98 860 120 1000 172 1080 150 1170 140 1200 150V400Z"
			/>
		</svg>
		<svg class="land mid" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
			<path d="M0 400V262C100 240 180 208 280 226S450 272 560 240 760 188 880 214 1080 262 1200 230V400Z" />
			<!-- Araucárias standing out on the ridge, far away. -->
			{#each ridge as [x, y] (x)}<path transform="translate({x} {y - 119}) scale(0.42)" d={ARAUCARIA} />{/each}
		</svg>
		<svg class="land back" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
			{#each back as [x, y, r] (x)}<circle cx={x} cy={y} {r} />{/each}
			<rect y="300" width="1200" height="100" />
			{#each araucarias as x (x)}<path transform="translate({x} 0)" d={ARAUCARIA} />{/each}
			{#each palms as x (x)}<g transform="translate({x} 0)"
					><path d="M-3 320V176h6v144Z" /><path class="fronds" d={FRONDS} /></g
				>{/each}
		</svg>
		<svg class="land front" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
			{#each front as [x, y, r] (x)}<circle cx={x} cy={y} {r} />{/each}
			<rect y="352" width="1200" height="48" />
		</svg>

		<div class="content">
			<header>
				<h1>Trilha secreta</h1>
				{#if view.phase !== 'error'}<p class="stage">{view.label}…</p>{/if}
			</header>
			{#if view.phase === 'error'}
				<section class="card" role="alert">
					{#if view.error === 'unsupported'}
						<p>Este aparelho não consegue abrir o mundo 3D da trilha. Sua jornada continua no app!</p>
						<div class="actions"><button type="button" onclick={() => onexit?.()}>Voltar</button></div>
					{:else}
						<p>Não foi possível abrir a clareira.</p>
						<div class="actions">
							<button type="button" onclick={() => model.retry()}>Tentar de novo</button>
							<button class="quiet" type="button" onclick={() => onexit?.()}>Sair</button>
						</div>
					{/if}
				</section>
			{:else}
				<section class="card" aria-label="Você sabia?">
					<p class="chip" aria-hidden="true">Você sabia?</p>
					{#key fact}<p class="fact">{fact.text}</p>{/key}
				</section>
			{/if}
		</div>

		<div
			class="trail"
			role="progressbar"
			aria-label="Carregando a trilha"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={view.percent}
			aria-valuetext={`${view.label}: ${view.percent}%`}
		>
			<div class="path"></div>
			<div class="prints"></div>
			<svg class="mico" viewBox="0 0 48 34" aria-hidden="true">
				<path class="tail" d="M10 18C3 19 0 25 2 33" />
				<g class="legs back-legs"
					><rect x="12" y="22" width="4" height="9" rx="2" /><rect
						x="30"
						y="22"
						width="4"
						height="9"
						rx="2"
					/></g
				>
				<g class="body">
					<ellipse cx="22" cy="19" rx="13" ry="7" />
					<circle class="mane" cx="36" cy="13" r="9" />
					<ellipse class="face" cx="39" cy="14" rx="3.6" ry="4.4" />
					<circle class="eye" cx="40" cy="12.6" r="0.9" />
				</g>
				<g class="legs front-legs"
					><rect x="16" y="22" width="4" height="9" rx="2" /><rect
						x="26"
						y="22"
						width="4"
						height="9"
						rx="2"
					/></g
				>
			</svg>
		</div>
	</div>
{/if}

<style>
	.loading {
		--trail: 3.5rem;
		--gutter: 16px;
		position: fixed;
		inset: 0;
		z-index: 60;
		overflow: hidden;
		background: var(--horizon);
		color: var(--ink);
		font-family: var(--font-ui, 'Atkinson Hyperlegible Next Variable', system-ui, sans-serif);
		opacity: 1;
		transition: opacity 400ms ease-out;
		user-select: none;
	}
	.leaving {
		opacity: 0;
	}
	.done {
		visibility: hidden;
		pointer-events: none;
	}

	.sky {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(circle at 78% 22%, var(--sun) 0 3.5rem, transparent 3.6rem),
			radial-gradient(
				circle at 78% 22%,
				color-mix(in srgb, var(--sun) 55%, transparent) 0,
				transparent 11rem
			),
			linear-gradient(var(--sky-top), var(--horizon) 70%);
	}

	.land {
		position: absolute;
		left: -3%;
		bottom: calc(var(--trail) + env(safe-area-inset-bottom) - 1px);
		width: 106%;
		height: min(50%, 100vw);
		animation: drift 18s ease-in-out infinite alternate;
	}
	.far {
		fill: var(--far);
		animation-duration: 26s;
	}
	.mid {
		fill: var(--mid);
		animation-duration: 21s;
	}
	.back {
		fill: var(--back);
	}
	.back .fronds {
		fill: none;
		stroke: var(--back);
		stroke-width: 6;
		stroke-linecap: round;
	}
	.front {
		fill: var(--front);
		animation-duration: 13s;
	}
	@keyframes drift {
		to {
			transform: translateX(2.5%);
		}
	}

	.content {
		position: absolute;
		inset: 0 0 var(--trail);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: clamp(1rem, 4vh, 2rem);
		padding: max(var(--gutter), env(safe-area-inset-top)) max(var(--gutter), env(safe-area-inset-right)) 18vh
			max(var(--gutter), env(safe-area-inset-left));
		text-align: center;
	}
	h1 {
		margin: 0;
		font-family: var(--font-story, 'Alegreya Variable', Georgia, serif);
		font-size: clamp(2.1rem, 7vw + 0.5rem, 3.6rem);
		line-height: 1;
		letter-spacing: 0.01em;
		text-shadow: 0 1px 0 color-mix(in srgb, var(--horizon) 70%, transparent);
	}
	.stage {
		margin: 0.5rem 0 0;
		font-size: 1.05rem;
		font-weight: 600;
	}

	.card {
		box-sizing: border-box;
		width: min(100%, 30rem);
		padding: 1rem 1.25rem 1.1rem;
		border-radius: 1.25rem;
		background: color-mix(in srgb, var(--horizon) 88%, transparent);
		box-shadow: 0 0.5rem 1.5rem color-mix(in srgb, var(--ink) 22%, transparent);
	}
	.card p {
		margin: 0;
		font-size: 1.05rem;
		line-height: 1.4;
		text-wrap: pretty;
	}
	.chip {
		display: inline-block;
		margin-bottom: 0.5rem !important;
		padding: 0.15rem 0.7rem;
		border-radius: 999px;
		background: var(--gold);
		font-size: 0.85rem !important;
		font-weight: 700;
	}
	.fact {
		min-height: 2.8em;
		animation: fact-in 500ms ease-out;
	}
	@keyframes fact-in {
		from {
			opacity: 0;
			transform: translateY(0.4rem);
		}
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	button {
		min-height: var(--tap, 48px);
		min-width: var(--tap, 48px);
		padding: 0 1.4rem;
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		color: var(--horizon);
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
	button.quiet {
		background: transparent;
		color: var(--ink);
		box-shadow: inset 0 0 0 2px var(--ink);
	}
	button:focus-visible {
		outline: 3px solid var(--gold);
		outline-offset: 3px;
	}

	/* The trail runs along the bottom; the mico walks it and leaves prints behind. */
	.trail {
		--mico: 3rem;
		--reach: calc((100% - var(--mico)) * var(--p));
		position: absolute;
		inset: auto 0 0;
		height: calc(var(--trail) + env(safe-area-inset-bottom));
		padding: 0 max(var(--gutter), env(safe-area-inset-right)) env(safe-area-inset-bottom)
			max(var(--gutter), env(safe-area-inset-left));
		box-sizing: border-box;
		background: var(--soil);
	}
	.path,
	.prints,
	.mico {
		position: absolute;
	}
	.path {
		left: max(var(--gutter), env(safe-area-inset-left));
		right: max(var(--gutter), env(safe-area-inset-right));
		top: 1.6rem;
		height: 0.25rem;
		border-radius: 1rem;
		background: repeating-linear-gradient(90deg, var(--soil-light) 0 0.8rem, transparent 0.8rem 1.4rem);
		opacity: 0.6;
	}
	.prints,
	.mico {
		--track: calc(
			100% - max(var(--gutter), env(safe-area-inset-left)) - max(var(--gutter), env(safe-area-inset-right))
		);
	}
	.prints {
		left: max(var(--gutter), env(safe-area-inset-left));
		top: 1rem;
		height: 1.5rem;
		width: calc((var(--track) - var(--mico)) * var(--p) + var(--mico) * 0.3);
		background:
			radial-gradient(ellipse 0.22rem 0.16rem at 0.4rem 0.35rem, var(--print) 98%, transparent) 0 0 / 1.6rem
				1.5rem repeat-x,
			radial-gradient(ellipse 0.22rem 0.16rem at 1.2rem 1.1rem, var(--print) 98%, transparent) 0 0 / 1.6rem
				1.5rem repeat-x;
		-webkit-mask: linear-gradient(90deg, transparent, #000 2rem);
		mask: linear-gradient(90deg, transparent, #000 2rem);
	}
	/* `left`, not a translate: a percentage in translate is the mico's own width, not the trail's. */
	.mico {
		left: calc(max(var(--gutter), env(safe-area-inset-left)) + (var(--track) - var(--mico)) * var(--p));
		top: -0.85rem;
		width: var(--mico);
		overflow: visible;
	}
	.mico .body,
	.mico .legs {
		fill: var(--fur);
	}
	.mico .back-legs {
		fill: var(--fur-shade);
	}
	.mico .mane {
		fill: var(--fur);
	}
	.mico .face {
		fill: var(--face);
	}
	.mico .eye {
		fill: var(--horizon);
	}
	.mico .tail {
		fill: none;
		stroke: var(--fur-shade);
		stroke-width: 3;
		stroke-linecap: round;
		transform-origin: 8px 20px;
		animation: tail 0.9s ease-in-out infinite alternate;
	}
	.mico .body {
		animation: bob 0.36s ease-in-out infinite alternate;
	}
	.mico .legs rect {
		transform-box: fill-box;
		transform-origin: 50% 0;
		animation: step 0.36s ease-in-out infinite alternate;
	}
	.mico .legs rect:nth-child(2),
	.mico .front-legs rect:first-child {
		animation-direction: alternate-reverse;
	}
	@keyframes bob {
		to {
			transform: translateY(-1.5px);
		}
	}
	@keyframes step {
		from {
			transform: rotate(-24deg);
		}
		to {
			transform: rotate(24deg);
		}
	}
	@keyframes tail {
		to {
			transform: rotate(-12deg);
		}
	}

	/* Phones in landscape: title and card side by side, the forest lower. */
	@media (orientation: landscape) and (max-height: 520px) {
		.loading {
			--trail: 3rem;
		}
		.land {
			height: 46%;
		}
		.content {
			flex-direction: row;
			justify-content: center;
			gap: 1.5rem;
			padding-bottom: 6vh;
			text-align: left;
		}
		header {
			flex: 0 1 auto;
			padding: 0.5rem 0.9rem;
			border-radius: 1rem;
			background: color-mix(in srgb, var(--horizon) 80%, transparent);
		}
		h1 {
			font-size: clamp(1.7rem, 5vw, 2.4rem);
		}
		.card {
			width: min(55%, 26rem);
			padding: 0.8rem 1rem;
		}
		.card p {
			font-size: 0.95rem;
		}
		.trail {
			--mico: 2.6rem;
		}
		.path {
			top: 1.35rem;
		}
		.prints {
			top: 0.8rem;
		}
		.mico {
			top: -0.7rem;
		}
	}

	/* Reduced motion: nothing walks or drifts; only the bar (mico position and prints) moves. */
	@media (prefers-reduced-motion: reduce) {
		.loading *,
		.loading *::before {
			animation: none !important;
		}
	}
</style>
