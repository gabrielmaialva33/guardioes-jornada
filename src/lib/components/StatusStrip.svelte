<!--
	Slim status line that lives at the bottom of the screen: is the app ready
	for airplane mode, and how is the cloud backup doing. Tapping the backup
	chip opens the guide's account.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import { pwa } from '#lib/state/pwa.svelte.ts';
	import { sync } from '#lib/state/sync.svelte.ts';
	import Icon, { type IconName } from './Icon.svelte';

	const offline = $derived(
		pwa.offlineReady
			? { icon: 'check' as IconName, text: 'Pronto offline', tone: 'ok' }
			: { icon: 'cloud-syncing' as IconName, text: 'Preparando offline', tone: 'wait' }
	);

	const backup = $derived.by((): { icon: IconName; text: string; tone: string } | null => {
		const queued = sync.pending > 0 ? `${sync.pending} na fila` : null;
		switch (sync.status) {
			case 'unavailable':
				return null;
			case 'signed-out':
				return { icon: 'cloud-off', text: 'Backup desligado', tone: 'off' };
			case 'offline':
				return { icon: 'wifi-off', text: queued ? `Sem sinal, ${queued}` : 'Sem sinal', tone: 'wait' };
			case 'syncing':
				return { icon: 'cloud-syncing', text: 'Salvando', tone: 'busy' };
			case 'error':
				return { icon: 'cloud-error', text: 'Tentando de novo', tone: 'error' };
			default:
				return { icon: 'cloud', text: queued ?? 'Backup em dia', tone: queued ? 'wait' : 'ok' };
		}
	});
</script>

<div class="strip" role="status">
	<span class="chip" data-tone={offline.tone}>
		<Icon name={offline.icon} size={15} />
		{offline.text}
	</span>
	{#if backup}
		<a class="chip" data-tone={backup.tone} href={resolve('/account')}>
			<Icon name={backup.icon} size={15} />
			{backup.text}
		</a>
	{/if}
</div>

<style>
	/* Pages reserve 2.75rem per row for this strip (5.5rem when large text wraps it). */
	.strip {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		column-gap: 0.5rem;
		font-size: 0.8rem;
		line-height: 1;
	}

	/* The text stays small; the row is a full 2.75rem (44px) so the backup link is easy to tap. */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 2.75rem;
		color: var(--text-faint);
		font-weight: 700;
		text-decoration: none;
		white-space: nowrap;
	}

	/* Large system text on a small phone: one chip alone can be wider than the strip. */
	@media (max-width: 19.5em) {
		.chip {
			white-space: normal;
		}
	}

	a.chip {
		padding-inline: 0.5rem;
		border-radius: var(--radius-pill);
	}

	a.chip:active {
		background: var(--accent-soft);
	}

	[data-tone='ok'] {
		color: var(--accent-strong);
	}

	[data-tone='error'] {
		color: var(--danger);
	}

	[data-tone='busy'] :global(.icon) {
		animation: pulse 1.2s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
</style>
