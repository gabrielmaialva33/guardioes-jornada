<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import GroupMark from '#lib/components/GroupMark.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { journeys } from '#lib/content/mata-atlantica.ts';
	import { formatDate, normalizeCertificateCode } from '#lib/session.ts';
	import { supabase } from '#lib/supabase/client.ts';
	import type { Database, Json } from '#lib/supabase/database.types.ts';

	type Certificate = Database['public']['Functions']['verify_certificate']['Returns'][number];
	type Status = 'idle' | 'loading' | 'found' | 'not-found' | 'offline' | 'unavailable' | 'error';
	interface Standing {
		name: string;
		color: string;
		score: number;
	}

	let input = $state('');
	let status = $state<Status>(supabase ? 'idle' : 'unavailable');
	let certificate = $state<Certificate | null>(null);
	let errorMessage = $state('');
	let request = 0;
	let controller: AbortController | null = null;
	const uid = $props.id();
	const groups = $derived(parseStandings(certificate?.standings ?? null));

	function parseStandings(value: Json): Standing[] {
		if (!Array.isArray(value)) return [];
		return value.flatMap((entry) => {
			if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
			if (typeof entry.name !== 'string' || typeof entry.score !== 'number' || !Number.isFinite(entry.score))
				return [];
			const color =
				typeof entry.color === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(entry.color)
					? entry.color
					: 'var(--accent)';
			return [{ name: entry.name, color, score: entry.score }];
		});
	}

	function cancelRequest() {
		request += 1;
		controller?.abort();
		controller = null;
	}

	async function verify(value: string) {
		cancelRequest();
		const current = request;
		const code = normalizeCertificateCode(value);
		input = code;
		certificate = null;
		if (!supabase) {
			status = 'unavailable';
			return;
		}
		if (!navigator.onLine) {
			status = 'offline';
			return;
		}
		if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(code)) {
			errorMessage = 'Digite os 8 caracteres do código do certificado.';
			status = 'error';
			return;
		}
		status = 'loading';
		const pending = new AbortController();
		controller = pending;
		const timeout = window.setTimeout(() => pending.abort(), 15000);
		try {
			const { data, error } = await supabase.rpc('verify_certificate', { code }).abortSignal(pending.signal);
			if (current !== request) return;
			if (error) throw error;
			certificate = data?.[0] ?? null;
			status = certificate ? 'found' : 'not-found';
		} catch {
			if (current !== request) return;
			errorMessage = 'Não foi possível verificar agora. Confira a conexão e tente de novo.';
			status = navigator.onLine ? 'error' : 'offline';
		} finally {
			window.clearTimeout(timeout);
			if (current === request) controller = null;
		}
	}

	$effect(() => {
		const code = normalizeCertificateCode(page.url.searchParams.get('code') ?? '');
		input = code;
		if (code) void verify(code);
		else {
			cancelRequest();
			certificate = null;
			status = !supabase ? 'unavailable' : navigator.onLine ? 'idle' : 'offline';
		}
		return cancelRequest;
	});

	function edit(value: string) {
		cancelRequest();
		input = value;
		certificate = null;
		status = !supabase ? 'unavailable' : navigator.onLine ? 'idle' : 'offline';
	}

	function offline() {
		cancelRequest();
		certificate = null;
		status = supabase ? 'offline' : 'unavailable';
	}

	function online() {
		if (status === 'offline') {
			if (input.trim()) void verify(input);
			else status = supabase ? 'idle' : 'unavailable';
		}
	}
</script>

<svelte:head><title>Verificar certificado | Guardiões da Mata Atlântica</title></svelte:head>
<svelte:window onoffline={offline} ononline={online} />

<header class="bar page">
	<a class="icon-button" href={resolve('/')} aria-label="Voltar ao início"><Icon name="back" /></a>
	<h1>Verificar certificado</h1>
	<ThemeToggle />
</header>

