<!--
	The forest map from the prototype: areas along a winding path, opened one
	by one as the class finishes missions. The last one turns into a trophy
	after the oath.
-->
<script lang="ts">
	import type { Journey } from '#lib/content/types.ts';
	import type { Progress } from '#lib/session.ts';
	import Icon from './Icon.svelte';

	interface Props {
		journey: Journey;
		progress: Progress;
	}

	let { journey, progress }: Props = $props();

	const open = $derived(journey.areas.filter((a) => progress.missions >= a.missions).length);
	const current = $derived(open - 1);
</script>

<section class="card map" aria-labelledby="map-title">
	<header>
		<h2 id="map-title">Mapa da floresta</h2>
		<span class="pill" class:gold={progress.oath}>
			{progress.oath ? 'Jornada completa' : `${open} de ${journey.areas.length} áreas`}
		</span>
	</header>

	<ol>
		{#each journey.areas as area, i (area.id)}
			{@const unlocked = progress.missions >= area.missions}
			{@const trophy = progress.oath && i === journey.areas.length - 1}
			<li class:unlocked class:current={i === current} class:right={i % 2 === 1} class:trophy>
				<span class="node" aria-hidden="true">
					<Icon name={trophy ? 'trophy' : area.icon} size={28} />
					{#if !unlocked}<span class="lock"><Icon name="lock" size={14} /></span>{/if}
				</span>
				<span class="info">
					<strong>{area.name}</strong>
					<span>{trophy ? 'Guardiões oficiais' : area.description}</span>
					<em class="status">
						{#if trophy}
							Jornada concluída
						{:else if unlocked}
							{i === current ? 'Vocês estão aqui' : 'Aberta'}
						{:else}
							Abre com {area.missions} {area.missions === 1 ? 'missão' : 'missões'}
						{/if}
					</em>
				</span>
			</li>
		{/each}
	</ol>
</section>

<style>
	.map {
		display: grid;
		gap: 1rem;
		padding: 1rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		font-size: var(--step-1);
	}

	ol {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding-block: 0.75rem;
	}

	li.right {
		flex-direction: row-reverse;
		text-align: right;
	}

	/* The trail between areas. */
	li + li::before {
		content: '';
		position: absolute;
		top: -0.9rem;
		left: 2.1rem;
		width: 3px;
		height: 1.8rem;
		border-radius: 3px;
		background: repeating-linear-gradient(var(--border) 0 4px, transparent 4px 8px);
	}

	li.right + li::before,
	li.right::before {
		left: auto;
		right: 2.1rem;
	}

	li.unlocked + li.unlocked::before {
		background: var(--accent);
		box-shadow: var(--glow);
	}

	.node {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 4.25rem;
		height: 4.25rem;
		border: 2px solid var(--border);
		border-radius: 50%;
		background: var(--surface-sunken);
		color: var(--text-faint);
	}

	.unlocked .node {
		border-color: color-mix(in oklab, var(--accent) 55%, transparent);
		background: radial-gradient(
			circle at 35% 30%,
			color-mix(in oklab, var(--accent) 40%, transparent),
			var(--surface-sunken)
		);
		color: var(--accent-strong);
	}

	.current .node {
		box-shadow:
			0 0 0 4px var(--accent-soft),
			var(--glow);
		animation: breathe 2.6s ease-in-out infinite;
	}

	.trophy .node {
		border-color: var(--gold);
		background: var(--gold);
		color: var(--on-gold);
		box-shadow: var(--glow-gold);
	}

	.lock {
		position: absolute;
		right: -0.15rem;
		bottom: -0.15rem;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--surface-solid);
		color: var(--text-soft);
	}

	.info {
		display: grid;
		gap: 0.1rem;
		flex: 1;
		min-width: 0;
		padding: 0.625rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
	}

	.info strong {
		font-family: var(--font-story);
		font-size: var(--step-1);
		line-height: 1.15;
	}

	li:not(.unlocked) .info {
		border-style: dashed;
		background: transparent;
	}

	li:not(.unlocked) .node {
		border-style: dashed;
		background: transparent;
	}

	.info > span {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	.status {
		color: var(--text-faint);
		font-size: var(--step--1);
		font-style: normal;
		font-weight: 700;
	}

	.unlocked .status {
		color: var(--accent-strong);
	}

	.trophy .status {
		color: var(--gold);
	}

	@keyframes breathe {
		50% {
			transform: scale(1.05);
		}
	}
</style>
