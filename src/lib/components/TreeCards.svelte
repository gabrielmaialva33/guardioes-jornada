<!--
	Short, sourced facts about the trees of a mission. The summary is always
	visible; what to notice on the tree and the sources fold away so the
	mission does not turn into a wall of text.
-->
<script lang="ts">
	import type { TreeInfo } from '#lib/content/types.ts';
	import Icon from './Icon.svelte';

	let { trees }: { trees: TreeInfo[] } = $props();

	const sourceName = (url: string) => {
		const host = new URL(url).hostname;
		if (host.includes('embrapa')) return 'Embrapa';
		if (host.includes('proflora')) return 'CNCFlora';
		if (host.includes('jbrj')) return 'Flora e Funga do Brasil';
		return host;
	};
</script>

<div class="trees">
	{#each trees as tree (tree.name)}
		<article class="tree">
			<header>
				<Icon name="tree" weight="duotone" size={26} />
				<span>
					<h3>{tree.name}</h3>
					<small><i>{tree.scientificName}</i>, família {tree.family}</small>
				</span>
			</header>
			<p>{tree.summary}</p>
			<details>
				<summary>Repare em</summary>
				<ul>
					{#each tree.cues as cue (cue)}
						<li>{cue}</li>
					{/each}
				</ul>
				<p class="sources">
					Fontes:
					{#each tree.sources as url, i (url)}
						<a href={url} target="_blank" rel="noopener noreferrer">{sourceName(url)}</a>{i <
						tree.sources.length - 1
							? ', '
							: ''}
					{/each}
				</p>
			</details>
		</article>
	{/each}
</div>

<style>
	.trees {
		display: grid;
		gap: 0.75rem;
	}

	.tree {
		display: grid;
		gap: 0.6rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		background: var(--surface-sunken);
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		color: var(--accent-strong);
		--icon-tone: var(--earth);
		--icon-tone-opacity: 0.6;
	}

	header span {
		display: grid;
	}

	h3 {
		color: var(--text);
		font-size: var(--step-1);
	}

	small {
		color: var(--text-faint);
		font-size: var(--step--1);
	}

	p {
		line-height: 1.55;
	}

	details {
		border-top: 1px solid var(--border);
		padding-top: 0.5rem;
	}

	summary {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: var(--accent-strong);
		font-weight: 700;
		list-style: none;
		cursor: pointer;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	/* Chevron: points down when closed, up when open. */
	summary::after {
		content: '';
		width: 0.55rem;
		height: 0.55rem;
		margin-right: 0.35rem;
		border-right: 2px solid currentColor;
		border-bottom: 2px solid currentColor;
		transform: translateY(-25%) rotate(45deg);
		transition: transform var(--dur-fast) var(--ease-out);
	}

	details[open] summary::after {
		transform: translateY(25%) rotate(225deg);
	}

	ul {
		display: grid;
		gap: 0.35rem;
		margin: 0.25rem 0 0.75rem;
		padding-left: 1.25rem;
	}

	.sources {
		color: var(--text-faint);
		font-size: var(--step--1);
	}

	.sources a {
		color: inherit;
	}
</style>
