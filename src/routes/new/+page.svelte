<!--
	Joining a journey: the call to adventure, then the participant's name,
	then the group. Nothing else is asked: no school, no class.
-->
<script lang="ts">
	import { goto, pushState } from '$app/navigation';
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
	const entry: Stage = page.url.searchParams.get('etapa') === 'nome' || !opening ? 'name' : 'calling';
	// Every later stage is a history entry (shallow routing): the phone's back
	// button and the header arrow both return to the previous stage.
	// The name rides along in the history entry, so a reload on the group stage
	// keeps it; without a name, the group stage falls back to asking for it.
	let name = $state(page.state.name ?? '');
	const trimmed = $derived(name.trim());
	const stage = $derived<Stage>(
		page.state.stage === 'group' && !trimmed ? 'name' : (page.state.stage ?? entry)
	);
	// The entry stage never takes focus on load; after a change, the new
	// heading does, so screen readers announce where the person is.
	let moved = false;
	const focusHeading = (node: HTMLElement) => {
		if (moved) node.focus();
	};
	let groupIndex = $state<number | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	function go(next: Stage) {
		moved = true;
		pushState('', { stage: next, name: trimmed });
	}

	function back() {
		moved = true;
		history.back();
	}

	function toGroup(event: SubmitEvent) {
		event.preventDefault();
		if (trimmed) go('group');
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
	{#if !page.state.stage}
		<a class="icon-button" href={resolve('/')} aria-label="Voltar para o início"><Icon name="back" /></a>
	{:else}
		<button class="icon-button" type="button" aria-label="Voltar" onclick={back}><Icon name="back" /></button>
	{/if}
	<p class="brand"><Icon name="leaf" weight="duotone" size={22} /> Guardiões da Mata Atlântica</p>
	<ThemeToggle />
</header>

<main class="page">
	{#if stage === 'calling' && opening}
		<Calling {opening} onaccept={() => go('name')} />
	{:else if stage === 'name'}
		<form class="card step" onsubmit={toGroup}>
			<div class="emblem" aria-hidden="true"><Icon name="user" weight="duotone" size={40} /></div>
			<h1 tabindex="-1" {@attach focusHeading}>Como devemos te chamar?</h1>
			<label for="{uid}-name">Seu nome</label>
			<input
				id="{uid}-name"
				bind:value={name}
				required
				maxlength="40"
				autocomplete="nickname"
				placeholder="Seu nome ou apelido"
			/>
			<!-- Data minimization (LGPD art. 6, III): a first name or nickname is enough. -->
			<p class="hint">
				Basta o primeiro nome ou um apelido. Ele aparece no seu certificado e fica guardado neste celular.
			</p>
			<button class="button wide" type="submit" disabled={!trimmed}>Continuar</button>
		</form>
	{:else}
		<form class="card step" onsubmit={start}>
			<div class="emblem" aria-hidden="true"><Icon name="users" weight="duotone" size={40} /></div>
			<h1 tabindex="-1" {@attach focusHeading}>Escolha seu grupo</h1>
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
		/* Two balanced lines on narrow phones instead of pushing the theme button off screen. */
		min-width: 0;
		color: var(--accent-strong);
		font-family: var(--font-story);
		font-size: var(--step-0);
		font-weight: 700;
		line-height: 1.1;
		text-align: center;
		text-wrap: balance;
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

	/* Focus is moved here by script to announce the stage, not for keyboard use. */
	h1:focus {
		outline: none;
	}

	.lead {
		color: var(--text-soft);
		font-size: var(--step-1);
		text-align: center;
	}

	label {
		font-weight: 700;
	}

	/* An explicit width: the default (20 characters at this size) is wider than a 320px phone. */
	input:not([type='radio']) {
		width: 100%;
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

	/* With large text the name drops below the mark rather than shrinking to a few letters. */
	.group {
		position: relative;
		display: flex;
		flex-wrap: wrap;
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

	/* The invisible radio covers the whole card, so a tap anywhere selects it. */
	.group input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.group span {
		display: grid;
		flex: 1 1 9rem;
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
