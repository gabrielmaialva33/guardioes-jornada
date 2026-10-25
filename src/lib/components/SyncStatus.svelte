<!-- One-line backup status. Silent when the cloud is not configured. -->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { sync } from '#lib/state/sync.svelte.ts';
	import Icon from './Icon.svelte';

	const text = $derived.by(() => {
		switch (sync.status) {
			case 'signed-out':
				return 'Backup na nuvem desligado';
			case 'offline':
				return sync.pending > 0
					? `Sem internet: ${sync.pending === 1 ? '1 jornada aguarda' : `${sync.pending} jornadas aguardam`} backup`
					: 'Sem internet: tudo salvo no celular';
			case 'syncing':
				return 'Salvando na nuvem';
			case 'idle':
				return sync.pending > 0 ? 'Alterações aguardando backup' : 'Backup em dia';
			case 'error':
				return 'Backup falhou, tentaremos de novo';
			default:
				return '';
		}
	});
</script>

{#if sync.status !== 'unavailable'}
	<a class="sync" href={resolve('/account')} data-status={sync.status}>
		<Icon name={sync.status === 'idle' || sync.status === 'syncing' ? 'cloud' : 'cloud-off'} size={18} />
		<span>{text}</span>
	</a>
{/if}

<style>
	.sync {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.75rem;
		color: var(--text-soft);
		font-size: var(--step--1);
		text-decoration: none;
	}

	.sync[data-status='error'] {
		color: var(--danger);
	}

	.sync[data-status='syncing'] :global(svg) {
		animation: pulse 1.2s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
</style>
