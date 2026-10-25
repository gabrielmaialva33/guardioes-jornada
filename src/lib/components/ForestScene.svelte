<!--
	The class's living forest: a low-poly 3D diorama that grows with each
	mission, loaded on demand over an SVG of the same scene. The SVG stays as the
	fallback on weak phones or without WebGL; with reduced motion the 3D scene
	changes stage without animating.
-->
<script lang="ts">
	import Diorama from '#lib/diorama/Diorama.svelte';

	interface Props {
		missions: number;
		oath?: boolean;
		label?: string;
		compact?: boolean;
	}

	let { missions, oath = false, label, compact = false }: Props = $props();
</script>

<figure class="scene card" class:compact>
	<Diorama {missions} {oath} {label} />
</figure>

<style>
	.scene {
		margin: 0;
		overflow: hidden;
		padding: 0;
		aspect-ratio: 2 / 1;
		max-height: max(9rem, 40dvh);
	}

	.scene :global(svg) {
		width: 100%;
		height: 100%;
	}

	.compact {
		border-radius: var(--radius-s);
		box-shadow: none;
	}
</style>
