<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Calling from '#lib/components/Calling.svelte';
	import ForestScene from '#lib/components/ForestScene.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import SettingsSheet from '#lib/components/SettingsSheet.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import StatusStrip from '#lib/components/StatusStrip.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { mataAtlantica } from '#lib/content/mata-atlantica.ts';
	import {
		currentStep,
		formatDate,
		isFinished,
		missionCount,
		missionNumber,
		progressOf,
		type Session
	} from '#lib/session.ts';
	import { auth } from '#lib/state/auth.svelte.ts';
	import { pwa } from '#lib/state/pwa.svelte.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';

	// The forest grows once when the app opens: the home screen's one moment of motion.
	let grown = $state(0);
	onMount(() => {
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
			grown = 5;
			return;
		}
		const timer = setInterval(() => {
			grown += 1;
			if (grown >= 5) clearInterval(timer);
		}, 420);
		return () => clearInterval(timer);
	});

	let settingsOpen = $state(false);
	let toDelete = $state<Session | null>(null);
	let deleteOpen = $state(false);

	const opening = mataAtlantica.steps.find((s) => s.kind === 'opening');
	// First visit: the call to adventure comes before anything else.
	const firstVisit = $derived(
		sessions.loaded && sessions.list.length === 0 && sessions.quarantine.length === 0
	);

	/** The most recent unfinished journey: one tap to get back into it. */
	const ongoing = $derived(sessions.list.find((s) => !isFinished(s, sessions.journeyOf(s))) ?? null);

	function status(session: Session) {
		const journey = sessions.journeyOf(session);
		const progress = progressOf(session, journey);
		const total = missionCount(journey);
		const step = currentStep(session, journey);
		const where = !step
			? 'Jornada concluída'
			: step.kind === 'opening'
				? 'Na introdução'
				: step.kind === 'oath'
					? 'No juramento final'
					: `Na missão ${missionNumber(journey, step.id)}: ${step.title}`;
		return { done: progress.missions, total, where, ratio: progress.missions / total };
	}

	function title(session: Session) {
		if (session.participant) return session.participant;
		// Journeys saved before participant names were asked.
		return `${session.school || 'Jornada'}${session.className ? `, ${session.className}` : ''}`;
	}

	/** Where the session stands: the participant's group, then the date. */
	function subtitle(session: Session) {
		const group = session.groups.find((g) => g.id === session.myGroupId);
		return group ? `Grupo ${group.name}, ${formatDate(session.date)}` : formatDate(session.date);
	}

	function groupOf(session: Session) {
		return session.groups.find((g) => g.id === session.myGroupId) ?? null;
	}

	function askDelete(session: Session) {
		toDelete = session;
		deleteOpen = true;
	}

	async function confirmDelete() {
		if (toDelete) await sessions.remove(toDelete.id);
		deleteOpen = false;
	}
</script>

<svelte:head>
	<title>Guardiões da Mata Atlântica</title>
</svelte:head>

<header class="bar page">
	<p class="brand"><Icon name="leaf" weight="duotone" size={24} /> Guardiões</p>
	<ThemeToggle />
	<a class="icon-button" href={resolve('/account')} aria-label="Sua conta"><Icon name="user" /></a>
	<button class="icon-button" type="button" aria-label="Ajustes" onclick={() => (settingsOpen = true)}>
		<Icon name="settings" />
	</button>
</header>

