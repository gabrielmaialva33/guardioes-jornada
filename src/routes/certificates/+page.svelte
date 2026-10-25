<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { renderSVG } from 'uqr';
	import Icon from '#lib/components/Icon.svelte';
	import { journeys, mataAtlantica } from '#lib/content/mata-atlantica.ts';
	import { formatDate, groupScore, isFinished } from '#lib/session.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';

	const session = $derived(sessions.find(page.url.searchParams.get('id')));
	const journey = $derived(session ? (journeys[session.journeyId] ?? mataAtlantica) : mataAtlantica);
	const powers = $derived(journey.steps.filter((step) => step.kind === 'mission' && step.power));
	let origin = $state('');
	const verificationUrl = $derived(
		session && origin
			? new URL(resolve('/verify') + '?code=' + encodeURIComponent(session.certificateCode), origin).href
			: ''
	);
	const qr = $derived(
		verificationUrl
			? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(renderSVG(verificationUrl))
			: ''
	);

	onMount(() => {
		origin = location.origin;
		void sessions.load();
	});
</script>

<svelte:head><title>Certificados · Guardiões da Mata Atlântica</title></svelte:head>

<main>
	{#if !sessions.loaded}
		<div class="page empty">
			<h1>Certificados</h1>
			<p role="status">Abrindo a jornada deste aparelho…</p>
		</div>
	{:else if !session}
		<div class="page empty">
			<h1>Jornada não encontrada</h1>
			{#if sessions.error}<p role="alert">{sessions.error}</p>{/if}<a class="button" href={resolve('/')}
				>Voltar ao início</a
			>
		</div>
	{:else if !session.oathAt || !isFinished(session, journey)}
		<div class="page empty">
			<h1>A jornada ainda não terminou</h1>
			<p>Conclua as cinco missões e faça o juramento antes de emitir os certificados.</p>
			<a class="button" href={resolve('/journey') + '?id=' + encodeURIComponent(session.id)}
				>Voltar à jornada</a
			>
		</div>
	{:else}
		<div class="toolbar page">
			<a class="button quiet" href={resolve('/journey') + '?id=' + encodeURIComponent(session.id)}
				><Icon name="back" /> Voltar à jornada</a
			>
			<button
				class="button"
				type="button"
				disabled={!qr || session.groups.length === 0}
				onclick={() => window.print()}><Icon name="print" /> Imprimir ou salvar em PDF</button
			>
			<p>
				Um certificado para cada grupo. Para verificar o código, é preciso conexão e uma cópia da jornada na
				nuvem.
			</p>
		</div>
		{#if session.groups.length === 0}<p class="page">Nenhum grupo cadastrado nesta jornada.</p>{/if}
		<div class="certificates">
			{#each session.groups as group (group.id)}
				<article
					class="certificate"
					style:--group-color={group.color}
					aria-label="Certificado do grupo {group.name}"
				>
					<header>
						<p class="eyebrow">Certificado de participação</p>
						<h1>Guardiões da Mata Atlântica</h1>
					</header>
					<div class="recognition">
						<p>Certificamos que o grupo</p>
						<h2 class="group-name">{group.name}</h2>
						<p>concluiu a jornada na PENAP</p>
						<p class="date">em {formatDate(session.date)}</p>
						{#if session.school || session.className}<p class="school">
								{session.school}{session.school && session.className ? ' · ' : ''}{session.className}
							</p>{/if}
					</div>
					<section class="powers" aria-label="Poderes conquistados">
						<h3>Poderes conquistados</h3>
						<ul>
							{#each powers as step (step.id)}<li>{step.power}</li>{/each}
						</ul>
					</section>
					<footer>
						<div class="signature">
							<p>{session.guide || ' '}</p>
							<span>Guia</span>
						</div>
						<p class="score"><strong>{groupScore(session, group.id)}</strong> pontos na jornada</p>
						<div class="verification">
							{#if qr}<img
									src={qr}
									width="100"
									height="100"
									alt="Código QR para verificar este certificado"
								/>{/if}
							<p>Código do certificado<br /><strong>{session.certificateCode}</strong></p>
						</div>
					</footer>
				</article>
			{/each}
		</div>
	{/if}
</main>

<style>
	main {
		padding-block: 1.5rem 3rem;
	}
	.empty {
		display: grid;
		gap: 1.5rem;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.toolbar .button {
		flex: 1 1 12rem;
	}
	.toolbar p {
		width: 100%;
		color: var(--text-soft);
		font-size: var(--step--1);
	}
	.certificates {
		display: grid;
		gap: 2rem;
		width: min(100% - 2 * var(--gutter), 66rem);
		margin-inline: auto;
	}
	.certificate {
		display: grid;
		align-content: space-between;
		gap: 1.5rem;
		padding: clamp(1.25rem, 4vw, 3rem);
		border: 2px solid var(--gold);
		border-radius: var(--radius-s);
		background: var(--surface-solid);
		text-align: center;
		overflow-wrap: anywhere;
	}
	header,
	.recognition {
		display: grid;
		gap: 0.5rem;
	}
	.eyebrow {
		font-size: var(--step--1);
		color: var(--text-soft);
	}
	h1 {
		font-size: clamp(1.75rem, 4vw, 3rem);
	}
	.group-name {
		color: var(--group-color);
		font-size: clamp(2.5rem, 6vw, 4rem);
	}
	.recognition {
		font-family: var(--font-story);
		font-size: var(--step-1);
	}
	.date,
	.school {
		font-size: var(--step-0);
	}
	.school {
		font-family: var(--font-ui);
	}
	.powers h3 {
		margin-bottom: 0.75rem;
		font-size: var(--step-1);
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem 1rem;
		padding: 0;
		margin: 0;
		list-style: none;
		font-size: var(--step--1);
	}
	li {
		padding: 0.25rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
	}
	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: end;
		gap: 1.5rem;
		font-size: var(--step--1);
	}
	.signature {
		flex: 1 1 8rem;
	}
	.signature p {
		min-height: 2rem;
		padding-bottom: 0.25rem;
		border-bottom: 1px solid var(--text);
	}
	.signature span {
		display: block;
		margin-top: 0.25rem;
	}
	.score {
		flex: 1 1 8rem;
	}
	.score strong {
		display: block;
		font-family: var(--font-story);
		font-size: var(--step-3);
		font-variant-numeric: lining-nums tabular-nums;
	}
	.verification {
		display: flex;
		flex: 1 1 12rem;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		text-align: left;
	}
	.verification img {
		flex: none;
		padding: 0.25rem;
		background: white;
	}
	.verification strong {
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.08em;
	}
	@page {
		size: A4 landscape;
		margin: 10mm;
	}
	@media print {
		:global(body) {
			margin: 0;
			background: white;
		}
		:global(body *) {
			visibility: hidden;
		}
		.toolbar {
			display: none;
		}
		.certificates,
		.certificates :global(*) {
			visibility: visible;
		}
		.certificates {
			position: absolute;
			top: 0;
			left: 0;
			display: block;
			width: 277mm;
			margin: 0;
		}
		.certificate {
			--surface-solid: white;
			--text: #15291c;
			--text-soft: #4a5d4f;
			--border: #c6d1c3;
			--gold: #d99a00;
			width: 277mm;
			height: 190mm;
			gap: 5mm;
			padding: 10mm 12mm;
			border-radius: 0;
			color: var(--text);
			break-inside: avoid;
			break-after: page;
			print-color-adjust: exact;
			-webkit-print-color-adjust: exact;
		}
		.certificate:last-child {
			break-after: auto;
		}
		h1 {
			font-size: 28pt;
		}
		.group-name {
			font-size: 38pt;
		}
		.recognition {
			font-size: 17pt;
		}
		.date,
		.school {
			font-size: 12pt;
		}
		.powers h3 {
			font-size: 15pt;
		}
		ul,
		footer {
			font-size: 10pt;
		}
		footer {
			flex-wrap: nowrap;
		}
		.verification img {
			width: 26mm;
			height: 26mm;
		}
	}
</style>
