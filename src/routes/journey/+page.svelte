<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import AchievementGrid from '#lib/components/AchievementGrid.svelte';
	import ClassPanel from '#lib/components/ClassPanel.svelte';
	import ForestMap from '#lib/components/ForestMap.svelte';
	import ForestScene from '#lib/components/ForestScene.svelte';
	import GainsSheet from '#lib/components/GainsSheet.svelte';
	import GroupMark from '#lib/components/GroupMark.svelte';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import ScorePanel from '#lib/components/ScorePanel.svelte';
	import SettingsSheet from '#lib/components/SettingsSheet.svelte';
	import StepCard from '#lib/components/StepCard.svelte';
	import StatusStrip from '#lib/components/StatusStrip.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { downloadSession } from '#lib/export.ts';
	import { feedback } from '#lib/feedback.ts';
	import { currentStep, isFinished, progressOf, standings, type Gains } from '#lib/session.ts';
	import { preferences } from '#lib/state/preferences.svelte.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';
	import { keepScreenOn } from '#lib/wake-lock.ts';

	type Tab = 'journey' | 'scores' | 'map';

	const session = $derived(sessions.find(page.url.searchParams.get('id')));
	const journey = $derived(session ? sessions.journeyOf(session) : null);
	// Participants read the opening story before joining, so their journey starts
	// at the first mission and "back" must not undo that.
	const firstStep = $derived(
		session?.participant && journey
			? Math.max(
					0,
					journey.steps.findIndex((s) => s.kind !== 'opening')
				)
			: 0
	);
	const step = $derived(session && journey ? currentStep(session, journey) : null);
	const progress = $derived(session && journey ? progressOf(session, journey) : { missions: 0, oath: false });
	const finished = $derived(session && journey ? isFinished(session, journey) : false);

	const tabs: { id: Tab; label: string; icon: IconName }[] = [
		{ id: 'journey', label: 'Jornada', icon: 'journey' },
		{ id: 'scores', label: 'Placar', icon: 'scores' },
		{ id: 'map', label: 'Mapa', icon: 'map' }
	];

	let tab = $state<Tab>('journey');
	let gains = $state<Gains | null>(null);
	let settingsOpen = $state(false);
	let scoreboard = $state<HTMLElement>();

	$effect(() => {
		if (session && preferences.keepScreenOn) return keepScreenOn();
	});

	const actionLabel = $derived.by(() => {
		if (!step || !session) return null;
		if (step.kind === 'opening') return 'Aceitar o chamado';
		if (step.kind === 'oath') return 'Fazer o juramento';
		return session.revealed ? 'Concluir missão' : 'Revelar missão';
	});

	const lastScore = $derived.by(() => {
		const event = session?.scores.at(-1);
		if (!event || !session) return null;
		const group = session.groups.find((g) => g.id === event.groupId);
		return `${event.delta > 0 ? '+' : ''}${event.delta} para ${group?.name ?? 'grupo'}`;
	});

	function advance() {
		if (!session) return;
		const wasRevealing = step?.kind === 'mission' && !session.revealed;
		const result = sessions.advance(session);
		if (wasRevealing) feedback('open', 20);
		else if (!result) feedback('tap', 10);
		gains = result;
		tab = 'journey';
		scrollTo({
			top: 0,
			behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
		});
	}

	function back() {
		if (!session) return;
		sessions.back(session);
		feedback('tap', 10);
	}

	function undoScore() {
		if (!session) return;
		sessions.undoScore(session);
		feedback('unpoint', 15);
	}

	function stepTitle(stepId: string | null) {
		return journey?.steps.find((s) => s.id === stepId)?.title ?? 'Fora das missões';
	}
</script>

<svelte:head>
	<title>{session?.participant || session?.school || 'Jornada'} | Guardiões da Mata Atlântica</title>
</svelte:head>

