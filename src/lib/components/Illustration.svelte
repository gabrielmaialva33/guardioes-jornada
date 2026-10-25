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
				<!-- Dark bark that flakes off in plates, leaving concave scars. -->
				<path d="M50 98 Q46 120 45 150 L55 150 Q54 120 50 98 Z" fill="#3b2d26" />
				<ellipse cx="48.4" cy="118" rx="1.8" ry="3" fill="#6b5a50" opacity="0.8" />
				<ellipse cx="52.4" cy="130" rx="1.6" ry="2.6" fill="#6b5a50" opacity="0.8" />
				<ellipse cx="48" cy="141" rx="1.5" ry="2.4" fill="#6b5a50" opacity="0.8" />
				<path
					d="M50 108 Q40 118 33 138"
					stroke="#3b2d26"
					stroke-width="2.5"
					fill="none"
					stroke-linecap="round"
				/>
				<path
					d="M50 112 Q60 122 67 140"
					stroke="#3b2d26"
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
					<linearGradient id="cedro-crown" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="#74c69d" />
						<stop offset="100%" stop-color="#2d6a4f" />
					</linearGradient>
				</defs>
				<!-- A broadleaf, not a conifer: tall straight trunk, wide open crown. -->
				<path d="M50 56 Q46 110 44 150 L56 150 Q54 110 50 56 Z" fill="#6b4a33" />
				<path
					d="M50 70 Q40 60 30 48 M50 66 Q61 57 71 46"
					stroke="#6b4a33"
					stroke-width="2.6"
					fill="none"
					stroke-linecap="round"
				/>
				<!-- Deep lengthwise fissures in the bark. -->
				<path
					d="M48 80 Q47.5 112 46.6 148 M50.4 76 Q50.6 112 50.2 148 M52.6 84 Q53 116 53.6 148"
					stroke="#3b2416"
					stroke-width="0.9"
					fill="none"
					stroke-linecap="round"
				/>
				<ellipse cx="50" cy="44" rx="45" ry="20" fill="url(#cedro-crown)" />
				<ellipse cx="25" cy="38" rx="20" ry="14" fill="url(#cedro-crown)" />
				<ellipse cx="74" cy="36" rx="21" ry="15" fill="url(#cedro-crown)" />
				<ellipse cx="50" cy="28" rx="21" ry="13" fill="#74c69d" opacity="0.75" />
				<!-- Compound leaves: pairs of leaflets along a stalk. -->
				<g fill="#52b788" stroke="#2d6a4f" stroke-width="0.5">
					<g transform="translate(12 52) rotate(28)">
						<line x1="0" y1="0" x2="0" y2="15" />
						<ellipse cx="-2.6" cy="4" rx="2.6" ry="1.2" />
						<ellipse cx="2.6" cy="4" rx="2.6" ry="1.2" />
						<ellipse cx="-2.6" cy="8.5" rx="2.6" ry="1.2" />
						<ellipse cx="2.6" cy="8.5" rx="2.6" ry="1.2" />
						<ellipse cx="-2.4" cy="13" rx="2.4" ry="1.1" />
						<ellipse cx="2.4" cy="13" rx="2.4" ry="1.1" />
					</g>
					<g transform="translate(88 50) rotate(-28)">
						<line x1="0" y1="0" x2="0" y2="15" />
						<ellipse cx="-2.6" cy="4" rx="2.6" ry="1.2" />
						<ellipse cx="2.6" cy="4" rx="2.6" ry="1.2" />
						<ellipse cx="-2.6" cy="8.5" rx="2.6" ry="1.2" />
						<ellipse cx="2.6" cy="8.5" rx="2.6" ry="1.2" />
						<ellipse cx="-2.4" cy="13" rx="2.4" ry="1.1" />
						<ellipse cx="2.4" cy="13" rx="2.4" ry="1.1" />
					</g>
				</g>
				<!-- Woody fruits that open in five parts. -->
				<g fill="#8a5a3b" stroke="#3b2416" stroke-width="0.6" stroke-linejoin="round">
					<line x1="32" y1="58" x2="32" y2="62" />
					<polygon
						transform="translate(32 65)"
						points="0,-3.6 0.88,-1.21 3.42,-1.11 1.43,0.46 2.12,2.91 0,1.5 -2.12,2.91 -1.43,0.46 -3.42,-1.11 -0.88,-1.21"
					/>
					<line x1="66" y1="58" x2="66" y2="61" />
					<polygon
						transform="translate(66 64)"
						points="0,-3.6 0.88,-1.21 3.42,-1.11 1.43,0.46 2.12,2.91 0,1.5 -2.12,2.91 -1.43,0.46 -3.42,-1.11 -0.88,-1.21"
					/>
				</g>
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
