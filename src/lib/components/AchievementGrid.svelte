<!-- The class's achievements as badges, locked until earned. -->
<script lang="ts">
	import type { Journey } from '#lib/content/types.ts';
	import { earnedAchievements, type Progress } from '#lib/session.ts';
	import Icon, { type IconName } from './Icon.svelte';

	interface Props {
		journey: Journey;
		progress: Progress;
	}

	let { journey, progress }: Props = $props();

	const earned = $derived(new Set(earnedAchievements(journey, progress).map((a) => a.id)));

	// One emblem per achievement, in journey order.
	const emblems: IconName[] = ['footprints', 'shield', 'butterfly', 'trophy'];
</script>

<section class="card achievements" aria-labelledby="achievements-title">
	<header>
		<h2 id="achievements-title">Conquistas</h2>
		<span class="pill">{earned.size} de {journey.achievements.length}</span>
	</header>
	<ul>
		{#each journey.achievements as achievement, i (achievement.id)}
			{@const unlocked = earned.has(achievement.id)}
			<li class:unlocked>
				<span class="badge" aria-hidden="true">
					<Icon name={emblems[i] ?? 'medal'} size={30} />
					{#if !unlocked}
						<span class="lock"><Icon name="lock" size={14} /></span>
					{/if}
				</span>
				<strong>{achievement.name}</strong>
				<span class="visually-hidden"
					>{unlocked ? 'conquistada' : `bloqueada: ${achievement.description}`}</span
				>
			</li>
		{/each}
	</ul>
</section>

<style>
	.achievements {
		container-type: inline-size;
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

	ul {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Four badges need about 20rem (a word like "Treinamento" under each); narrower cards use two rows. */
	@container (width < 20rem) {
		ul {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			row-gap: 1rem;
		}
	}

	@container (width < 10rem) {
		ul {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	li {
		display: grid;
		justify-items: center;
		gap: 0.4rem;
		text-align: center;
	}

	.badge {
		position: relative;
		display: grid;
		place-items: center;
		width: 3.75rem;
		height: 3.75rem;
		border: 2px dashed var(--border);
		border-radius: 50%;
		color: var(--text-faint);
		--icon-tone: transparent;
	}

	.unlocked .badge {
		border: 2px solid var(--gold);
		background: var(--gold);
		color: var(--on-gold);
		box-shadow: var(--glow-gold), var(--highlight);
		--icon-tone: var(--on-gold);
		--icon-tone-opacity: 0.25;
		animation: stamp 420ms var(--ease-spring) backwards;
	}

	@keyframes stamp {
		from {
			transform: scale(0.6);
			opacity: 0;
		}
	}

	.lock {
		position: absolute;
		right: -0.1rem;
		bottom: -0.1rem;
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: 50%;
		background: var(--surface-solid);
		color: var(--text-soft);
	}

	strong {
		color: var(--text-faint);
		font-size: 0.8rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.unlocked strong {
		color: var(--text);
	}
</style>
