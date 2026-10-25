<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { GAME_ABI, type GameDispose, type GameManifest, type GameModule } from '../../../game/abi.ts';
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
	const size = (bytes: number) =>
		new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / 1024);

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
	<header>
		<a class="button quiet" href={resolve('/')}>Voltar para a jornada</a>
		<h1>{status === 'unsupported' ? 'A Trilha Secreta precisa de gráficos 3D' : 'Trilha secreta'}</h1>
	</header>
	<div bind:this={element} class="game" hidden={status !== 'playing' && status !== 'mounting'}></div>
	{#if status === 'unsupported'}
		<section class="card">
			<p>
				Este celular está no modo leve para economizar memória e bateria, por isso o minijogo 3D não abre
				aqui. Sua jornada principal pelos Guardiões da Mata Atlântica continua funcionando normalmente!
			</p>
		</section>
	{:else if status === 'playing'}
		<button class="button quiet" type="button" onclick={exit}>Sair da aventura</button>
	{:else}
		<section class="card" aria-busy={busy}>
			<p>
				Entre as árvores da Mata Atlântica há um mundo 3D escondido onde você pode caminhar pela reserva,
				saltar pelas pedras do rio e ajudar a guarda-parque Iara.
			</p>
			<div role="status" aria-live="polite">
				{#if status === 'checking'}<p>Procurando a aventura neste aparelho…</p>
				{:else if status === 'downloading'}
					<p>Guardando a aventura… {percent}%</p>
					<progress max={progress.total || 1} value={progress.loaded} aria-label="Download da aventura"
					></progress>
					{#if progress.total}<p class="hint">
							{size(progress.loaded)} de {size(progress.total)} KB guardados
						</p>{/if}
				{:else if status === 'mounting'}<p>Abrindo a clareira…</p>
				{:else if status === 'error'}<p>{message}</p>
				{:else if pack}<p>Pronto para jogar neste celular, mesmo sem internet.</p>
				{:else if !pwa.online}<p>Sem internet. Conecte-se uma vez para baixar a aventura.</p>
				{:else if sizeKB !== null}<p>
						Primeiro acesso: baixa cerca de {sizeKB} KB (depois fica guardado neste celular).
					</p>
				{:else}<p>O jogo só será baixado quando você entrar.</p>{/if}
			</div>
			<div class="actions">
				{#if busy}<button class="button quiet" type="button" onclick={exit}>Cancelar</button>
				{:else if status !== 'checking'}
					{#if pack}<button class="button" type="button" onclick={enter}>Entrar na trilha</button>{/if}
					<button
						class="button"
						class:quiet={!!pack}
						type="button"
						disabled={!pwa.online}
						onclick={downloadFromGesture}
					>
						{status === 'error'
							? 'Tentar o download de novo'
							: pack
								? 'Baixar versão mais recente'
								: 'Entrar na trilha'}
					</button>
				{/if}
			</div>
		</section>
	{/if}
</main>

<style>
	.launcher:fullscreen {
		box-sizing: border-box;
		width: 100%;
		max-width: none;
		height: 100dvh;
		overflow: auto;
		background: var(--canopy, #10271b);
	}
	.launcher {
		padding-block: 1rem 2rem;
	}
	header {
		margin-bottom: 1.25rem;
	}
	h1 {
		margin-block: 1rem;
		font-family: var(--font-story);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	progress {
		width: 100%;
		accent-color: var(--spring);
	}
	.game {
		margin-bottom: 1rem;
	}
</style>
