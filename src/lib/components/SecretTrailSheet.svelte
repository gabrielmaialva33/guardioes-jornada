<!--
	Shown when someone finds the Secret Trail in the forest. Nothing of the game
	is downloaded until "Entrar na trilha".
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { feedback } from '#lib/feedback.ts';
	import Icon from './Icon.svelte';
	import Sheet from './Sheet.svelte';

	let { open = $bindable() }: { open: boolean } = $props();

	$effect(() => {
		if (open) feedback('achievement', 40);
	});

	async function enter() {
		open = false;
		await goto(resolve('/secret-trail'));
	}
</script>

<Sheet bind:open title="Você encontrou uma trilha secreta!">
	<div class="secret">
		<div class="emblem" aria-hidden="true"><Icon name="compass" weight="duotone" size={44} /></div>
		<p>
			Entre as árvores da Mata Atlântica há um mundo 3D escondido, onde você caminha pela reserva, salta pelas
			pedras do rio e ajuda a guarda-parque Iara.
		</p>
		<p class="hint">Na primeira vez, o jogo precisa de internet para ser baixado.</p>
	</div>
	{#snippet actions()}
		<button class="button wide" type="button" onclick={enter}>
			<Icon name="footprints" weight="duotone" size={22} /> Entrar na trilha
		</button>
		<button class="button quiet wide" type="button" onclick={() => (open = false)}>Agora não</button>
	{/snippet}
</Sheet>

<style>
	.secret {
		display: grid;
		gap: 0.75rem;
	}

	.emblem {
		display: grid;
		place-items: center;
		justify-self: center;
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 30%,
			color-mix(in oklab, var(--gold) 40%, transparent),
			var(--surface-sunken) 72%
		);
		color: var(--gold);
		--icon-tone: var(--accent);
		--icon-tone-opacity: 0.5;
	}

	.hint {
		color: var(--text-faint);
		font-size: var(--step--1);
	}
</style>
