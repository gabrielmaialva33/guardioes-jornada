<!-- A team's color with its initials on top, so color is never the only cue. -->
<script lang="ts">
	import { GROUP_INK } from '#lib/content/groups.ts';

	let { name, color, size = 2.25 }: { name: string; color: string; size?: number } = $props();

	// One letter per part of the name (Canela-preta is CP, Cedro-rosa is CR), so
	// trees that start with the same letter still look different without color.
	const initials = $derived(
		name
			.trim()
			.split(/[\s-]+/)
			.slice(0, 2)
			.map((part) => part.charAt(0))
			.join('')
			.toLocaleUpperCase('pt-BR')
	);
</script>

<span
	class="mark"
	class:double={initials.length > 1}
	style:--group={color}
	style:--ink={GROUP_INK}
	style:--size="{size}rem"
	aria-hidden="true"
>
	{initials}
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

	.mark.double {
		font-size: calc(var(--size) * 0.4);
		letter-spacing: -0.02em;
	}

	:global([data-theme='sol']) .mark {
		outline: 1.5px solid color-mix(in oklab, var(--group) 55%, black);
	}
</style>
