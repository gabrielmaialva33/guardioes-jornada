<!--
	The class's living forest: a low-poly 3D diorama that grows with each
	mission, loaded on demand over an SVG of the same scene. The SVG stays as the
	fallback on weak phones or without WebGL; with reduced motion the 3D scene
	changes stage without animating.
-->
<script lang="ts">
	import Diorama from '#lib/diorama/Diorama.svelte';
	import { secretGesture } from '#lib/secret-gesture.ts';
	import SecretTrailSheet from './SecretTrailSheet.svelte';

	interface Props {
		missions: number;
		oath?: boolean;
		label?: string;
		compact?: boolean;
		/** Hides the Secret Trail in this forest (long press, five taps or the Konami code). */
		secret?: boolean;
	}

	let { missions, oath = false, label, compact = false, secret = false }: Props = $props();
	let found = $state(false);
</script>

<figure class="scene card" class:compact class:secret {@attach secret && secretGesture(() => (found = true))}>
	<Diorama {missions} {oath} {label} />
</figure>
{#if secret}
	<SecretTrailSheet bind:open={found} />
{/if}

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

	/* Taps and presses reach the secret: no double-tap zoom, callout or text selection. */
	.secret {
		touch-action: manipulation;
		-webkit-touch-callout: none;
		user-select: none;
	}
</style>
