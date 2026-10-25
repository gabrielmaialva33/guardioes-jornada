<!-- The current step, as the guide reads it to the class. -->
<script lang="ts">
	import type { Journey, Step } from '#lib/content/types.ts';
	import { missionCount, missionNumber, type Session } from '#lib/session.ts';
	import Checklist from './Checklist.svelte';
	import Icon from './Icon.svelte';
	import Illustration from './Illustration.svelte';
	import ScorePanel from './ScorePanel.svelte';
	import Timer from './Timer.svelte';
	import TreeCards from './TreeCards.svelte';

	interface Props {
		session: Session;
		journey: Journey;
		step: Step;
	}

	let { session, journey, step }: Props = $props();

	const number = $derived(missionNumber(journey, step.id));
	const total = $derived(missionCount(journey));
	const open = $derived(step.kind !== 'mission' || session.revealed);
	const tag = $derived(
		step.kind === 'opening'
			? 'Introdução'
			: step.kind === 'oath'
				? 'Juramento'
				: `Missão ${number} de ${total}`
	);
</script>

<article class="card step" data-kind={step.kind} class:closed={!open}>
	<header>
		<span class="pill" class:gold={step.kind === 'oath'}>{tag}</span>
		{#if step.power && open}
			<span class="pill gold"><Icon name="sparkle" weight="fill" size={14} /> {step.power}</span>
		{/if}
	</header>

	<div class="emblem" aria-hidden="true">
		<Icon name={step.icon} weight="duotone" size={step.kind === 'opening' ? 44 : 52} />
	</div>

	<h2>{step.title}</h2>

	{#if !open}
		<p class="waiting">Reúna a turma e revele a missão quando todos estiverem prontos.</p>
	{:else if step.kind === 'opening'}
		<p class="narrative">{step.callout}</p>
	{:else if step.kind === 'oath'}
		<blockquote class="oath">{step.callout}</blockquote>
		{#if step.instructions}<p class="instructions">{step.instructions}</p>{/if}
	{:else}
		<p class="callout">{step.callout}</p>
		{#if step.instructions}<p class="instructions">{step.instructions}</p>{/if}
		{#if step.illustration}<Illustration name={step.illustration} />{/if}
		{#if step.trees}<TreeCards trees={step.trees} />{/if}
		{#if step.timer}<Timer seconds={step.timer.seconds} label={step.timer.label} />{/if}
		{#if step.checklist}
			<Checklist {session} {step} />
		{:else if step.scored}
			<section class="scoring" aria-label="Pontos desta missão">
				<h3><Icon name="users" weight="duotone" size={20} /> Pontos dos grupos</h3>
				<ScorePanel {session} stepId={step.id} />
			</section>
		{/if}
	{/if}
</article>

<style>
	.step {
		display: grid;
		gap: 1.1rem;
		padding: 1.25rem 1.25rem 1.5rem;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.emblem {
		display: grid;
		place-items: center;
		justify-self: center;
		width: 5.5rem;
		height: 5.5rem;
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

	[data-kind='oath'] .emblem {
		background: radial-gradient(
			circle at 35% 30%,
			color-mix(in oklab, var(--gold) 40%, transparent),
			var(--surface-sunken) 72%
		);
		color: var(--gold);
		--icon-tone: var(--accent);
	}

	.closed .emblem {
		animation: breathe 2.8s ease-in-out infinite;
	}

	h2 {
		font-size: var(--step-3);
		text-align: center;
	}

	h3 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
		font-family: var(--font-ui);
		font-size: var(--step-0);
		color: var(--text-soft);
	}

	.narrative {
		font-family: var(--font-story);
		font-size: var(--step-1);
		line-height: 1.75;
		white-space: pre-line;
	}

	.callout {
		font-family: var(--font-story);
		font-style: italic;
		font-size: var(--step-2);
		line-height: 1.3;
		text-align: center;
		color: var(--accent-strong);
	}

	.instructions {
		padding: 1rem;
		border-left: 3px solid var(--accent);
		border-radius: 4px var(--radius-s) var(--radius-s) 4px;
		background: var(--surface-sunken);
		font-size: var(--step-1);
		line-height: 1.5;
		white-space: pre-line;
	}

	.waiting {
		padding: 1rem 1.25rem;
		border: 1px dashed var(--border);
		border-radius: var(--radius-s);
		color: var(--text-soft);
		text-align: center;
	}

	.oath {
		margin: 0;
		padding: 1.25rem;
		border: 1px solid color-mix(in oklab, var(--gold) 35%, transparent);
		border-radius: var(--radius-m);
		background: var(--gold-soft);
		font-family: var(--font-story);
		font-size: var(--step-3);
		line-height: 1.3;
		text-align: center;
		text-wrap: balance;
	}

	@keyframes breathe {
		50% {
			transform: scale(1.06);
		}
	}
</style>