{#if !sessions.loaded}
	<p class="page loading">Abrindo a jornada…</p>
{:else if !session || !journey}
	<main class="page missing">
		<h1>Jornada não encontrada</h1>
		<p>Ela pode ter sido apagada deste celular.</p>
		<a class="button" href={resolve('/')}>Ver jornadas</a>
	</main>
{:else}
	<header class="bar page">
		<a class="icon-button" href={resolve('/')} aria-label="Voltar para as jornadas"><Icon name="back" /></a>
		<p class="brand"><Icon name="leaf" weight="duotone" size={22} /> Guardiões da Mata Atlântica</p>
		<ThemeToggle />
		<button class="icon-button" type="button" aria-label="Ajustes" onclick={() => (settingsOpen = true)}>
			<Icon name="settings" />
		</button>
	</header>

	<div class="page tabs" role="tablist" aria-label="Seções da jornada">
		{#each tabs as t (t.id)}
			<button role="tab" type="button" aria-selected={tab === t.id} onclick={() => (tab = t.id)}>
				<Icon name={t.icon} weight={tab === t.id ? 'duotone' : 'regular'} size={22} />
				{t.label}
			</button>
		{/each}
	</div>

	<main class="page">
		<h1 class="visually-hidden">{session.participant ? `Jornada de ${session.participant}` : 'Jornada'}</h1>
		<div class="panel" role="tabpanel" aria-label="Jornada" hidden={tab !== 'journey'}>
			<ClassPanel {session} {journey} missions={progress.missions} />
			{#if step}
				{#key `${step.id}-${session.revealed}`}
					<div class="enter"><StepCard {session} {journey} {step} /></div>
				{/key}
			{:else if finished}
				<section class="card closing">
					<div class="emblem" aria-hidden="true"><Icon name="trophy" weight="duotone" size={56} /></div>
					<h2>{journey.closing.title}</h2>
					<p class="closing-text">{journey.closing.text}</p>
					<p class="pledge">{journey.closing.pledge}</p>

					<h3>Resultado dos grupos</h3>
					<ol class="standings">
						{#each standings(session) as { group, score }, i (group.id)}
							<li style="--group: {group.color}" class:first={i === 0}>
								<span class="place">{i + 1}º</span>
								<span class="name"
									><GroupMark name={group.name} color={group.color} size={2} /> {group.name}</span
								>
								<strong>{score} {score === 1 ? 'ponto' : 'pontos'}</strong>
							</li>
						{/each}
					</ol>

					<a class="button wide" href={resolve(`/certificates?id=${session.id}`)}>
						<Icon name="certificate" weight="duotone" size={22} /> Ver certificados
					</a>
					<button class="button quiet wide" type="button" onclick={() => downloadSession(session)}>
						<Icon name="download" size={20} /> Exportar dados da jornada
					</button>
				</section>
			{/if}
		</div>
		<div class="panel" role="tabpanel" aria-label="Placar" hidden={tab !== 'scores'}>
			<section class="card scoreboard" bind:this={scoreboard}>
				<h2><Icon name="scores" weight="duotone" size={24} /> Placar dos grupos</h2>
				<ScorePanel {session} stepId={step?.id ?? null} large />
				<div class="score-tools">
					<button class="button quiet" type="button" disabled={!lastScore} onclick={undoScore}>
						<Icon name="undo" size={20} /> Desfazer {lastScore ?? 'ponto'}
					</button>
					{#if document.fullscreenEnabled}
						<button class="button quiet" type="button" onclick={() => scoreboard?.requestFullscreen()}>
							<Icon name="expand" size={20} /> Tela cheia
						</button>
					{/if}
				</div>
			</section>
			{#if session.scores.length > 0}
				<section class="card history">
					<h2>Últimos pontos</h2>
					<ol reversed>
						{#each session.scores.slice(-12).toReversed() as event (event.id)}
							{@const group = session.groups.find((g) => g.id === event.groupId)}
							<li>
								<GroupMark name={group?.name ?? '?'} color={group?.color ?? 'gray'} size={1.75} />
								<span class="what">
									<strong class:minus={event.delta < 0}
										>{event.delta > 0 ? '+' : ''}{event.delta} {group?.name}</strong
									>
									<span>{stepTitle(event.stepId)}</span>
								</span>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
		</div>
		<div class="panel" role="tabpanel" aria-label="Mapa" hidden={tab !== 'map'}>
			<ForestScene
				missions={progress.missions}
				oath={progress.oath}
				label="Floresta com {progress.missions} missões concluídas"
			/>
			<ForestMap {journey} {progress} />
			<AchievementGrid {journey} {progress} />
		</div>
	</main>

	<div class="action-bar">
		<div class="page">
			<StatusStrip />
		</div>
		{#if actionLabel}
			<div class="page actions">
				<button
					class="button quiet back"
					type="button"
					onclick={back}
					disabled={!sessions.ready || (session.step <= firstStep && !session.revealed)}
					aria-label="Voltar uma etapa"
				>
					<Icon name="undo" />
				</button>
				<button class="button primary" type="button" disabled={!sessions.ready} onclick={advance}
					>{actionLabel}</button
				>
			</div>
		{/if}
	</div>

	<GainsSheet bind:gains {progress} />
	<SettingsSheet bind:open={settingsOpen} />
{/if}

<style>
	.loading,
	.missing {
		padding-block: 3rem;
	}

	.missing {
		display: grid;
		gap: 1rem;
		justify-items: start;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-block: 0.25rem;
	}

	.bar .icon-button:first-child {
		margin-left: -0.75rem;
	}

	.bar .icon-button:last-child {
		margin-right: -0.75rem;
	}

	/* The leaf flows with the text, so on narrow phones the name takes two balanced
	   centered lines instead of running under the buttons. */
	.brand {
		flex: 1;
		min-width: 0;
		color: var(--accent-strong);
		font-family: var(--font-story);
		font-size: var(--step-0);
		font-weight: 700;
		line-height: 1.1;
		text-align: center;
		text-wrap: balance;
	}

	.brand :global(.icon) {
		margin-right: 0.15rem;
	}

	.tabs {
		container-type: inline-size;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.25rem;
		/* Same edges as the cards below: .page's gutters, but this bar paints its own background. */
		width: calc(
			min(100%, var(--measure)) - max(var(--gutter), env(safe-area-inset-left)) -
				max(var(--gutter), env(safe-area-inset-right))
		);
		margin-block: 0.25rem 1rem;
		padding: 0.3rem;
		border-radius: var(--radius-m);
		background: var(--surface-sunken);
	}

	[role='tab'] {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-height: 2.875rem;
		padding: 0.2rem 0.25rem;
		border: 0;
		border-radius: calc(var(--radius-m) - 0.3rem);
		background: transparent;
		color: var(--text-soft);
		font-weight: 700;
		cursor: pointer;
	}

	[role='tab'][aria-selected='true'] {
		background: var(--accent-gradient);
		color: var(--on-accent);
		box-shadow:
			var(--highlight),
			0 2px 10px rgb(0 0 0 / 0.25);
	}

	/* Narrow phones (under ~336px of tab bar): the icon goes above the label so "Jornada" stays whole. */
	@container (width < 21rem) {
		[role='tab'] {
			flex-direction: column;
			gap: 0.1rem;
		}
	}

	/* Large system text on a phone: three tabs side by side no longer fit, so they stack. */
	@media (max-width: 19.5em) {
		.tabs {
			grid-template-columns: minmax(0, 1fr);
		}

		.tabs [role='tab'] {
			flex-direction: row;
			gap: 0.4rem;
		}
	}

	/*
	 * The page is a column at least as tall as the screen, and the action bar sticks
	 * to its bottom. At the end of the page the bar sits after the content, so it never
	 * covers the last card, whatever its height (text size, a wrapped status strip).
	 */
	:global(body:has(.action-bar)) {
		display: flex;
		flex-direction: column;
	}

	main {
		display: grid;
		flex: 1 0 auto;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 1rem;
		padding-bottom: 1.25rem;
	}

	/* All panels stay mounted so a running timer survives a look at the scoreboard. */
	.panel {
		display: grid;
		gap: 1rem;
	}

	.panel[hidden] {
		display: none;
	}

	.enter {
		animation: enter 320ms var(--ease-out);
	}

	@keyframes enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}

	.action-bar {
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: grid;
		/* The status strip's 2.75rem row already spaces it from the border and the buttons. */
		padding-block: 0 max(0.75rem, env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg) 82%, transparent);
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	/* A phone held sideways has little height: status and buttons share one row
	   (not with large text, where the halves would be too narrow for the labels). */
	@media (orientation: landscape) and (max-height: 480px) and (min-width: 40em) {
		.action-bar {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			align-items: center;
			padding-top: 0.5rem;
		}
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	.back {
		width: var(--tap);
		padding: 0;
		flex: none;
	}

	.primary {
		flex: 1;
		font-size: var(--step-1);
	}

	.scoreboard,
	.history,
	.closing {
		display: grid;
		gap: 1rem;
		padding: 1.25rem;
	}

	.scoreboard h2,
	.history h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--step-1);
	}

	.scoreboard:fullscreen {
		align-content: center;
		padding: 2rem;
		background: var(--bg-image);
	}

	.score-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.history ol {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding-block: 0.35rem;
	}

	.what {
		display: grid;
	}

	.what strong {
		color: var(--success);
	}

	.what strong.minus {
		color: var(--danger);
	}

	.what span {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	.closing {
		text-align: center;
	}

	.closing .emblem {
		display: grid;
		place-items: center;
		justify-self: center;
		width: 6rem;
		height: 6rem;
		border-radius: 50%;
		background: radial-gradient(
			circle at 35% 30%,
			color-mix(in oklab, var(--gold) 45%, transparent),
			var(--surface-sunken) 72%
		);
		color: var(--gold);
		box-shadow: 0 0 24px color-mix(in oklab, var(--gold) 35%, transparent);
		--icon-tone: var(--accent);
		--icon-tone-opacity: 0.6;
	}

	.closing h2 {
		font-size: var(--step-3);
	}

	.closing-text {
		font-family: var(--font-story);
		font-size: var(--step-1);
		line-height: 1.6;
	}

	.pledge {
		color: var(--accent-strong);
		font-weight: 700;
	}

	.closing h3 {
		margin-top: 0.5rem;
		font-size: var(--step-1);
	}

	.standings {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		text-align: left;
	}

	/* Place, group and points in one row; the points drop to their own line only when they do not fit. */
	.standings li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
		font-weight: 700;
	}

	.standings .name {
		display: inline-flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 0.6rem;
	}

	.standings strong {
		margin-left: auto;
	}

	.standings .place {
		color: var(--text-faint);
		font-family: var(--font-story);
	}

	.standings li.first {
		border-color: color-mix(in oklab, var(--gold) 60%, transparent);
		background: var(--gold-soft);
		box-shadow: 0 0 18px color-mix(in oklab, var(--gold) 25%, transparent);
		font-size: var(--step-1);
	}

	.standings li.first .place {
		color: var(--gold);
	}
</style>
