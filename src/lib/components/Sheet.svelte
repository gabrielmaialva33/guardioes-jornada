<!--
	Bottom sheet built on <dialog>: focus trapping, Esc to close and the
	backdrop come from the browser. Never use alert()/confirm() in this app.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		title: string;
		children: Snippet;
		actions?: Snippet;
	}

	let { open = $bindable(), title, children, actions }: Props = $props();

	const uid = $props.id();
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{uid}-title"
	onclose={() => (open = false)}
	onclick={(e) => {
		if (e.target === dialog) open = false;
	}}
>
	<div class="sheet">
		<header>
			<h2 id="{uid}-title">{title}</h2>
			<button class="icon-button" type="button" aria-label="Fechar" onclick={() => (open = false)}>
				<Icon name="close" />
			</button>
		</header>
		<div class="body">{@render children()}</div>
		{#if actions}
			<footer>{@render actions()}</footer>
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(100%, var(--measure));
		/* The browser's modal dialog keeps 1em + 3px from each side; a bottom sheet spans the phone. */
		max-width: 100%;
		max-height: 88dvh;
		margin: auto auto 0;
		padding: 0;
		border: 0;
		border-radius: var(--radius-m) var(--radius-m) 0 0;
		background: var(--surface-solid);
		color: var(--text);
	}

	dialog[open] {
		animation: slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	dialog::backdrop {
		background: rgb(8 20 12 / 0.55);
	}

	@media (min-width: 40rem) {
		dialog {
			margin: auto;
			border-radius: var(--radius-m);
		}
	}

	/* Title and buttons stay in view; only the body scrolls when the sheet is taller than the screen. */
	.sheet {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 1rem;
		max-height: 88dvh;
		padding: 1rem 1.25rem max(1.25rem, env(safe-area-inset-bottom));
	}

	/* The padding keeps focus rings from being clipped by the scroll box. */
	.body {
		overflow-y: auto;
		overscroll-behavior: contain;
		margin: -0.35rem;
		padding: 0.35rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	h2 {
		font-size: var(--step-1);
	}

	/* A long title wraps; the close button keeps its full tap size. */
	header .icon-button {
		flex: none;
	}

	footer {
		display: grid;
		gap: 0.75rem;
	}

	@keyframes slide-up {
		from {
			transform: translateY(24px);
			opacity: 0;
		}
	}
</style>
