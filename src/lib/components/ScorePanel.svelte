<!--
	Group scores with +1 / −1. Rows keep their creation order so a group never
	jumps under the guide's thumb while points are being given.
-->
<script lang="ts">
	import { GROUP_INK } from '#lib/content/groups.ts';
	import { feedback } from '#lib/feedback.ts';
	import { groupScore, type Session } from '#lib/session.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';
	import GroupMark from './GroupMark.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		session: Session;
		/** Step the points belong to, for the history; null outside missions. */
		stepId: string | null;
		large?: boolean;
	}

	let { session, stepId, large = false }: Props = $props();

	const scores = $derived(session.groups.map((g) => ({ group: g, score: groupScore(session, g.id) })));
	const top = $derived(Math.max(...scores.map((s) => s.score)));
	const leaders = $derived(scores.filter((s) => s.score === top).length);

	function give(groupId: string, delta: number) {
		sessions.score(session, groupId, delta, stepId);
		feedback(delta > 0 ? 'point' : 'unpoint', 15);
	}
</script>

<ul class="scores" class:large>
	{#each scores as { group, score } (group.id)}
		{@const leading = score === top && score > 0 && leaders === 1}
		{@const mine = group.id === session.myGroupId}
		<li style:--group={group.color} style:--ink={GROUP_INK} class:leading class:mine>
			<GroupMark name={group.name} color={group.color} size={large ? 2.75 : 2.25} />
			<span class="name">
				{group.name}
				{#if mine}<small class="mine-tag">seu grupo</small>{/if}
				{#if leading}<small><Icon name="crown" weight="duotone" size={14} /> na frente</small>{/if}
			</span>
			{#key score}
				<output class="score" aria-live="polite" aria-label="{score} pontos para {group.name}">{score}</output
				>
			{/key}
			<button
				class="icon-button minus"
				type="button"
				aria-label="Tirar 1 ponto de {group.name}"
				onclick={() => give(group.id, -1)}
			>
				<Icon name="minus" />
			</button>
			<button
				class="plus"
				type="button"
				aria-label="Dar 1 ponto para {group.name}"
				onclick={() => give(group.id, 1)}
			>
				<Icon name="plus" size={20} />
				<span aria-hidden="true">1</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	.scores {
		container-type: inline-size;
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: auto 1fr auto auto auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.5rem 0.5rem 0.625rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
	}

	li.leading {
		border-color: color-mix(in oklab, var(--gold) 50%, transparent);
	}

	li.mine {
		border-color: color-mix(in oklab, var(--group) 60%, transparent);
	}

	.name {
		display: grid;
		min-width: 0;
		font-weight: 700;
		line-height: 1.2;
	}

	small {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		color: var(--gold);
		font-size: var(--step--1);
		font-weight: 700;
	}

	.mine-tag {
		color: var(--text-soft);
	}

	.score {
		min-width: 2.5ch;
		/* Alegreya lining figures: Atkinson's slashed zero reads as Ø at this size. */
		font-family: var(--font-story);
		font-size: var(--step-2);
		font-weight: 800;
		font-variant-numeric: lining-nums tabular-nums;
		text-align: right;
		animation: tick var(--dur-base) var(--ease-spring);
	}

	.minus {
		width: 2.75rem;
		color: var(--danger);
	}

	.plus {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		min-width: 4.25rem;
		height: var(--tap);
		border: 0;
		border-radius: var(--radius-m);
		background: var(--group);
		box-shadow: inset 0 -3px 0 rgb(0 0 0 / 0.18);
		color: var(--ink);
		font-size: var(--step-1);
		font-weight: 800;
		cursor: pointer;
		touch-action: manipulation;
		transition: transform var(--dur-press) var(--ease-out);
	}

	.plus:active {
		transform: scale(0.94);
	}

	.large li {
		padding-block: 0.875rem;
	}

	.large .name {
		font-family: var(--font-story);
		font-size: var(--step-2);
	}

	.large .score {
		font-size: var(--step-4);
	}

	/*
	 * When the row is too narrow for the name next to the score and both buttons
	 * (phones, large text), the name takes the first line and the score with the
	 * buttons the second, so a name like "Canela-preta" never breaks.
	 */
	@container (width < 23rem) {
		li {
			grid-template-columns: auto minmax(0, 1fr) auto auto;
			row-gap: 0.25rem;
		}

		li > :global(:first-child) {
			grid-row: span 2;
		}

		.name {
			grid-column: 2 / -1;
		}

		.score {
			grid-column: 2;
		}
	}

	@container (width < 28rem) {
		.large li {
			grid-template-columns: auto minmax(0, 1fr) auto auto;
			row-gap: 0.25rem;
		}

		.large li > :global(:first-child) {
			grid-row: span 2;
		}

		.large .name {
			grid-column: 2 / -1;
		}

		.large .score {
			grid-column: 2;
		}
	}

	/* Very narrow rows (large text on a small phone): mark and score, then the name,
	   then both buttons, each on its own line. Only the visual order changes. */
	@container (width < 14rem) {
		li,
		.large li {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
		}

		.score {
			flex: 1 1 auto;
			order: 1;
		}

		.name {
			flex: 1 1 100%;
			order: 2;
		}

		.minus {
			order: 3;
			width: var(--tap);
			margin-left: auto;
		}

		.plus {
			order: 3;
			min-width: var(--tap);
		}
	}

	@keyframes tick {
		from {
			transform: scale(1.25);
			color: var(--success);
		}
	}
</style>
