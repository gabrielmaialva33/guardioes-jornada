<!-- Drawings referenced by content files. "canela-and-cedro" comes from the original prototype. -->
<script lang="ts">
	import type { Step } from '#lib/content/types.ts';

	let { name }: { name: NonNullable<Step['illustration']> } = $props();
</script>

{#if name === 'canela-and-cedro'}
	<div class="pair">
		<figure>
			<svg viewBox="0 0 100 160" role="img" aria-label="Canela-preta">
				<defs>
					<radialGradient id="canela-canopy" cx="40%" cy="35%" r="65%">
						<stop offset="0%" stop-color="#2d6a4f" />
						<stop offset="60%" stop-color="#1b4332" />
						<stop offset="100%" stop-color="#0a1f15" />
					</radialGradient>
				</defs>
				<ellipse cx="50" cy="55" rx="40" ry="48" fill="url(#canela-canopy)" />
				<ellipse cx="34" cy="42" rx="14" ry="16" fill="#40916c" opacity="0.55" />
				<ellipse cx="62" cy="60" rx="11" ry="12" fill="#52b788" opacity="0.35" />
				<ellipse cx="50" cy="92" rx="32" ry="10" fill="#0a1f15" opacity="0.55" />
				<path d="M50 100 Q47 120 46 150 L54 150 Q53 120 50 100 Z" fill="#2c1810" />
				<path
					d="M50 108 Q40 118 33 138"
					stroke="#2c1810"
					stroke-width="2.5"
					fill="none"
					stroke-linecap="round"
				/>
				<path
					d="M50 112 Q60 122 67 140"
					stroke="#2c1810"
					stroke-width="2.5"
					fill="none"
					stroke-linecap="round"
				/>
				<ellipse cx="50" cy="155" rx="20" ry="3" fill="#000" opacity="0.25" />
			</svg>
			<figcaption><strong>Canela-preta</strong> casca escura que se solta em placas</figcaption>
		</figure>
		<figure>
			<svg viewBox="0 0 100 160" role="img" aria-label="Cedro-rosa">
				<defs>
					<linearGradient id="cedro-layer" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="#74c69d" />
						<stop offset="100%" stop-color="#40916c" />
					</linearGradient>
				</defs>
				<path d="M50 8 L24 52 L76 52 Z" fill="url(#cedro-layer)" />
				<path d="M50 32 L18 78 L82 78 Z" fill="url(#cedro-layer)" opacity="0.92" />
				<path d="M50 58 L14 108 L86 108 Z" fill="url(#cedro-layer)" opacity="0.85" />
				<path d="M50 110 Q47 128 46 150 L54 150 Q53 128 50 110 Z" fill="#5a3a25" />
				<path
					d="M50 118 Q42 128 36 145"
					stroke="#5a3a25"
					stroke-width="2.2"
					fill="none"
					stroke-linecap="round"
				/>
				<ellipse cx="50" cy="155" rx="22" ry="3" fill="#000" opacity="0.25" />
			</svg>
			<figcaption><strong>Cedro-rosa</strong> casca com rachaduras fundas</figcaption>
		</figure>
	</div>
{/if}

<style>
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	figure {
		display: grid;
		justify-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 1rem 0.5rem;
		border-radius: var(--radius-m);
		background: var(--surface-solid);
	}

	svg {
		width: min(100%, 7rem);
		height: auto;
	}

	figcaption {
		display: grid;
		text-align: center;
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	strong {
		color: var(--text);
		font-family: var(--font-story);
		font-size: var(--step-0);
	}
</style>