<main class="page">
	{#if !sessions.loaded}
		<p class="muted">Abrindo jornadas guardadas…</p>
	{:else if firstVisit && opening}
		<Calling {opening} onaccept={() => goto(resolve('/new?etapa=nome'))} />
	{:else}
		{#if ongoing}
			{@const s = status(ongoing)}
			<a class="card continue" href={resolve(`/journey?id=${ongoing.id}`)}>
				<span class="pill">Jornada em andamento</span>
				<strong>{title(ongoing)}</strong>
				<span class="where">{s.where}</span>
				<span class="track" aria-hidden="true"><span style:width="{Math.max(4, s.ratio * 100)}%"></span></span
				>
				<span class="go">Continuar jornada <Icon name="back" size={18} /></span>
			</a>
		{/if}

		<section class="hero">
			<ForestScene missions={grown} oath={grown >= 5} label="Floresta da Mata Atlântica crescendo" />
			<h1>Guardiões da Mata Atlântica</h1>
			<p>A floresta continua chamando. Volte à sua jornada ou comece uma nova.</p>
			<a class="button wide" class:quiet={ongoing} href={resolve('/new')}>
				<Icon name="plus" size={20} /> Nova jornada
			</a>
		</section>

		{#if sessions.quarantine.length > 0}
			<p class="card notice" role="status">
				<Icon name="warning" weight="duotone" size={24} />
				{sessions.quarantine.length === 1
					? '1 jornada guardada não pôde ser aberta nesta versão do app.'
					: `${sessions.quarantine.length} jornadas guardadas não puderam ser abertas nesta versão do app.`}
				Elas continuam guardadas; atualize o app para abri-las.
			</p>
		{/if}

		{#if sessions.list.length > 0}
			<section class="list">
				<h2>Jornadas neste celular</h2>
				<ul>
					{#each sessions.list as session (session.id)}
						{@const s = status(session)}
						<li class="card">
							<a href={resolve(`/journey?id=${session.id}`)}>
								<Icon name={s.done === s.total ? 'trophy' : 'tree'} weight="duotone" size={30} />
								<span class="text">
									<strong>{title(session)}</strong>
									<span>{subtitle(session)}</span>
									<span class="done"
										>{s.done === s.total ? 'Concluída' : `${s.done} de ${s.total} missões`}</span
									>
								</span>
							</a>
							<button
								class="icon-button"
								type="button"
								aria-label="Apagar jornada de {title(session)}"
								onclick={() => askDelete(session)}
							>
								<Icon name="trash" />
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if pwa.iosNeedsInstall}
			<section class="card ios-install">
				<Icon name="install" weight="duotone" size={30} />
				<p>
					<strong>No iPhone, adicione à Tela de Início.</strong>
					Toque em Compartilhar e depois em "Adicionar à Tela de Início". Assim o app abre sem internet e as jornadas
					não são apagadas pelo Safari.
				</p>
			</section>
		{/if}

		{#if pwa.updateReady || pwa.canInstall}
			<div class="app-actions">
				{#if pwa.updateReady}
					<button class="button quiet" type="button" onclick={() => pwa.applyUpdate()}>Atualizar o app</button
					>
				{/if}
				{#if pwa.canInstall}
					<button class="button quiet" type="button" onclick={() => pwa.install()}>
						<Icon name="install" size={20} /> Instalar no celular
					</button>
				{/if}
			</div>
		{/if}
	{/if}
</main>

<footer class="status-bar">
	<div class="page"><StatusStrip /></div>
</footer>

<SettingsSheet bind:open={settingsOpen} />

<Sheet bind:open={deleteOpen} title="Apagar esta jornada?">
	<p>
		Os pontos, o progresso e as fotos de <strong>{toDelete ? title(toDelete) : ''}</strong> serão apagados
		deste celular{auth.user ? ' e do backup na nuvem' : ''}. Não dá para desfazer.
	</p>
	{#snippet actions()}
		<button class="button danger wide" type="button" onclick={confirmDelete}>Apagar jornada</button>
		<button class="button quiet wide" type="button" onclick={() => (deleteOpen = false)}>Manter</button>
	{/snippet}
</Sheet>

<style>
	.bar {
		display: flex;
		align-items: center;
		padding-block: 0.25rem;
	}

	.bar .icon-button:last-child {
		margin-right: -0.75rem;
	}

	.brand {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.4rem;
		color: var(--accent-strong);
		font-family: var(--font-story);
		font-size: var(--step-1);
		font-weight: 700;
	}

	main {
		display: grid;
		gap: 1.25rem;
		padding-bottom: calc(3.5rem + env(safe-area-inset-bottom));
	}

	.continue {
		display: grid;
		gap: 0.4rem;
		padding: 1.125rem 1.25rem;
		border-color: color-mix(in oklab, var(--accent) 45%, transparent);
		color: inherit;
		text-decoration: none;
		box-shadow: var(--glow), var(--shadow), var(--highlight);
	}

	.continue .pill {
		justify-self: start;
	}

	.continue strong {
		font-family: var(--font-story);
		font-size: var(--step-2);
		line-height: 1.15;
	}

	.where {
		color: var(--text-soft);
	}

	.track {
		height: 0.5rem;
		margin-block: 0.25rem;
		overflow: hidden;
		border-radius: var(--radius-pill);
		background: var(--surface-sunken);
	}

	.track span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, var(--canopy), var(--accent), var(--accent-strong));
	}

	.go {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
		color: var(--accent-strong);
		font-weight: 800;
	}

	.go :global(.icon) {
		transform: rotate(180deg);
	}

	.hero {
		display: grid;
		gap: 0.875rem;
	}

	h1 {
		margin-top: 0.25rem;
		font-size: var(--step-4);
		line-height: 1.05;
	}

	.hero p {
		color: var(--text-soft);
		font-size: var(--step-1);
	}

	h2 {
		font-size: var(--step-2);
	}

	.muted {
		color: var(--text-soft);
	}

	.list {
		display: grid;
		gap: 0.75rem;
	}

	.list ul {
		display: grid;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		align-items: center;
		padding-right: 0.25rem;
	}

	.list a {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.875rem;
		min-width: 0;
		padding: 0.875rem 1rem;
		color: var(--accent-strong);
		text-decoration: none;
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.45;
	}

	.text {
		display: grid;
		min-width: 0;
		color: var(--text);
	}

	.text strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.text span {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	.text .done {
		color: var(--accent-strong);
		font-weight: 700;
	}

	.app-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.status-bar {
		position: fixed;
		inset: auto 0 0;
		z-index: 5;
		padding-block: 0.35rem max(0.35rem, env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg) 85%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	.notice {
		display: flex;
		gap: 0.75rem;
		padding: 1rem;
		color: var(--warning);
	}

	.ios-install {
		display: flex;
		gap: 0.875rem;
		padding: 1rem 1.25rem;
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.45;
	}

	.ios-install p {
		color: var(--text-soft);
	}

	.ios-install strong {
		display: block;
		color: var(--text);
	}
</style>
