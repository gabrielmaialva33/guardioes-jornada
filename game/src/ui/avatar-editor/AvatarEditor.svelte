<script lang="ts">
	/**
	 * Roblox-style avatar editor: a live 3D preview on the left (on top in
	 * portrait) and categories as tabs with 3D thumbnails on the right. Edits a
	 * draft; "Usar este personagem" hands it to `onapply`, "Cancelar", the close
	 * button and Escape call `onclose` without touching the saved profile.
	 * Control and sound settings live elsewhere (see the wiring note in the report).
	 */
	import { untrack } from 'svelte';
	import type { AvatarPreset } from '../../avatar/atlas.ts';
	import { AVATAR_ATLAS, AVATAR_PRESETS, KENNEY_SKINS } from '../../avatar/catalog.ts';
	import type { AvatarPart, AvatarProfile } from '../../data/local-save.ts';
	import type { Quality } from '../../render/quality.ts';
	import {
		buildSwatches,
		CLOTHES,
		cloneProfile,
		EDITOR_TABS,
		type EditorOption,
		faceOptions,
		gridMove,
		hairOptions,
		PART_LABELS,
		presetOptions,
		sameProfile,
		setColor,
		skinOptions,
		type TabId,
		tabMove,
		thumbnailKey
	} from './editor.ts';
	import EditorIcon from './EditorIcon.svelte';
	import {
		type AvatarStage,
		createAvatarStage,
		type DisposeReport,
		type StageMetrics,
		type StageStatus
	} from './stage.ts';

	let {
		profile,
		presets = AVATAR_PRESETS,
		skins = Object.keys(KENNEY_SKINS),
		quality,
		reducedMotion,
		initialTab = 'presets',
		onapply,
		onclose,
		onready,
		ondispose,
		onstage
	}: {
		/** The saved profile; the editor works on a copy. */
		profile: AvatarProfile;
		presets?: readonly AvatarPreset[];
		/** Kenney skin ids (a–r). */
		skins?: readonly string[];
		/** The game's quality tier; measured from the preview's own context when omitted. */
		quality?: Quality;
		/** The game's reduced-motion setting; follows prefers-reduced-motion when omitted. */
		reducedMotion?: boolean;
		initialTab?: TabId;
		onapply: (value: AvatarProfile) => Promise<void>;
		onclose: () => void;
		/** First preview frame on screen (open time, thumbnails, GPU): for measurements. */
		onready?: (metrics: StageMetrics) => void;
		/** The preview's GPU objects left after closing (all 0 when nothing leaked). */
		ondispose?: (report: DisposeReport) => void;
		/** The live stage, for measurements and the preview page; undefined once closed. */
		onstage?: (stage: AvatarStage | undefined) => void;
	} = $props();

	const openedAt = performance.now();
	/** How long the cheer plays before the editor hands the draft over. */
	const CHEER_MS = 650;
	const SWATCHES = untrack(() => buildSwatches(presets));

	let draft = $state.raw<AvatarProfile>(untrack(() => cloneProfile(profile)));
	let tab = $state<TabId>(untrack(() => initialTab));
	let message = $state('');
	let busy = $state(false);
	let status = $state<StageStatus>('loading');
	let stage = $state.raw<AvatarStage | undefined>();
	let thumbSize = $state(128);
	/** Bumped when a thumbnail lands, so tiles repaint. */
	let thumbVersion = $state(0);
	let degrees = $state(0);
	let dragHint = $state(true);
	/** The Roupas tab's piece: camiseta, calça or sapatos. */
	let piece = $state<(typeof CLOTHES)[number]>('shirt');
	const PIECE_TITLES: Record<(typeof CLOTHES)[number], string> = {
		shirt: 'Cor da camiseta',
		pants: 'Cor da calça',
		shoes: 'Cor dos sapatos'
	};
	let closed = false;

	const motionQuery =
		typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
	let systemReduced = $state(motionQuery?.matches ?? false);
	$effect(() => {
		if (!motionQuery) return;
		const change = (event: MediaQueryListEvent) => (systemReduced = event.matches);
		motionQuery.addEventListener('change', change);
		return () => motionQuery.removeEventListener('change', change);
	});
	const reduced = $derived(reducedMotion ?? systemReduced);

	const current = $derived(EDITOR_TABS.find((t) => t.id === tab) ?? EDITOR_TABS[0]);
	const options = $derived.by((): EditorOption[] => {
		if (tab === 'presets') return presetOptions(draft, presets);
		if (tab === 'face') return faceOptions(draft);
		if (tab === 'hair') return hairOptions(draft, AVATAR_ATLAS.hairStyles);
		if (tab === 'skins') return skinOptions(draft, skins);
		return [];
	});

	// The preview follows the draft, the tab's framing and the motion setting.
	$effect(() => {
		const next = draft;
		void stage?.setProfile(next).catch(() => {});
	});
	$effect(() => {
		stage?.setFraming(current.framing);
	});
	$effect(() => {
		stage?.setReducedMotion(reduced);
	});
	// Thumbnails: only the visible tab's, in display order.
	$effect(() => {
		stage?.requestThumbnails(
			options.map((option) => ({
				key: thumbnailKey(option.framing, option.profile, option.view),
				profile: option.profile,
				framing: option.framing,
				view: option.view
			}))
		);
	});

	function mountStage(canvas: HTMLCanvasElement) {
		const created = untrack(() =>
			createAvatarStage({
				canvas,
				profile: draft,
				framing: current.framing,
				quality,
				reducedMotion: reduced,
				openedAt,
				onstatus: (value) => (status = value),
				onready: (metrics) => onready?.(metrics),
				onthumbnail: () => thumbVersion++,
				onturn: (value) => (degrees = value),
				ondrag: () => (dragHint = false)
			})
		);
		stage = created;
		thumbSize = created.thumbSize;
		degrees = created.degrees;
		untrack(() => onstage?.(created));
		return () => {
			stage = undefined;
			untrack(() => onstage?.(undefined));
			const report = created.dispose();
			untrack(() => ondispose?.(report));
		};
	}

	/** Draws a cached thumbnail into a tile's canvas; reruns when thumbnails land. */
	function paint(key: string) {
		return (canvas: HTMLCanvasElement) => {
			void thumbVersion;
			const image = stage?.thumbnail(key);
			const context = canvas.getContext('2d');
			if (!context) return;
			context.clearRect(0, 0, canvas.width, canvas.height);
			if (image && image.width > 0) context.drawImage(image, 0, 0, canvas.width, canvas.height);
		};
	}

	function change(next: AvatarProfile) {
		message = '';
		if (sameProfile(next, draft)) return;
		draft = next;
		stage?.react('wave');
	}

	function pickColor(part: AvatarPart, hex: string): boolean {
		const result = setColor(draft, part, hex);
		if (result.message) {
			message = result.message;
			return false;
		}
		change(result.draft);
		return true;
	}

	function cancel() {
		closed = true;
		onclose();
	}

	async function apply() {
		if (busy) return;
		busy = true;
		message = '';
		const value = cloneProfile(draft);
		stage?.react('cheer');
		try {
			if (!reduced && stage?.status === 'ready') await new Promise((done) => setTimeout(done, CHEER_MS));
			if (closed) return;
			await onapply(value);
		} catch {
			message = 'Não foi possível trocar o personagem. Tente novamente.';
		} finally {
			busy = false;
		}
	}

	function selectTab(id: TabId, focus: boolean) {
		if (id !== tab) document.getElementById('avatar-editor-panel')?.scrollTo(0, 0);
		tab = id;
		message = '';
		if (focus) document.getElementById(`avatar-editor-tab-${id}`)?.focus();
	}

	function pieceKey(event: KeyboardEvent, index: number) {
		const next = tabMove(event.key, index, CLOTHES.length);
		if (next === null) return;
		event.preventDefault();
		piece = CLOTHES[next];
		document.getElementById(`avatar-editor-piece-${piece}`)?.focus();
	}

	function tabKey(event: KeyboardEvent, index: number) {
		const next = tabMove(event.key, index, EDITOR_TABS.length);
		if (next === null) return;
		event.preventDefault();
		selectTab(EDITOR_TABS[next].id, true);
	}

	/** Columns of a wrapped radio grid: the items on the first item's row. */
	function columnsOf(items: HTMLElement[]): number {
		const top = items[0]?.offsetTop ?? 0;
		let columns = 0;
		for (const item of items) if (item.offsetTop === top) columns++;
		return Math.max(1, columns);
	}

	/** Arrow keys in a radio grid: selection follows focus. */
	function radioKey(event: KeyboardEvent, index: number, select: (index: number) => void) {
		const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]');
		if (!group) return;
		const items = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
		const next = gridMove(event.key, index, items.length, columnsOf(items));
		if (next === null) return;
		event.preventDefault();
		if (next === index) return;
		select(next);
		items[next]?.focus();
	}

	function turnKey(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') stage?.turn(-1);
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') stage?.turn(1);
		else return;
		event.preventDefault();
		dragHint = false;
	}

	function turnText(value: number): string {
		if (value <= 20 || value >= 340) return `De frente, ${value} graus`;
		if (value >= 160 && value <= 200) return `De costas, ${value} graus`;
		return `${value < 180 ? 'Virado para a esquerda' : 'Virado para a direita'}, ${value} graus`;
	}

	function keydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
			return;
		}
		if (event.key !== 'Tab') return;
		const root = event.currentTarget;
		if (!(root instanceof HTMLElement)) return;
		const nodes = [
			...root.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), [tabindex="0"]:not([disabled])'
			)
		].filter((node) => node.tabIndex >= 0 && node.offsetParent !== null);
		const first = nodes[0];
		const last = nodes[nodes.length - 1];
		if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first?.focus();
		}
	}

	const STATUS_TEXT: Record<StageStatus, string> = {
		loading: 'Preparando seu personagem…',
		ready: '',
		lost: 'Recarregando a prévia…',
		failed: 'A prévia 3D não abriu, mas você ainda pode escolher.'
	};
