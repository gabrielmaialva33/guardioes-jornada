<!--
	The call to adventure: the first thing anyone sees. The forest grows while
	the story is read; no instructions come before it.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Step } from '#lib/content/types.ts';
	import ForestScene from './ForestScene.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		opening: Step;
		onaccept: () => void;
	}

	let { opening, onaccept }: Props = $props();

	// The forest grows once while the call is on screen.
	let grown = $state(0);
	onMount(() => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			grown = 5;
			return;
		}
		const timer = setInterval(() => {
			grown += 1;
			if (grown >= 5) clearInterval(timer);
		}, 520);
		return () => clearInterval(timer);
	});
</script>

<section class="calling" aria-labelledby="calling-title">
	<ForestScene missions={grown} oath={grown >= 5} label="Uma floresta da Mata Atlântica ganhando vida" />

	<div class="card story">
		<div class="emblem" aria-hidden="true"><Icon name={opening.icon} weight="duotone" size={44} /></div>
		<h1 id="calling-title">{opening.title}</h1>
		<p class="narrative">{opening.callout}</p>
	</div>

	<button class="button wide accept" type="button" onclick={onaccept}>
		<Icon name="leaf" weight="duotone" size={22} /> Aceitar o chamado
	</button>
</section>

<style>
	.calling {
		display: grid;
		gap: 1rem;
	}

	.story {
		display: grid;
		gap: 1rem;
		padding: 1.5rem 1.25rem 1.75rem;
	}

	.emblem {
		display: grid;
		place-items: center;
		justify-self: center;
		width: 5rem;
		height: 5rem;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 30%,
			color-mix(in oklab, var(--accent) 38%, transparent),
			var(--surface-sunken) 72%
		);
		color: var(--accent-strong);
		box-shadow: var(--highlight);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.55;
	}

	h1 {
		font-size: var(--step-3);
		text-align: center;
	}

	.narrative {
		font-family: var(--font-story);
		font-size: var(--step-1);
		line-height: 1.75;
		white-space: pre-line;
	}

	/* A page with a fixed bar at the bottom sets --sticky-bottom so the button stops above it. */
	.accept {
		position: sticky;
		bottom: var(--sticky-bottom, max(1rem, env(safe-area-inset-bottom)));
		font-size: var(--step-1);
		box-shadow:
			var(--highlight),
			0 8px 24px rgb(0 0 0 / 0.35);
	}
</style>
