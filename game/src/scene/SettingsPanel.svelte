<script lang="ts">
	/**
	 * Sound and control settings, out of the avatar editor: they apply at once
	 * (no draft), so the panel has only a close button. Same dialog rules as the
	 * editor: modal, focus trapped, Escape closes, keys and pointers stay out of the game.
	 */
	import type { Snippet } from 'svelte';
	import HudIcon from './HudIcon.svelte';

	let { onclose, children }: { onclose: () => void; children: Snippet } = $props();

	function keydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
			return;
		}
		if (event.key !== 'Tab') return;
		const root = event.currentTarget;
		if (!(root instanceof HTMLElement)) return;
		const nodes = root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
		const first = nodes[0],
			last = nodes[nodes.length - 1];
		if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	}
</script>

<div
	class="settings"
	role="dialog"
	tabindex="-1"
	aria-modal="true"
	aria-labelledby="settings-title"
	onpointerdown={(event) => event.stopPropagation()}
	onwheel={(event) => event.stopPropagation()}
	onkeydown={keydown}
	onkeyup={(event) => event.stopPropagation()}
>
	<div class="panel">
		<header>
			<h2 id="settings-title">Som e controles</h2>
			<button
				class="icon"
				type="button"
				aria-label="Fechar som e controles"
				title="Fechar"
				{@attach (node) => {
					node.focus({ preventScroll: true });
				}}
				onclick={onclose}><HudIcon name="back" /></button
			>
		</header>
		{@render children()}
	</div>
</div>

<style>
	.settings {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-items: center;
		box-sizing: border-box;
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
			max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
		background: #10271be8;
		color: #f1f6ed;
		font: 0.875rem var(--font-ui, system-ui);
	}
	.panel {
		box-sizing: border-box;
		width: min(100%, 32rem);
		max-height: 100%;
		overflow: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		padding: 16px;
		border: 1px solid #ffffff38;
		border-radius: 20px;
		background: #173a2b;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	h2 {
		margin: 0;
		font: 1.4rem var(--font-story, system-ui);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 1px solid #ffffff44;
		border-radius: 50%;
		background: #244c38;
		color: inherit;
		cursor: pointer;
	}
	.icon:focus-visible {
		outline: 3px solid #f2c94c;
		outline-offset: 3px;
	}
</style>