</script>

{#snippet grid(list: EditorOption[], label: string, variant: string)}
	{@const anySelected = list.some((option) => option.selected)}
	<div class="grid {variant}" role="radiogroup" aria-label={label}>
		{#each list as option, i (option.id)}
			{@const key = thumbnailKey(option.framing, option.profile, option.view)}
			{@const ready = thumbVersion >= 0 && !!stage?.thumbnail(key)}
			<button
				type="button"
				role="radio"
				class="tile"
				class:ready
				aria-checked={option.selected}
				aria-label={option.label}
				title={option.label}
				tabindex={option.selected || (!anySelected && i === 0) ? 0 : -1}
				onclick={() => change(option.profile)}
				onkeydown={(event) => radioKey(event, i, (next) => change(list[next].profile))}
				><canvas class="thumb" width={thumbSize} height={thumbSize} aria-hidden="true" {@attach paint(key)}
				></canvas>{#if option.caption}<span class="caption">{option.caption}</span
					>{/if}{#if option.selected}<span class="check"><EditorIcon name="check" size={14} /></span
					>{/if}</button
			>
		{/each}
	</div>
{/snippet}

{#snippet swatches(part: AvatarPart, title: string, hideTitle = false)}
	{@const list = SWATCHES[part]}
	{@const value = draft.colors[part]}
	{@const known = list.some((swatch) => swatch.hex === value)}
	<div class="swatch-block">
		<h3 id={`avatar-editor-${part}`} class:sr-only={hideTitle}>{title}</h3>
		<div class="swatches">
			<div class="swatch-group" role="radiogroup" aria-labelledby={`avatar-editor-${part}`}>
				{#each list as swatch, i (swatch.hex)}
					{@const checked = swatch.hex === value}
					<button
						type="button"
						role="radio"
						class="swatch"
						aria-checked={checked}
						aria-label={swatch.name}
						title={swatch.name}
						style:--swatch={swatch.hex}
						tabindex={checked || (!known && i === 0) ? 0 : -1}
						onclick={() => pickColor(part, swatch.hex)}
						onkeydown={(event) => radioKey(event, i, (next) => pickColor(part, list[next].hex))}
						>{#if checked}<EditorIcon name="check" size={18} />{/if}</button
					>
				{/each}
			</div>
			<label class="swatch custom" class:checked={!known} title="Outra cor" style:--swatch={value}
				><EditorIcon name="custom" size={20} /><span class="sr-only">Outra cor: {PART_LABELS[part]}</span
				><input
					type="color"
					{value}
					oninput={(event) => {
						if (!pickColor(part, event.currentTarget.value)) event.currentTarget.value = draft.colors[part];
					}}
				/></label
			>
		</div>
	</div>
{/snippet}

<div
	class="editor"
	class:reduced
	role="dialog"
	tabindex="-1"
	aria-modal="true"
	aria-labelledby="avatar-editor-title"
	onpointerdown={(event) => event.stopPropagation()}
	onkeydown={keydown}
	onkeyup={(event) => event.stopPropagation()}
>
	<div class="frame">
		<section class="stage" aria-label="Prévia do personagem">
			<canvas
				class="view"
				role="slider"
				tabindex="0"
				aria-label="Seu personagem em 3D. Arraste ou use as setas para girar."
				aria-valuemin={0}
				aria-valuemax={359}
				aria-valuenow={degrees}
				aria-valuetext={turnText(degrees)}
				onkeydown={turnKey}
				{@attach mountStage}
			></canvas>
			<div class="stage-top">
				<button
					class="round"
					type="button"
					aria-label="Fechar sem mudar"
					title="Fechar sem mudar"
					onclick={cancel}><EditorIcon name="close" size={22} /></button
				>
				<h2 id="avatar-editor-title">Seu personagem</h2>
			</div>
			{#if status !== 'ready'}<p class="stage-status" role="status">
					{#if status === 'loading' || status === 'lost'}<span class="spinner" aria-hidden="true"
						></span>{/if}{STATUS_TEXT[status]}
				</p>{:else if dragHint}<p class="drag-hint" aria-hidden="true">
					<EditorIcon name="rotate" size={18} />Arraste para girar
				</p>{/if}
		</section>

		<section class="panel">
			<div class="tabs" role="tablist" aria-label="Partes do personagem">
				{#each EDITOR_TABS as item, i (item.id)}
					<button
						type="button"
						role="tab"
						class="tab"
						id={`avatar-editor-tab-${item.id}`}
						aria-selected={tab === item.id}
						aria-controls="avatar-editor-panel"
						aria-label={item.title}
						title={item.title}
						tabindex={tab === item.id ? 0 : -1}
						onclick={() => selectTab(item.id, false)}
						onkeydown={(event) => tabKey(event, i)}
						{@attach (node) => {
							if (untrack(() => tab) === item.id) node.focus({ preventScroll: true });
						}}><EditorIcon name={item.icon} size={22} /><span>{item.label}</span></button
					>
				{/each}
			</div>

			<div
				class="content"
				id="avatar-editor-panel"
				role="tabpanel"
				aria-labelledby={`avatar-editor-tab-${tab}`}
			>
				<fieldset disabled={busy}>
					<legend class="sr-only">{current.title}</legend>
					{#if draft.style === 'kenney' && tab !== 'skins' && tab !== 'presets'}<p class="hint">
							Você está com a skin {draft.kenneySkin.toUpperCase()}. Escolher aqui volta às cores clássicas.
						</p>{/if}
					{#if tab === 'presets'}
						{@render grid(options, 'Visuais prontos', 'body')}
					{:else if tab === 'skin'}
						{@render swatches('skin', 'Cor da pele')}
					{:else if tab === 'face'}
						{@render grid(options, 'Rosto', 'big')}
					{:else if tab === 'hair'}
						{@render grid(options, 'Estilo do cabelo', 'head')}
						{@render swatches('hair', 'Cor do cabelo')}
						{#if draft.style === 'classic' && draft.hairStyle === 'bone'}<p class="hint">
								O boné usa a cor da camiseta.
							</p>{/if}
					{:else if tab === 'clothes'}
						<div class="pieces" role="tablist" aria-label="Peças de roupa">
							{#each CLOTHES as part, i (part)}
								<button
									type="button"
									role="tab"
									class="piece"
									id={`avatar-editor-piece-${part}`}
									aria-selected={piece === part}
									aria-controls="avatar-editor-piece-panel"
									tabindex={piece === part ? 0 : -1}
									onclick={() => (piece = part)}
									onkeydown={(event) => pieceKey(event, i)}
									><span class="piece-dot" style:--swatch={draft.colors[part]}></span>{PART_LABELS[
										part
									]}</button
								>
							{/each}
						</div>
						<div
							id="avatar-editor-piece-panel"
							role="tabpanel"
							aria-labelledby={`avatar-editor-piece-${piece}`}
						>
							{@render swatches(piece, PIECE_TITLES[piece], true)}
						</div>
						<p class="hint">O dourado fica para os objetivos da trilha.</p>
					{:else}
						{@render grid(options, 'Skins da Kenney', 'skins')}
					{/if}
				</fieldset>
			</div>

			<p class="message" role="status">{message}</p>
			<footer>
				<button class="cancel" type="button" onclick={cancel}>Cancelar</button><button
					class="apply"
					type="button"
					onclick={apply}
					disabled={busy}>{busy ? 'Aplicando…' : 'Usar este personagem'}</button
				>
			</footer>
		</section>
	</div>
</div>

<style>
	.editor {
		position: absolute;
		inset: 0;
		z-index: 4;
		box-sizing: border-box;
		display: grid;
		padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
			max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
		overflow: hidden;
		background: radial-gradient(120% 80% at 30% 20%, #2d6a4f66, transparent 70%), #10271bf2;
		color: #f1f6ed;
		font: 0.875rem var(--font-ui, system-ui);
		-webkit-tap-highlight-color: transparent;
	}
	.frame {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
		gap: 12px;
		min-width: 0;
		min-height: 0;
	}
	@media (orientation: portrait) {
		.frame {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: 40% minmax(0, 1fr);
		}
	}
	@media (orientation: landscape) and (min-width: 880px) and (min-height: 540px) {
		.editor {
			place-items: center;
		}
		.frame {
			box-sizing: border-box;
			width: min(100%, 62rem);
			height: min(100%, 40rem);
			grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
			gap: 16px;
			padding: 16px;
			border: 1px solid #ffffff38;
			border-radius: 28px;
			background: #173a2b;
			box-shadow: 0 24px 64px #0009;
		}
	}

	/* --- Stage ------------------------------------------------------------------- */
	.stage {
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		border-radius: 22px;
		background:
			radial-gradient(70% 22% at 50% 80%, #1e4d3640, transparent 70%),
			radial-gradient(130% 95% at 50% 28%, #e9f4e4 0%, #b6e6f7 34%, #74c69d 72%, #2d6a4f 100%);
		box-shadow:
			inset 0 0 0 1px #ffffff40,
			inset 0 -48px 64px #1e4d3650;
	}
	.view {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: grab;
		outline: none;
	}
	.view:active {
		cursor: grabbing;
	}
	.view:focus-visible {
		box-shadow: inset 0 0 0 3px #f2c94c;
		border-radius: 22px;
	}
	.stage-top {
		position: absolute;
		top: 8px;
		left: 8px;
		right: 8px;
		display: flex;
		align-items: center;
		gap: 8px;
		pointer-events: none;
	}
	.stage-top > * {
		pointer-events: auto;
	}
	h2 {
		margin: 0;
		padding: 5px 14px 6px;
		border-radius: 999px;
		background: #173a2bd9;
		font: 1.15rem var(--font-story, system-ui);
		line-height: 1.2;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}
	.stage-status,
	.drag-hint {
		position: absolute;
		left: 50%;
		bottom: 10px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: calc(100% - 24px);
		box-sizing: border-box;
		margin: 0;
		padding: 6px 12px;
		border-radius: 999px;
		background: #173a2bd9;
		font-size: 0.75rem;
		white-space: nowrap;
		pointer-events: none;
	}
	.stage-status {
		white-space: normal;
		text-align: center;
	}
	.spinner {
		flex: none;
		width: 14px;
		height: 14px;
		border: 2px solid #ffffff55;
		border-top-color: #74c69d;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* --- Buttons --------------------------------------------------------------- */
	button {
		border: 1px solid #ffffff44;
		border-radius: 14px;
		min-width: 44px;
		min-height: 44px;
		padding: 8px 14px;
		font: inherit;
		color: inherit;
		background: #244c38;
		cursor: pointer;
		touch-action: manipulation;
	}
	button:focus-visible,
	.custom:focus-within {
		outline: 3px solid #f2c94c;
		outline-offset: 2px;
	}
	button:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.round {
		display: grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		padding: 0;
		border-radius: 50%;
		background: #173a2bd9;
	}

	/* --- Panel ------------------------------------------------------------------- */
	.panel {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto auto;
		gap: 8px;
		min-width: 0;
		min-height: 0;
	}
	.tabs {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 6px;
	}
	.tab {
		display: grid;
		justify-items: center;
		align-content: center;
		gap: 2px;
		min-width: 0;
		min-height: 52px;
		padding: 4px 2px;
		border-radius: 16px;
		background: #244c38;
		box-shadow: 0 3px 0 #10271b;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1.1;
	}
	.tab span {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tab[aria-selected='true'] {
		background: #74c69d;
		border-color: #b6e6c9;
		color: #173a2b;
		box-shadow: 0 3px 0 #2d6a4f;
	}
	.content {
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		touch-action: pan-y;
		border: 1px solid #ffffff26;
		border-radius: 18px;
		/* Scroll shadows: a dark edge appears only where there is more to scroll to. */
		background:
			linear-gradient(#173a2b 40%, #173a2b00) top / 100% 28px no-repeat local,
			linear-gradient(#173a2b00, #173a2b 60%) bottom / 100% 28px no-repeat local,
			radial-gradient(farthest-side at 50% 0, #0009, #0000) top / 100% 12px no-repeat scroll,
			radial-gradient(farthest-side at 50% 100%, #0009, #0000) bottom / 100% 12px no-repeat scroll,
			#173a2b;
	}
	fieldset {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 10px;
		min-width: 0;
		margin: 0;
		padding: 10px;
		border: 0;
	}
	h3 {
		margin: 0 0 6px;
		font-size: 0.8rem;
		font-weight: 700;
		color: #d4e8d6;
	}
	.pieces {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
	}
	.piece {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		padding: 6px 8px;
		border-radius: 999px;
		font-weight: 700;
		font-size: 0.8rem;
	}
	.piece[aria-selected='true'] {
		background: #f1f6ed;
		border-color: #f1f6ed;
		color: #173a2b;
	}
	.piece-dot {
		flex: none;
		width: 16px;
		height: 16px;
		border: 2px solid #ffffff99;
		border-radius: 50%;
		background: var(--swatch);
	}
	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: #d4e8d6;
	}
	.message {
		margin: 0;
		color: #f2c94c;
		font-weight: 700;
	}
	.message:empty {
		display: none;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	footer button {
		min-height: 46px;
	}
	.apply {
		flex: 0 1 auto;
		background: #74c69d;
		border-color: #b6e6c9;
		color: #173a2b;
		font-weight: 800;
		box-shadow: 0 3px 0 #2d6a4f;
	}

	/* --- Thumbnail grids ----------------------------------------------------------- */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
		gap: 8px;
	}
	.grid.skins {
		grid-template-columns: repeat(auto-fill, minmax(66px, 1fr));
	}
	.grid.big {
		grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
		max-width: min(100%, 26rem);
	}
	.tile {
		position: relative;
		display: block;
		aspect-ratio: 1;
		min-width: 0;
		padding: 0;
		overflow: hidden;
		border: 2px solid #ffffff26;
		border-radius: 16px;
		background: radial-gradient(circle at 50% 38%, #4f9a6e 0%, #2d6a4f 55%, #1e4d36 100%);
	}
	.tile:not(.ready)::before {
		content: '';
		position: absolute;
		inset: 28% 32%;
		border-radius: 40% 40% 20% 20%;
		background: #ffffff1c;
		animation: pulse 1.2s ease-in-out infinite alternate;
	}
	@keyframes pulse {
		to {
			opacity: 0.35;
		}
	}
	.thumb {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.caption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 10px 4px 3px;
		background: linear-gradient(transparent, #10271bd0);
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1.1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tile[aria-checked='true'] {
		border-color: #f1f6ed;
		box-shadow:
			0 0 0 3px #74c69d,
			0 6px 14px #0006;
	}
	.check {
		position: absolute;
		top: 4px;
		right: 4px;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #74c69d;
		color: #173a2b;
		box-shadow: 0 1px 3px #0007;
	}

	/* --- Swatches --------------------------------------------------------------------- */
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.swatch-group {
		display: contents;
	}
	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		min-width: 44px;
		padding: 0;
		border: 2px solid #ffffff55;
		border-radius: 50%;
		background: var(--swatch);
		color: #fff;
		filter: drop-shadow(0 2px 0 #10271b);
	}
	.swatch :global(svg) {
		filter: drop-shadow(0 0 2px #000c);
	}
	.swatch[aria-checked='true'],
	.custom.checked {
		border-color: #f1f6ed;
		box-shadow: 0 0 0 3px #74c69d;
	}
	.custom {
		box-sizing: border-box;
		overflow: hidden;
		cursor: pointer;
		background:
			linear-gradient(var(--swatch), var(--swatch)) center / 46% 46% no-repeat,
			conic-gradient(#ff9fb7, #f2c94c, #74c69d, #3e9ccf, #a8805c, #ff9fb7);
	}
	.custom input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		padding: 0;
		border: 0;
		opacity: 0;
		cursor: pointer;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}

	/* --- Short landscape phones (the main case, ~800 × 360) -------------------------- */
	@media (orientation: landscape) and (max-height: 430px) {
		.tab {
			min-height: 48px;
			font-size: 0.65rem;
		}
		h2 {
			font-size: 1rem;
		}
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		}
	}
	@media (orientation: portrait) and (max-width: 400px) {
		.tab {
			font-size: 0.62rem;
			padding: 4px 0;
		}
	}

	.reduced .spinner,
	.reduced .tile:not(.ready)::before {
		animation: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner,
		.tile:not(.ready)::before {
			animation: none;
		}
	}
</style>
