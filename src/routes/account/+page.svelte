<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon, { type IconName } from '#lib/components/Icon.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { auth, describeAuthError } from '#lib/state/auth.svelte.ts';
	import { pwa } from '#lib/state/pwa.svelte.ts';
	import { sync } from '#lib/state/sync.svelte.ts';

	const uid = $props.id();

	let importing = $state(false);

	async function importGuests() {
		importing = true;
		try {
			await sync.importGuestSessions();
		} finally {
			importing = false;
		}
	}

	let email = $state('');
	let code = $state('');
	let codeSent = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

	const syncIcon = $derived<IconName>(
		sync.status === 'syncing'
			? 'cloud-syncing'
			: sync.status === 'offline'
				? 'cloud-off'
				: sync.status === 'error'
					? 'cloud-error'
					: 'cloud'
	);

	async function sendCode(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		try {
			await auth.sendCode(email);
			codeSent = true;
		} catch (e) {
			error = describeAuthError(e);
		} finally {
			busy = false;
		}
	}

	async function verify(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		try {
			await auth.verifyCode(email, code);
			code = '';
			codeSent = false;
		} catch (e) {
			error = describeAuthError(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sua conta | Guardiões da Mata Atlântica</title>
</svelte:head>

<header class="bar page">
	<a class="icon-button" href={resolve('/')} aria-label="Voltar para o início"><Icon name="back" /></a>
	<h1>Sua conta</h1>
	<ThemeToggle />
</header>

<main class="page">
	<section class="card explain">
		<div class="emblem" aria-hidden="true">
			<Icon name="cloud" weight="duotone" size={38} />
		</div>
		<p class="lead">
			As jornadas ficam sempre salvas neste celular. Com a conta, elas também ganham um backup na nuvem quando
			houver internet, e os certificados podem ser verificados online.
		</p>
	</section>

	{#if !auth.available}
		<section class="card notice">
			<Icon name="cloud-off" weight="duotone" size={28} />
			<p class="note">O backup na nuvem não está configurado nesta versão do app.</p>
		</section>
	{:else if !auth.ready}
		<section class="card notice">
			<Icon name="cloud-syncing" weight="duotone" size={28} />
			<p class="note">Verificando a conta…</p>
		</section>
	{:else if auth.user}
		{#if sync.guestCount > 0}
			<section class="card import">
				<Icon name="users" weight="duotone" size={32} />
				<p>
					{sync.guestCount === 1
						? 'Há 1 jornada criada neste celular antes de você entrar.'
						: `Há ${sync.guestCount} jornadas criadas neste celular antes de você entrar.`}
					Quer guardá-las na sua conta?
				</p>
				<button class="button wide" type="button" disabled={importing} onclick={importGuests}>
					{importing ? 'Guardando…' : 'Guardar na minha conta'}
				</button>
			</section>
		{/if}
		<section class="card signed-in">
			<div class="guide-row">
				<Icon name="user" weight="duotone" size={32} />
				<p>Entrou como <strong>{auth.user.email}</strong></p>
			</div>

			<div class="sync-card" data-status={sync.status}>
				<Icon name={syncIcon} weight="duotone" size={28} />
				<dl>
					<dt>Backup</dt>
					<dd>
						{#if sync.status === 'syncing'}
							Salvando agora
						{:else if sync.status === 'offline'}
							Sem internet. {sync.pending > 0
								? `${sync.pending} pendente(s), sobe quando o sinal voltar.`
								: 'Nada pendente.'}
						{:else if sync.status === 'error'}
							A última tentativa falhou. O app tenta de novo sozinho.
						{:else if sync.pending > 0}
							{sync.pending} pendente(s)
						{:else}
							Em dia{sync.lastSyncAt ? `, às ${timeFormat.format(sync.lastSyncAt)}` : ''}
						{/if}
					</dd>
				</dl>
			</div>

			<button
				class="button wide"
				type="button"
				disabled={!pwa.online || sync.status === 'syncing'}
				onclick={() => sync.run({ pull: true })}
			>
				<Icon name="cloud" size={20} /> Fazer backup agora
			</button>
			<button class="button quiet wide" type="button" onclick={() => auth.signOut()}>
				<Icon name="sign-out" size={20} /> Sair deste celular
			</button>
		</section>
	{:else if !codeSent}
		<form class="card auth-form" onsubmit={sendCode}>
			<h2><Icon name="user" weight="duotone" size={26} /> Entrar com e-mail</h2>
			<div class="field">
				<label for="{uid}-email">Seu e-mail</label>
				<input
					id="{uid}-email"
					type="email"
					bind:value={email}
					required
					autocomplete="email"
					inputmode="email"
					placeholder="voce@exemplo.com"
				/>
			</div>
			<p class="hint">Enviamos um código de 6 dígitos. Não precisa de senha.</p>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button class="button wide" type="submit" disabled={busy || !pwa.online}>
				{busy ? 'Enviando…' : 'Receber código'}
			</button>
			{#if !pwa.online}<p class="hint">Conecte-se à internet para entrar.</p>{/if}
		</form>
	{:else}
		<form class="card auth-form" onsubmit={verify}>
			<h2><Icon name="seal" weight="duotone" size={26} /> Confirmar código</h2>
			<div class="field">
				<label for="{uid}-code">Código enviado para {email}</label>
				<input
					id="{uid}-code"
					bind:value={code}
					required
					autocomplete="one-time-code"
					inputmode="numeric"
					pattern="[0-9 ]{'{6,7}'}"
					maxlength="7"
					class="code"
				/>
			</div>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button class="button wide" type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
			<button class="button quiet wide" type="button" onclick={() => ((codeSent = false), (error = null))}>
				Usar outro e-mail
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

	.explain {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 1rem;
		padding: 1.25rem;
	}

	.emblem {
		display: grid;
		place-items: center;
		width: 3.75rem;
		height: 3.75rem;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--surface-sunken);
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.4;
	}

	.lead {
		color: var(--text-soft);
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 1.25rem;
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.4;
	}

	.auth-form,
	.signed-in {
		display: grid;
		gap: 0.875rem;
		padding: 1.25rem;
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--step-1);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.45;
	}

	.guide-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.4;
	}

	.guide-row p {
		color: var(--text-soft);
	}

	.guide-row strong {
		display: block;
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.sync-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface-sunken);
		color: var(--accent-strong);
		--icon-tone: var(--gold);
		--icon-tone-opacity: 0.4;
	}

	.sync-card[data-status='error'] {
		border-color: color-mix(in oklab, var(--danger) 40%, transparent);
		color: var(--danger);
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

	.code {
		font-family: var(--font-story);
		font-size: var(--step-3);
		font-weight: 700;
		font-variant-numeric: lining-nums tabular-nums;
		letter-spacing: 0.28em;
		text-align: center;
	}

	.hint,
	.note {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	.error {
		padding: 0.625rem 0.875rem;
		border: 1px solid color-mix(in oklab, var(--danger) 40%, transparent);
		border-radius: var(--radius-s);
		background: var(--danger-soft);
		color: var(--danger);
		font-size: var(--step--1);
		font-weight: 700;
	}

	dl {
		display: grid;
		gap: 0.15rem;
		margin: 0;
		min-width: 0;
	}

	dt {
		color: var(--text-soft);
		font-size: var(--step--1);
	}

	dd {
		margin: 0;
		color: var(--text);
		font-weight: 700;
	}

	.import {
		display: grid;
		gap: 0.75rem;
		padding: 1.25rem;
		border-color: color-mix(in oklab, var(--gold) 45%, transparent);
		color: var(--gold);
		--icon-tone: var(--accent);
		--icon-tone-opacity: 0.5;
	}

	.import p {
		color: var(--text);
	}
</style>
