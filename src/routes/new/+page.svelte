<!--
	Joining a journey: the call to adventure, then the participant's name,
	then the group. Nothing else is asked: no school, no class.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Calling from '#lib/components/Calling.svelte';
	import GroupMark from '#lib/components/GroupMark.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { mataAtlantica as journey } from '#lib/content/mata-atlantica.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';

	type Stage = 'calling' | 'name' | 'group';

	const uid = $props.id();
	const opening = journey.steps.find((s) => s.kind === 'opening');

	// Coming from the home screen, the call has already been read.
	let stage = $state<Stage>(page.url.searchParams.get('etapa') === 'nome' || !opening ? 'name' : 'calling');
	let name = $state('');
	let groupIndex = $state<number | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const trimmed = $derived(name.trim());

	function back() {
		stage = stage === 'group' ? 'name' : 'calling';
	}

	function toGroup(event: SubmitEvent) {
		event.preventDefault();
		if (trimmed) stage = 'group';
	}

	async function start(event: SubmitEvent) {
		event.preventDefault();
		if (groupIndex === null || !trimmed || !sessions.ready) return;
		busy = true;
		error = null;
		try {
			const session = sessions.create({
				participant: trimmed,
				groups: journey.groups.map(({ name, color }) => ({ name, color })),
				myGroupIndex: groupIndex,
				// The opening story was just read, so the journey starts at the first mission.
				startStep: opening ? journey.steps.indexOf(opening) + 1 : 0
			});
			// Only leave once the journey is safely stored on the phone.
			await sessions.flush();
			await goto(resolve(`/journey?id=${session.id}`), { replace: true });
		} catch {
			error = 'Não foi possível guardar a jornada neste celular. Verifique o espaço livre e tente de novo.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>O chamado | Guardiões da Mata Atlântica</title>
</svelte:head>

<header class="bar page">
	{#if stage === 'calling' || (stage === 'name' && !opening)}
		<a class="icon-button" href={resolve('/')} aria-label="Voltar para o início"><Icon name="back" /></a>
	{:else}
		<button class="icon-button" type="button" aria-label="Voltar" onclick={back}><Icon name="back" /></button>
	{/if}
	<p class="brand"><Icon name="leaf" weight="duotone" size={22} /> Guardiões da Mata Atlântica</p>
	<ThemeToggle />
</header>

<main class="page">
	{#if stage === 'calling' && opening}
		<Calling {opening} onaccept={() => (stage = 'name')} />
	{:else if stage === 'name'}
		<form class="card step" onsubmit={toGroup}>
			<div class="emblem" aria-hidden="true"><Icon name="user" weight="duotone" size={40} /></div>
			<h1>Como devemos te chamar?</h1>
			<label for="{uid}-name">Seu nome</label>
			<input
				id="{uid}-name"
				bind:value={name}
				required
				maxlength="40"
				autocomplete="nickname"
				placeholder="Seu nome ou apelido"
			/>
			<p class="hint">É assim que você aparece no seu certificado.</p>
			<button class="button wide" type="submit" disabled={!trimmed}>Continuar</button>
		</form>
	{:else}
		<form class="card step" onsubmit={start}>
			<div class="emblem" aria-hidden="true"><Icon name="users" weight="duotone" size={40} /></div>
			<h1>Escolha seu grupo</h1>
			<p class="lead">{trimmed}, cada guardião caminha com um grupo. Qual será o seu?</p>
			<fieldset>
				<legend class="visually-hidden">Grupos</legend>
				{#each journey.groups as group, i (group.name)}
					<label class="group" class:selected={groupIndex === i}>
						<input type="radio" name="group" value={i} bind:group={groupIndex} />
						<GroupMark name={group.name} color={group.color} size={2.75} />
						<span>
							<strong>Grupo {group.name}</strong>
							<small>{group.hint}</small>
						</span>
					</label>
				{/each}
			</fieldset>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button class="button wide" type="submit" disabled={groupIndex === null || busy || !sessions.ready}>
				<Icon name="footprints" weight="duotone" size={22} />
				{busy ? 'Preparando a jornada…' : 'Começar a jornada'}
			</button>
		</form>
	{/if}
</main>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-block: 0.25rem;
	}

	.bar > :first-child {
		margin-left: -0.75rem;
	}

	.brand {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		color: var(--accent-strong);
		font-family: var(--font-story);
		font-size: var(--step-0);
		font-weight: 700;
		white-space: nowrap;
	}

	main {
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
	}

	.step {
		display: grid;
		gap: 0.875rem;
		padding: 1.5rem 1.25rem;
		animation: enter var(--dur-screen) var(--ease-out);
	}

	.emblem {
		display: grid;
		place-items: center;
		justify-self: center;
		width: 4.75rem;
		height: 4.75rem;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 30%,
			color-mix(in oklab, var(--accent) 38%, transparent),
			var(--surface-sunken) 72%
		);
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.55;
	}

	h1 {
		font-size: var(--step-3);
		text-align: center;
	}

	.lead {
		color: var(--text-soft);
		font-size: var(--step-1);
		text-align: center;
	}

	label {
		font-weight: 700;
	}

	input:not([type='radio']) {
		min-height: var(--tap);
		padding: 0 0.875rem;
		border: 2px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
		font-size: var(--step-1);
	}

	input:not([type='radio']):focus-visible {
		border-color: var(--accent);
		outline: none;
	}

	.hint {
		color: var(--text-faint);
		font-size: var(--step--1);
	}

	fieldset {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.group {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.875rem 1rem;
		border: 2px solid var(--border);
		border-radius: var(--radius-m);
		background: var(--surface-sunken);
		cursor: pointer;
		transition: border-color var(--dur-fast) var(--ease-out);
	}

	.group.selected {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.group:has(input:focus-visible) {
		outline: 3px solid var(--accent-strong);
		outline-offset: 2px;
	}

	.group input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.group span {
		display: grid;
	}

	.group strong {
		font-family: var(--font-story);
		font-size: var(--step-1);
	}

	.group small {
		color: var(--text-soft);
		font-size: var(--step--1);
		font-weight: 400;
	}

	.error {
		color: var(--danger);
		font-weight: 700;
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
