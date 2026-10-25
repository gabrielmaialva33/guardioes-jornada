<!-- The Secret Trail badge, only once it has been earned on this phone. -->
<script lang="ts">
	import { secretBadge } from '#lib/state/secret-badge.svelte.ts';
	import Icon from './Icon.svelte';

	// Same style as journey dates (formatDate in session.ts).
	const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
	const earnedOn = $derived(secretBadge.earnedAt === null ? '' : dateFormat.format(secretBadge.earnedAt));
</script>

{#if secretBadge.earned}
	<section class="card badge" aria-label="Sentinela da Trilha Secreta">
		<span class="seal" aria-hidden="true"><Icon name="compass" weight="duotone" size={30} /></span>
		<span class="text">
			<strong>Sentinela da Trilha Secreta</strong>
			<span>Concluiu a trilha escondida da floresta em {earnedOn}, neste celular.</span>
		</span>
	</section>
{/if}

<style>
	.badge {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.875rem 1rem;
		border-color: color-mix(in oklab, var(--gold) 45%, var(--border));
	}

	.seal {
		display: grid;
		flex: none;
		place-items: center;
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		background: var(--gold);
		color: var(--on-gold);
		box-shadow: var(--glow-gold);
		--icon-tone: var(--on-gold);
		--icon-tone-opacity: 0.3;
	}

	.text {
		display: grid;
		min-width: 0;
		line-height: 1.3;
	}

	.text span {
		color: var(--text-soft);
		font-size: var(--step--1);
	}
</style>
