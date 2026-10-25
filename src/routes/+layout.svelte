<script lang="ts">
	import '#lib/fonts.css';
	import '../app.css';
	import { onMount, type Snippet } from 'svelte';
	import { auth } from '#lib/state/auth.svelte.ts';
	import { preferences } from '#lib/state/preferences.svelte.ts';
	import { pwa } from '#lib/state/pwa.svelte.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';
	import { sync } from '#lib/state/sync.svelte.ts';

	let { children }: { children: Snippet } = $props();

	preferences.load();

	$effect(() => {
		const root = document.documentElement;
		if (preferences.theme === 'sol') root.dataset.theme = 'sol';
		else delete root.dataset.theme;
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', preferences.theme === 'sol' ? '#eef4ee' : '#0b1a12');
	});

	onMount(() => {
		void pwa.init();
		void Promise.all([sessions.load(), auth.init()]).then(() => sync.init());
	});
</script>

{#if sessions.error}
	<p class="storage-warning" role="alert">{sessions.error}</p>
{:else if sessions.loaded && sessions.readOnly}
	<p class="storage-warning info" role="status">
		O app está aberto em outra janela. Feche as outras para continuar a jornada aqui.
	</p>
{/if}

{@render children()}

<style>
	.storage-warning {
		position: sticky;
		top: 0;
		z-index: 10;
		margin: 0;
		padding: 0.75rem var(--gutter);
		background: var(--danger);
		color: var(--on-accent);
		font-weight: 700;
	}

	.storage-warning.info {
		background: var(--gold);
		color: var(--on-gold);
	}
</style>
