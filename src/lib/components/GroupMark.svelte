<!-- A team's color with its initial on top, so color is never the only cue. -->
<script lang="ts">
	import { GROUP_INK } from '#lib/content/groups.ts';

	let { name, color, size = 2.25 }: { name: string; color: string; size?: number } = $props();
</script>

<span class="mark" style:--group={color} style:--ink={GROUP_INK} style:--size="{size}rem" aria-hidden="true">
	{name.trim().charAt(0).toLocaleUpperCase('pt-BR')}
</span>

<style>
	.mark {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: var(--group);
		box-shadow: inset 0 -2px 0 rgb(0 0 0 / 0.18);
		color: var(--ink);
		font-family: var(--font-story);
		font-size: calc(var(--size) * 0.5);
		font-weight: 800;
		line-height: 1;
	}

	:global([data-theme='sol']) .mark {
		outline: 1.5px solid color-mix(in oklab, var(--group) 55%, black);
	}
</style>