<main class="page">
	<section class="intro">
		<div class="emblem" aria-hidden="true">
			<Icon name="certificate" weight="duotone" size={40} />
		</div>
		<p>Confira uma jornada compartilhada pelo guia usando o código impresso no certificado.</p>
	</section>

	<form
		class="card lookup"
		onsubmit={(event) => {
			event.preventDefault();
			void verify(input);
		}}
		aria-busy={status === 'loading'}
	>
		<div class="field">
			<label for={uid}>Código do certificado</label>
			<input
				id={uid}
				name="code"
				value={input}
				oninput={(event) => edit(event.currentTarget.value)}
				autocomplete="off"
				autocapitalize="characters"
				spellcheck="false"
				maxlength="32"
				placeholder="Ex.: 9NFN1011"
				required
				aria-describedby="{uid}-hint"
			/>
		</div>
		<p id="{uid}-hint" class="hint">São 8 caracteres. Não é preciso entrar em uma conta.</p>
		<button class="button wide" type="submit" disabled={status === 'loading' || !supabase}>
			<Icon name="seal" weight="duotone" size={20} />
			{status === 'loading' ? 'Verificando…' : 'Verificar certificado'}
		</button>
	</form>

	<div class="result" aria-live="polite" aria-atomic="true">
		{#if status === 'loading'}
			<section class="card state" role="status">
				<Icon name="cloud-syncing" weight="duotone" size={30} />
				<p>Consultando o certificado…</p>
			</section>
		{:else if status === 'unavailable'}
			<section class="card state">
				<Icon name="info" weight="duotone" size={30} />
				<p>A verificação de certificados está indisponível neste momento.</p>
			</section>
		{:else if status === 'offline'}
			<section class="card state">
				<Icon name="cloud-off" weight="duotone" size={30} />
				<p>Sem internet: a verificação precisa de conexão.</p>
			</section>
		{:else if status === 'not-found'}
			<section class="card state">
				<Icon name="warning" weight="duotone" size={30} />
				<div class="state-text">
					<p><strong>Nenhum certificado com este código.</strong></p>
					<p class="hint">
						Confira o código. A jornada só aparece depois de concluída e compartilhada pelo guia.
					</p>
				</div>
			</section>
		{:else if status === 'error'}
			<section class="card state error-card" role="alert">
				<Icon name="warning" weight="duotone" size={30} />
				<p class="error">{errorMessage}</p>
			</section>
		{:else if status === 'found' && certificate}
			<section class="card verified" aria-labelledby="{uid}-found">
				<div class="verified-head">
					<div class="seal" aria-hidden="true">
						<Icon name="seal" weight="duotone" size={36} />
					</div>
					<div>
						<span class="pill gold">Autêntico</span>
						<h2 id="{uid}-found">Certificado encontrado</h2>
					</div>
				</div>

				<dl>
					<div>
						<dt>Escola</dt>
						<dd>{certificate.school || 'Não informada'}</dd>
					</div>
					<div>
						<dt>Turma</dt>
						<dd>{certificate.class_name || 'Não informada'}</dd>
					</div>
					<div>
						<dt>Data da visita</dt>
						<dd>{formatDate(certificate.visit_date)}</dd>
					</div>
					<div>
						<dt>Local da jornada</dt>
						<dd>{journeys[certificate.journey_id]?.place ?? 'Não informado'}</dd>
					</div>
				</dl>

				<div class="groups-section">
					<h3>Grupos participantes</h3>
					{#if groups.length > 0}
						<ul>
							{#each groups as group, index (index)}
								<li>
									<GroupMark name={group.name} color={group.color} size={2.25} />
									<span class="group-name">{group.name}</span>
									<strong class="score">
										<span class="digits">{group.score}</span>
										{group.score === 1 ? 'ponto' : 'pontos'}
									</strong>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="hint">O placar dos grupos não foi informado.</p>
					{/if}
				</div>
			</section>
		{/if}
	</div>
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
		padding-bottom: max(2.5rem, env(safe-area-inset-bottom));
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

	.lookup {
		display: grid;
		gap: 0.875rem;
		padding: 1.25rem;
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
		color: var(--text);
		font-family: var(--font-story);
		font-size: var(--step-2);
		font-weight: 700;
		font-variant-numeric: lining-nums tabular-nums;
		letter-spacing: 0.12em;
	}

	input::placeholder {
		color: var(--text-faint);
		font-weight: 400;
		letter-spacing: 0.04em;
	}

	input:focus-visible {
		border-color: var(--accent-strong);
	}

	.hint {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	.result {
		display: grid;
		gap: 0.75rem;
		overflow-wrap: anywhere;
	}

	.state {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 1.125rem 1.25rem;
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.4;
	}

	.state p {
		color: var(--text);
	}

	.state-text {
		display: grid;
		gap: 0.2rem;
	}

	.error-card {
		border-color: color-mix(in oklab, var(--danger) 40%, transparent);
		background: var(--danger-soft);
		color: var(--danger);
	}

	.error {
		color: var(--danger);
		font-weight: 700;
	}

	.verified {
		display: grid;
		gap: 1.25rem;
		padding: 1.25rem;
		border-color: color-mix(in oklab, var(--gold) 55%, transparent);
		box-shadow: var(--glow-gold), var(--shadow), var(--highlight);
	}

	.verified-head {
		display: flex;
		align-items: center;
		gap: 0.875rem;
	}

	.seal {
		display: grid;
		place-items: center;
		flex: none;
		width: 3.75rem;
		height: 3.75rem;
		border: 1.5px solid color-mix(in oklab, var(--gold) 55%, transparent);
		border-radius: 50%;
		background: var(--gold-soft);
		color: var(--gold);
		--icon-tone: var(--accent);
		--icon-tone-opacity: 0.5;
	}

	h2 {
		margin-top: 0.2rem;
		font-size: var(--step-2);
	}

	h3 {
		font-size: var(--step-1);
	}

	dl {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
	}

	dt {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	dd {
		margin: 0;
		font-weight: 700;
	}

	.groups-section {
		display: grid;
		gap: 0.625rem;
	}

	ul {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
	}

	.group-name {
		flex: 1;
		min-width: 0;
		font-weight: 700;
	}

	.score {
		color: var(--text-soft);
		font-size: var(--step--1);
		font-weight: 700;
	}

	.digits {
		margin-right: 0.2rem;
		color: var(--text);
		font-family: var(--font-story);
		font-size: var(--step-2);
		font-weight: 800;
		font-variant-numeric: lining-nums tabular-nums;
	}
</style>
