<!--
	The journey's progress at a glance, like the prototype's profile panel:
	rank seal, level, missions, XP and a bar with one segment per mission.
	Ranks progress by fill, not new colors: mint outline, solid mint, gold.
-->
<script lang="ts">
	import type { Journey } from '#lib/content/types.ts';
	import { levelOf, missionCount, XP_PER_MISSION, type Session } from '#lib/session.ts';
	import GroupMark from './GroupMark.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		session: Session;
		journey: Journey;
		missions: number;
	}

	let { session, journey, missions }: Props = $props();

	const level = $derived(levelOf(journey, missions));
	const total = $derived(missionCount(journey));
	const seal = $derived(level.number === 1 ? 'sprout' : level.number === 2 ? 'shield' : 'crown');
	const toNext = $derived(level.next ? (level.next.missions - missions) * XP_PER_MISSION : 0);
	const myGroup = $derived(session.groups.find((g) => g.id === session.myGroupId));
	// Journeys saved before participant names were asked show the school instead.
	const name = $derived(session.participant || session.school || 'Sua jornada');
</script>

<section class="panel card" aria-label="Progresso da jornada">
	<div class="seal" data-level={level.number} aria-hidden="true">
		<Icon name={seal} weight="duotone" size={30} />
	</div>
	<div class="who">
		<strong>{name}</strong>
		{#if myGroup}
			<span class="group"
				><GroupMark name={myGroup.name} color={myGroup.color} size={1.25} /> Grupo {myGroup.name}</span
			>
		{/if}
		<span class="rank">{level.rank.name}</span>
		<span class="stats">{missions}/{total} missões, {level.xp} XP</span>
	</div>
	<span class="level" aria-label="Nível {level.number}">Nv. {level.number}</span>

	<div class="xp">
		<ol class="segments" aria-label="{missions} de {total} missões concluídas">
			{#each { length: total }, i (i)}
				<li class:done={i < missions} class:next={i === missions}></li>
			{/each}
		</ol>
		<p class="hint">
			{#if level.next}
				<strong>{toNext} XP</strong> para {level.next.name}
			{:else}
				Nível mais alto alcançado: <strong>{level.rank.name}</strong>
			{/if}
		</p>
	</div>
</section>

<style>
	.panel {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.875rem;
		padding: 1rem;
	}

	.seal {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		border: 2px solid var(--accent);
		border-radius: 50%;
		color: var(--accent);
		--icon-tone: var(--accent);
		--icon-tone-opacity: 0.3;
	}

	.seal[data-level='2'] {
		background: var(--accent);
		color: var(--on-accent);
		--icon-tone: var(--on-accent);
	}

	.seal[data-level='3'] {
		border-color: var(--gold);
		background: var(--gold);
		color: var(--on-gold);
		box-shadow: var(--glow-gold);
		--icon-tone: var(--on-gold);
	}

	.who {
		display: grid;
		min-width: 0;
		line-height: 1.25;
	}

	.who strong {
		overflow: hidden;
		font-family: var(--font-story);
		font-size: var(--step-1);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		margin-block: 0.15rem;
		color: var(--text-soft);
		font-size: var(--step--1);
		font-weight: 700;
	}

	.rank {
		color: var(--accent-strong);
		font-size: var(--step--1);
		font-weight: 800;
	}

	.stats {
		color: var(--text-faint);
		font-size: var(--step--1);
	}

	.level {
		align-self: start;
		padding: 0.25rem 0.625rem;
		border-radius: var(--radius-pill);
		background: var(--accent-gradient);
		color: var(--on-accent);
		font-size: var(--step--1);
		font-weight: 800;
	}

	.xp {
		grid-column: 1 / -1;
		display: grid;
		gap: 0.4rem;
	}

	.segments {
		display: grid;
		grid-auto-flow: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.segments li {
		height: 0.75rem;
		border-radius: var(--radius-pill);
		background: var(--surface-solid);
		box-shadow: inset 0 0 0 1px var(--border);
	}

	.segments li.done {
		background: var(--xp-gradient);
		box-shadow: none;
	}

	.segments li.next {
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}

	.hint {
		color: var(--text-faint);
		font-size: var(--step--1);
		text-align: center;
	}

	.hint strong {
		color: var(--text);
	}
</style>
