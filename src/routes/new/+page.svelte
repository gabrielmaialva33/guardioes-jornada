<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import GroupMark from '#lib/components/GroupMark.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { groupPresets, MAX_GROUPS, MIN_GROUPS, type GroupPreset } from '#lib/content/groups.ts';
	import { todayIso } from '#lib/session.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';

	const uid = $props.id();

	let school = $state('');
	let className = $state('');
	let guide = $state('');
	let date = $state(todayIso());
	let groups = $state<GroupPreset[]>(groupPresets.slice(0, MIN_GROUPS).map((g) => ({ ...g })));

	const nextPreset = $derived(groupPresets.find((p) => !groups.some((g) => g.color === p.color)));
	const namesValid = $derived(groups.every((g) => g.name.trim() !== ''));

	function addGroup() {
		if (nextPreset && groups.length < MAX_GROUPS) groups.push({ ...nextPreset });
	}

	function removeGroup(index: number) {
		if (groups.length > MIN_GROUPS) groups.splice(index, 1);
	}

	let error = $state<string | null>(null);

	async function start(event: SubmitEvent) {
		event.preventDefault();
		if (!namesValid || !sessions.ready) return;
		error = null;
		try {
			const session = sessions.create({
				school: school.trim(),
				className: className.trim(),
				guide: guide.trim(),
				date,
				groups: groups.map((g) => ({ name: g.name.trim(), color: g.color }))
			});
			// Only leave the form once the journey is safely stored on the phone.
			await sessions.flush();
			await goto(resolve(`/journey?id=${session.id}`), { replace: true });
		} catch {
			error = 'Não foi possível guardar a jornada neste celular. Verifique o espaço livre e tente de novo.';
		}
	}
</script>

<svelte:head>
	<title>Nova jornada | Guardiões da Mata Atlântica</title>
</svelte:head>

<header class="bar page">
	<a class="icon-button" href={resolve('/')} aria-label="Voltar para o início"><Icon name="back" /></a>
	<h1>Nova jornada</h1>
	<ThemeToggle />
</header>

<main class="page">
	<section class="intro">
		<div class="emblem" aria-hidden="true">
			<Icon name="compass" weight="duotone" size={40} />
		</div>
		<p>Prepare os dados da visita e divida a turma em grupos antes de entrar na trilha.</p>
	</section>

	<form onsubmit={start}>
		<fieldset class="card section">
			<legend><Icon name="users" weight="duotone" size={28} /> A turma</legend>

			<div class="field">
				<label for="{uid}-school">Escola</label>
				<input
					id="{uid}-school"
					bind:value={school}
					autocomplete="organization"
					placeholder="Ex.: EE Capão Bonito"
				/>
			</div>

			<div class="field">
				<label for="{uid}-class">Turma</label>
				<input id="{uid}-class" bind:value={className} placeholder="Ex.: 6º ano B" />
			</div>

			<div class="field">
				<label for="{uid}-guide">Guia</label>
				<input
					id="{uid}-guide"
					bind:value={guide}
					autocomplete="name"
					placeholder="Seu nome, para o certificado"
				/>
			</div>

			<div class="field">
				<label for="{uid}-date">Data da visita</label>
				<input id="{uid}-date" type="date" bind:value={date} required />
			</div>
		</fieldset>

		<fieldset class="card section">
			<legend><Icon name="tree" weight="duotone" size={28} /> Grupos</legend>
			<p class="hint">Cada grupo leva o nome de uma árvore da Mata Atlântica. Não use nomes de alunos.</p>
			<ul class="groups">
				{#each groups as group, i (group.color)}
					<li>
						<GroupMark name={group.name || '?'} color={group.color} size={2.5} />
						<label class="visually-hidden" for="{uid}-group-{i}">Nome do grupo {i + 1}</label>
						<input id="{uid}-group-{i}" bind:value={group.name} required maxlength="24" />
						<button
							class="icon-button remove"
							type="button"
							aria-label="Remover grupo {group.name}"
							disabled={groups.length <= MIN_GROUPS}
							onclick={() => removeGroup(i)}
						>
							<Icon name="close" />
						</button>
					</li>
				{/each}
			</ul>
			{#if groups.length < MAX_GROUPS}
				<button class="button quiet wide" type="button" onclick={addGroup}>
					<Icon name="plus" size={20} /> Adicionar grupo
				</button>
			{/if}
		</fieldset>

		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button class="button wide submit" type="submit" disabled={!namesValid || !sessions.ready}>
			<Icon name="footprints" weight="duotone" size={22} /> Começar jornada
		</button>
	</form>
</main>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-block: 0.25rem;
	}

	.bar .icon-button:first-child {
		margin-left: -0.75rem;
	}

	.bar :global(.icon-button:last-child) {
		margin-right: -0.75rem;
	}

	h1 {
		flex: 1;
		font-size: var(--step-2);
	}

	main {
		display: grid;
		gap: 1.25rem;
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
	}

	.intro {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		color: var(--text-soft);
	}

	.emblem {
		display: grid;
		place-items: center;
		flex: none;
		width: 3.75rem;
		height: 3.75rem;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-sunken);
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.4;
	}

	form {
		display: grid;
		gap: 1.25rem;
	}

	.section {
		display: grid;
		gap: 0.875rem;
		margin: 0;
		padding: 1.25rem;
		min-width: 0;
	}

	legend {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0;
		float: left;
		width: 100%;
		margin-bottom: 0.125rem;
		color: var(--text);
		font-family: var(--font-story);
		font-size: var(--step-2);
		font-weight: 700;
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.45;
	}

	.field {
		display: grid;
		gap: 0.35rem;
	}

	label {
		color: var(--text-soft);
		font-size: var(--step--1);
		font-weight: 700;
	}

	input {
		width: 100%;
		min-height: var(--tap);
		padding: 0 0.875rem;
		border: 1.5px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
	}

	input::placeholder {
		color: var(--text-faint);
	}

	input:focus-visible {
		border-color: var(--accent-strong);
	}

	.hint {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	.groups {
		display: grid;
		gap: 0.625rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.groups li {
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}

	.groups input {
		flex: 1;
		min-width: 0;
		font-weight: 700;
	}

	.remove {
		color: var(--text-soft);
	}

	.remove:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.submit {
		font-size: var(--step-1);
	}

	.error {
		color: var(--danger);
		font-weight: 700;
	}
</style>
