<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { GAME_ABI, type GameDispose, type GameManifest, type GameModule } from '../../../game/abi.ts';
	import Icon from '#lib/components/Icon.svelte';
	import SecretBadge from '#lib/components/SecretBadge.svelte';
	import { beginGamePresentation, type GamePresentation } from '#lib/data/game-presentation.ts';
	import { GamePacks, getGamePackInfo, type DownloadProgress } from '#lib/data/game-pack.ts';
	import { gameFileUrl } from '#lib/data/game-pack-cache.ts';
	import { acquireGameGpu } from '#lib/diorama/host.svelte.ts';
	import { pwa } from '#lib/state/pwa.svelte.ts';
	import { secretBadge } from '#lib/state/secret-badge.svelte.ts';

	let status = $state<
		'checking' | 'ready' | 'downloading' | 'mounting' | 'playing' | 'error' | 'unsupported'
	>('checking');
	let pack = $state.raw<GameManifest | null>(null);
	let progress = $state<DownloadProgress>({ loaded: 0, total: 0 });
	let message = $state('');
	let sizeKB = $state<number | null>(null);
	let element: HTMLDivElement;
	let launcherRoot: HTMLElement;
	let presentation: GamePresentation | undefined;
	let manager: GamePacks;
	let controller: AbortController | undefined;
	let dispose: GameDispose | undefined;
	let releaseGpu: (() => void) | undefined;
	let styles: HTMLLinkElement[] = [];
	let generation = 0;
	let destroyed = false;
	let stopping: Promise<void> = Promise.resolve();
	const busy = $derived(status === 'downloading' || status === 'mounting');
	const percent = $derived(progress.total ? Math.floor((100 * progress.loaded) / progress.total) : 0);
	const megabytes = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
	const size = (bytes: number) =>
		bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${megabytes.format(bytes / 1024 / 1024)} MB`;

	onMount(() => {
		manager = new GamePacks({ root: new URL(resolve('/'), location.href) });
		if (typeof WebGL2RenderingContext === 'undefined') {
			status = 'unsupported';
			return;
		}
		void manager.current().then((saved) => {
			if (destroyed) return;
			pack = saved;
			status = 'ready';
			if (!saved)
				void getGamePackInfo(manager.root).then((info) => {
					if (!destroyed) sizeKB = info.sizeKB;
				});
		});
		return () => {
			destroyed = true;
			void stop();
		};
	});
	function stop(): Promise<void> {
		generation++;
		controller?.abort();
		controller = undefined;
		const oldDispose = dispose,
			oldRelease = releaseGpu,
			oldStyles = styles,
			oldPresentation = presentation;
		presentation = undefined;
		dispose = undefined;
		releaseGpu = undefined;
		styles = [];
		stopping = stopping
			.then(async () => {
				try {
					await oldDispose?.();
				} finally {
					for (const link of oldStyles) link.remove();
					oldRelease?.();
					await oldPresentation?.release();
				}
			})
			.catch(() => {
				message = 'A aventura foi encerrada. Tente entrar de novo.';
			});
		return stopping;
	}
	async function exit() {
		await stop();
		if (!destroyed) status = 'ready';
	}
	async function fail(error: unknown, token: number) {
		if (token !== generation || destroyed) return;
		await stop();
		if (destroyed) return;
		if (error instanceof Error && error.message === 'game-webgl-unavailable') {
			status = 'unsupported';
			return;
		}
		message = !pwa.online
			? 'Sem internet. O download precisa de conexão; a versão já guardada continua disponível.'
			: error instanceof DOMException && error.name === 'QuotaExceededError'
				? 'Não há espaço para guardar a nova versão. A anterior continua disponível.'
				: 'Não foi possível preparar a aventura. Confira a conexão e tente de novo.';
		status = 'error';
	}
	function enter() {
		if (destroyed || busy || status === 'playing' || status === 'checking') return;
		// Fullscreen must be requested in this handler, before the first await.
		presentation = beginGamePresentation(launcherRoot);
		if (pack) void start(pack);
		else void download();
	}
	function downloadFromGesture() {
		if (destroyed || busy || status === 'playing' || !pwa.online) return;
		presentation = beginGamePresentation(launcherRoot);
		void download();
	}
	async function download() {
		await stopping;
		if (destroyed || busy || status === 'playing') return;
		const token = ++generation;
		controller = new AbortController();
		status = 'downloading';
		message = '';
		progress = { loaded: 0, total: 0 };
		try {
			const latest = await manager.latest(controller.signal);
			const saved = await manager.download(latest, {
				signal: controller.signal,
				progress: (value) => {
					if (token === generation) progress = value;
				}
			});
			if (token !== generation || destroyed) return;
			pack = saved;
			controller = undefined;
			await start(saved);
		} catch (error) {
			await fail(error, token);
		}
	}
	function loadStyle(url: string, signal: AbortSignal): Promise<void> {
		return new Promise((resolveStyle, reject) => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = url;
			styles.push(link);
			const cleanup = () => {
				signal.removeEventListener('abort', abort);
				link.onload = null;
				link.onerror = null;
			};
			const abort = () => {
				cleanup();
				link.remove();
				reject(new DOMException('cancelled', 'AbortError'));
			};
			link.onload = () => {
				cleanup();
				resolveStyle();
			};
			link.onerror = () => {
				cleanup();
				reject(new Error('game-style'));
			};
			signal.addEventListener('abort', abort, { once: true });
			document.head.append(link);
		});
	}
	async function start(saved: GameManifest) {
		await stopping;
		if (destroyed || status === 'playing' || status === 'mounting') return;
		const token = ++generation;
		controller = new AbortController();
		const signal = controller.signal;
		status = 'mounting';
		try {
			const release = await acquireGameGpu();
			if (token !== generation || destroyed) {
				release();
				return;
			}
			releaseGpu = release;
			await Promise.all(
				saved.files
					.filter((file) => file.path.endsWith('.css'))
					.map((file) => loadStyle(gameFileUrl(manager.root, saved.packId, file.path), signal))
			);
			signal.throwIfAborted();
			const url = gameFileUrl(manager.root, saved.packId, saved.entry);
			const module: GameModule = await import(/* @vite-ignore */ url);
			if (token !== generation || destroyed) return;
			if (module.abi !== GAME_ABI || typeof module.mountGame !== 'function') throw new Error('game-abi');
			dispose = module.mountGame(element, {
				abi: GAME_ABI,
				exit: () => {
					if (token === generation) void exit();
				},
				earnBadge: () => {
					if (token === generation) secretBadge.earn();
				}
			});
			status = 'playing';
		} catch (error) {
			await fail(error, token);
		}
	}
</script>

<svelte:head><title>Trilha secreta · Guardiões da Mata Atlântica</title></svelte:head>

<main bind:this={launcherRoot} class="page launcher" data-game-launcher data-pack-id={pack?.packId}>
	<header class="bar">
		<a class="icon-button" href={resolve('/')} aria-label="Voltar para o início"><Icon name="back" /></a>
		<h1>{status === 'unsupported' ? 'A Trilha Secreta precisa de gráficos 3D' : 'Trilha secreta'}</h1>
	</header>
	<div bind:this={element} class="game" hidden={status !== 'playing' && status !== 'mounting'}></div>
	{#if status === 'unsupported'}
		<section class="card intro">
			<div class="emblem" aria-hidden="true"><Icon name="compass" weight="duotone" size={44} /></div>
			<p class="lead">
				Este celular não consegue abrir o mundo 3D da trilha. Sua jornada pelos Guardiões da Mata Atlântica
				continua funcionando normalmente!
			</p>
		</section>
	{:else if status === 'playing'}
		<button class="button quiet" type="button" onclick={exit}>Sair da aventura</button>
	{:else}
		<section class="card intro" aria-busy={busy}>
			<div class="emblem" aria-hidden="true"><Icon name="compass" weight="duotone" size={44} /></div>
			<p class="lead">
				Entre as árvores da Mata Atlântica há um mundo 3D escondido, onde você caminha pela reserva, salta
				pelas pedras do rio e ajuda a guarda-parque Iara.
			</p>
			<div class="status" role="status" aria-live="polite">
				{#if status === 'checking'}
					<p class="note"><Icon name="compass" size={20} /> Procurando a aventura neste aparelho…</p>
				{:else if status === 'downloading'}
					<p class="note"><Icon name="download" size={20} /> Guardando a aventura… {percent}%</p>
					<progress max={progress.total || 1} value={progress.loaded} aria-label="Download da aventura"
					></progress>
					{#if progress.total}<p class="hint">{size(progress.loaded)} de {size(progress.total)}</p>{/if}
				{:else if status === 'mounting'}
					<p class="note"><Icon name="sparkle" size={20} /> Abrindo a clareira…</p>
				{:else if status === 'error'}
					<p class="note" data-tone="danger"><Icon name="warning" size={20} /> {message}</p>
				{:else if pack}
					<p class="note" data-tone="success">
						<Icon name="check" size={20} /> A trilha está guardada neste celular e funciona sem internet.
					</p>
				{:else if !pwa.online}
					<p class="note" data-tone="warning">
						<Icon name="wifi-off" size={20} /> Sem internet. Conecte-se uma vez para baixar a aventura.
					</p>
				{:else if sizeKB !== null}
					<p class="note">
						<Icon name="download" size={20} /> Na primeira vez, baixa cerca de {size(sizeKB * 1024)} e depois
						fica guardada neste celular.
					</p>
				{:else}
					<p class="note"><Icon name="download" size={20} /> O jogo só é baixado quando você entrar.</p>
				{/if}
			</div>
			<div class="actions">
				{#if busy}
					<button class="button quiet wide" type="button" onclick={exit}>Cancelar</button>
				{:else if pack}
					<button class="button wide" type="button" onclick={enter}>
						<Icon name="footprints" weight="duotone" size={22} /> Entrar na trilha
					</button>
					{#if pwa.online}
						<button class="text-button" type="button" onclick={downloadFromGesture}>
							<Icon name="download" size={18} />
							{status === 'error' ? 'Tentar o download de novo' : 'Baixar versão mais recente'}
						</button>
					{/if}
				{:else if status !== 'checking'}
					<button class="button wide" type="button" disabled={!pwa.online} onclick={downloadFromGesture}>
						<Icon name="footprints" weight="duotone" size={22} />
						{status === 'error' ? 'Tentar o download de novo' : 'Entrar na trilha'}
					</button>
				{/if}
			</div>
		</section>
		<SecretBadge />
	{/if}
</main>

<style>
	.launcher {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: 1.25rem;
		padding-bottom: max(2rem, env(safe-area-inset-bottom));
	}

	/* The page itself goes fullscreen before the game mounts, so it keeps the app's background. */
	.launcher:fullscreen {
		width: 100%;
		max-width: none;
		height: 100dvh;
		overflow: auto;
		background: var(--bg-image);
		background-color: var(--bg);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-block: 0.25rem;
	}

	.bar .icon-button {
		margin-left: -0.75rem;
	}

	h1 {
		flex: 1;
		font-size: var(--step-2);
	}

	.intro {
		display: grid;
		gap: 1rem;
		padding: 1.25rem;
	}

	/* Same emblem as the sheet that revealed the trail. */
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

	.lead {
		color: var(--text-soft);
	}

	.status {
		display: grid;
		gap: 0.5rem;
	}

	.note {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		font-size: var(--step--1);
		font-weight: 700;
		color: var(--accent-strong);
	}

	/* The icon sits on the first line of text, however many lines the message takes. */
	.note :global(.icon) {
		margin-top: 0.1em;
	}

	.note[data-tone='success'] :global(.icon) {
		color: var(--success);
	}

	.note[data-tone='warning'] :global(.icon) {
		color: var(--warning);
	}

	.note[data-tone='danger'] {
		color: var(--danger);
	}

	.hint {
		color: var(--text-faint);
		font-size: var(--step--1);
	}

	progress {
		appearance: none;
		width: 100%;
		height: 0.75rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--surface-sunken);
		overflow: hidden;
	}

	progress::-webkit-progress-bar {
		background: var(--surface-sunken);
	}

	progress::-webkit-progress-value {
		background: var(--xp-gradient);
	}

	progress::-moz-progress-bar {
		background: var(--xp-gradient);
	}

	/* One clear way in; updating is a quiet extra underneath. */
	.actions {
		display: grid;
		justify-items: center;
		gap: 0.25rem;
		min-height: var(--tap);
	}

	.text-button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 44px;
		padding: 0 0.75rem;
		border: 0;
		background: none;
		color: var(--accent-strong);
		font-size: var(--step--1);
		font-weight: 700;
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
		touch-action: manipulation;
	}
</style>
