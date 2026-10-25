<!-- Celebration after a mission or the oath: everything the class just earned, in one place. -->
<script lang="ts">
	import { feedback } from '#lib/feedback.ts';
	import type { Gains, Progress } from '#lib/session.ts';
	import ForestScene from './ForestScene.svelte';
	import Icon from './Icon.svelte';
	import LeafBurst from './LeafBurst.svelte';
	import Sheet from './Sheet.svelte';

	let { gains = $bindable(), progress }: { gains: Gains | null; progress: Progress } = $props();

	let open = $state(false);

	$effect(() => {
		if (!gains) return;
		open = true;
		feedback(gains.achievements.length > 0 || gains.rank ? 'achievement' : 'mission', 40);
	});

	$effect(() => {
		if (!open) gains = null;
	});

	const title = $derived(gains?.step.kind === 'oath' ? 'Juramento feito!' : 'Missão cumprida!');
	// Rank-ups and the oath are the big moments: gold leaves, and more of them.
	const big = $derived(!!gains && (gains.rank !== null || gains.step.kind === 'oath'));
</script>

<Sheet bind:open {title}>
	{#if gains}
		<div class="hero">
			<ForestScene missions={progress.missions} oath={progress.oath} compact label="A floresta cresceu" />
			{#key gains}<LeafBurst gold={big} count={big ? 30 : 18} />{/key}
		</div>
		<ul class="gains">
			{#if gains.step.power}
				<li>
					<Icon name="sparkle" weight="duotone" size={32} />
					<span class="label">Poder conquistado</span>
					<strong>{gains.step.power}</strong>
				</li>
			{/if}
			{#each gains.areas as area (area.id)}
				<li>
					<Icon name={area.icon} weight="duotone" size={32} />
					<span class="label">Nova área no mapa</span>
					<strong>{area.name}</strong>
				</li>
			{/each}
			{#each gains.achievements as achievement (achievement.id)}
				<li class="achievement">
					<Icon name="medal" weight="duotone" size={32} />
					<span class="label">Conquista</span>
					<strong>{achievement.name}</strong>
					<span>{achievement.description}</span>
				</li>
			{/each}
			{#if gains.rank}
				<li class="achievement">
					<Icon name="crown" weight="duotone" size={32} />
					<span class="label">Novo título</span>
					<strong>{gains.rank.name}</strong>
				</li>
			{/if}
		</ul>
	{/if}

	{#snippet actions()}
		<button class="button wide" type="button" onclick={() => (open = false)}>Continuar</button>
	{/snippet}
</Sheet>

<style>
	.hero {
		position: relative;
	}

	.gains {
		display: grid;
		gap: 0.6rem;
		margin: 0.75rem 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto auto;
		column-gap: 0.875rem;
		align-items: center;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.5;
		animation: pop 420ms var(--ease-spring) backwards;
	}

	li:nth-child(2) {
		animation-delay: 90ms;
	}
	li:nth-child(3) {
		animation-delay: 180ms;
	}
	li:nth-child(4) {
		animation-delay: 270ms;
	}

	li :global(.icon) {
		grid-row: 1 / -1;
	}

	.achievement {
		border-color: color-mix(in oklab, var(--gold) 45%, transparent);
		background: var(--gold-soft);
		color: var(--gold);
		--icon-tone: var(--accent);
	}

	.label {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	strong {
		color: var(--text);
		font-family: var(--font-story);
		font-size: var(--step-1);
		line-height: 1.15;
	}

	li > span:not(.label) {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.96);
		}
	}
</style>
