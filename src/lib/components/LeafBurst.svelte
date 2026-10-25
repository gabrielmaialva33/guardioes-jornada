<!--
	A short shower of leaves for celebrations: green for a mission, gold for a
	rank-up or the oath. CSS only, about 1.5 s, and nothing at all when the
	phone asks for reduced motion.
-->
<script lang="ts">
	let { gold = false, count = 18 }: { gold?: boolean; count?: number } = $props();

	// Fixed pseudo-random layout so every celebration looks alike and costs nothing.
	const leaves = $derived(
		Array.from({ length: count }, (_, i) => {
			const r = (n: number) => ((Math.sin((i + 1) * n) + 1) / 2) % 1;
			return {
				x: Math.round(r(12.9898) * 100),
				delay: Math.round(r(78.233) * 350),
				drift: Math.round((r(39.346) - 0.5) * 120),
				spin: Math.round((r(11.135) - 0.5) * 720),
				size: 10 + Math.round(r(5.71) * 10),
				tone: i % 3
			};
		})
	);
</script>

<div class="burst" class:gold aria-hidden="true">
	{#each leaves as leaf, i (i)}
		<svg
			viewBox="0 0 24 24"
			width={leaf.size}
			height={leaf.size}
			style:left="{leaf.x}%"
			style:--delay="{leaf.delay}ms"
			style:--drift="{leaf.drift}px"
			style:--spin="{leaf.spin}deg"
			data-tone={leaf.tone}
		>
			<path d="M12 2C6 6 4 12 6 18c1 2 3 3 6 4 3-1 5-2 6-4 2-6 0-12-6-16Zm0 4v14" />
		</svg>
	{/each}
</div>

<style>
	.burst {
		position: absolute;
		inset: 0 0 auto;
		height: 60%;
		overflow: hidden;
		pointer-events: none;
	}

	svg {
		position: absolute;
		top: -24px;
		fill: var(--accent);
		stroke: color-mix(in oklab, var(--accent) 60%, black);
		stroke-width: 1;
		opacity: 0;
		animation: fall 1.5s cubic-bezier(0.3, 0.6, 0.5, 1) var(--delay) forwards;
	}

	svg[data-tone='1'] {
		fill: var(--canopy-light);
	}

	svg[data-tone='2'] {
		fill: var(--success);
	}

	.gold svg {
		fill: var(--gold);
		stroke: color-mix(in oklab, var(--gold) 55%, black);
	}

	.gold svg[data-tone='1'] {
		fill: var(--accent);
	}

	@keyframes fall {
		0% {
			opacity: 0;
			transform: translate(0, 0) rotate(0);
		}
		15% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(var(--drift), 280px) rotate(var(--spin));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.burst {
			display: none;
		}
	}
</style>
