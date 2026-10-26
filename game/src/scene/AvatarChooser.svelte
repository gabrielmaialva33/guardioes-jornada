<script lang="ts">
	import { type Snippet, untrack } from 'svelte';
	import { AVATAR_ATLAS } from '../avatar/catalog.ts';
	import {
		AVATAR_PARTS,
		type AvatarColors,
		type AvatarPart,
		type AvatarProfile
	} from '../data/local-save.ts';
	import { ACCENT } from '../style/palette.ts';
	import HudIcon from './HudIcon.svelte';
	import type { AvatarPreset } from '../avatar/atlas.ts';

	let {
		profile,
		presets,
		kenneyUrls,
		onapply,
		onclose,
		sound
	}: {
		profile: AvatarProfile;
		presets: readonly AvatarPreset[];
		kenneyUrls: Readonly<Record<string, string>>;
		onapply: (value: AvatarProfile) => Promise<void>;
		onclose: () => void;
		/** Sound controls, applied at once (outside the avatar draft). */
		sound?: Snippet;
	} = $props();
	let draft = $state.raw<AvatarProfile>(untrack(() => ({ ...profile, colors: { ...profile.colors } })));
	let message = $state('');
	let busy = $state(false);
	async function apply() {
		busy = true;
		message = '';
		try {
			await onapply({ ...draft, colors: { ...draft.colors } });
		} catch {
			message = 'Não foi possível trocar o personagem. Tente novamente.';
		} finally {
			busy = false;
		}
	}
	const labels: Record<AvatarPart, string> = {
		skin: 'Pele',
		hair: 'Cabelo',
		shirt: 'Camiseta',
		pants: 'Calça',
		shoes: 'Sapatos'
	};
	function changeColor(part: AvatarPart, value: string) {
		if ((part === 'shirt' || part === 'pants' || part === 'shoes') && value.toLowerCase() === ACCENT.gold) {
			message = 'O dourado fica reservado aos objetivos da trilha.';
			return;
		}
		message = '';
		draft = { ...draft, style: 'classic', colors: { ...draft.colors, [part]: value } };
	}
	function selectPreset(preset: AvatarPreset) {
		message = '';
		draft = {
			...draft,
			style: 'classic',
			colors: { ...preset.colors },
			face: preset.face,
			hairStyle: preset.hairStyle
		};
	}
	function tabKey(event: KeyboardEvent) {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		draft = { ...draft, style: draft.style === 'classic' ? 'kenney' : 'classic' };
		if (event.currentTarget instanceof HTMLElement)
			event.currentTarget
				.querySelector<HTMLElement>(draft.style === 'classic' ? '#classic-tab' : '#kenney-tab')
				?.focus();
	}
	function keydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		}
		if (event.key === 'Tab') {
			const root = event.currentTarget;
			if (!(root instanceof HTMLElement)) return;
			const nodes = root.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]');
			const first = nodes[0],
				last = nodes[nodes.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		}
	}
</script>

{#snippet mannequin(
	colors: AvatarColors,
	face: AvatarProfile['face'],
	hairStyle: AvatarProfile['hairStyle'] = 'curto'
)}
	<svg class="mannequin" viewBox="0 0 64 80" aria-hidden="true">
		{#if hairStyle === 'longo'}<path
				d="M20 8q12-12 24 0v27H19z"
				fill={colors.hair}
			/>{:else if hairStyle === 'black-power'}<path
				d="M17 14C9-2 51-11 48 14l-5 8H21z"
				fill={colors.hair}
			/>{:else if hairStyle === 'rabo'}<path
				d="M39 7q18-4 11 27l-7-4z"
				fill={colors.hair}
			/>{:else if hairStyle === 'trancas'}<path
				d="M19 8h6v31h-6zm20 0h6v31h-6z"
				fill={colors.hair}
			/>{:else if hairStyle === 'coque'}<circle cx="32" cy="3" r="7" fill={colors.hair} />{/if}
		<rect x="22" y="4" width="20" height="21" rx="1" fill={colors.skin} /><path
			d="M22 4h20v7H22zM22 11h3v4h-3z"
			fill={colors.hair}
		/>
		<path d="M27 15h2v2h-2zm10 0h-2v2h2z" fill="#24382c" stroke="#24382c" stroke-width="1" />
		<path d="M16 28h32v24H16z" fill={colors.shirt} /><path
			d="M7 28h8v25H7zm42 0h8v25h-8z"
			fill={colors.skin}
		/>
		<path d="M17 53h14v24H17zm16 0h14v24H33z" fill={colors.pants} />
		<path d={face === 'smile' ? 'M28 20q4 4 8 0' : 'M28 21h8'} fill="none" stroke="#24382c" /><path
			d="M17 73h14v4H17zm16 0h14v4H33z"
			fill={colors.shoes}
		/></svg
	>
	{#if hairStyle === 'bone'}<path d="M21 10V4q12-9 23 0v6h5v4H20z" fill={colors.shirt} />{/if}
{/snippet}

<div
	class="chooser"
	role="dialog"
	tabindex="-1"
	aria-modal="true"
	aria-labelledby="avatar-title"
	onpointerdown={(event) => event.stopPropagation()}
	onkeydown={keydown}
	onkeyup={(event) => event.stopPropagation()}
>
	<div class="panel">
		<header>
			<h2 id="avatar-title">Seu personagem</h2>
			<button
				class="icon"
				type="button"
				aria-label="Fechar personalização"
				title="Fechar personalização"
				{@attach (node) => {
					node.focus({ preventScroll: true });
				}}
				onclick={onclose}><HudIcon name="back" /></button
			>
		</header>
		<fieldset class="choices" disabled={busy}>
			<div class="tabs" tabindex="-1" role="tablist" aria-label="Estilos do personagem" onkeydown={tabKey}>
				<button
					type="button"
					role="tab"
					id="classic-tab"
					tabindex={draft.style === 'classic' ? 0 : -1}
					aria-selected={draft.style === 'classic'}
					aria-controls="classic-panel"
					onclick={() => (draft = { ...draft, style: 'classic' })}>Cores clássicas</button
				>
				<button
					type="button"
					role="tab"
					id="kenney-tab"
					tabindex={draft.style === 'kenney' ? 0 : -1}
					aria-selected={draft.style === 'kenney'}
					aria-controls="kenney-panel"
					onclick={() => (draft = { ...draft, style: 'kenney' })}>Skins da Kenney</button
				>
			</div>
			{#if draft.style === 'classic'}
				<div id="classic-panel" role="tabpanel" aria-labelledby="classic-tab" class="classic">
					<div class="presets" aria-label="Combinações de cores">
						{#each presets as preset (preset.id)}<button
								class="preset"
								type="button"
								aria-label={preset.name}
								title={preset.name}
								aria-pressed={draft.face === preset.face &&
									(draft.hairStyle ?? 'curto') === preset.hairStyle &&
									AVATAR_PARTS.every((part) => draft.colors[part] === preset.colors[part])}
								onclick={() => selectPreset(preset)}
								>{@render mannequin(preset.colors, preset.face, preset.hairStyle)}</button
							>{/each}
					</div>
					<div class="custom">
						<div class="preview">{@render mannequin(draft.colors, draft.face, draft.hairStyle)}</div>
						{#each AVATAR_PARTS as part}<label
								>{labels[part]}<input
									type="color"
									value={draft.colors[part]}
									oninput={(event) => {
										changeColor(part, event.currentTarget.value);
										event.currentTarget.value = draft.colors[part];
									}}
								/></label
							>{/each}
						<div class="hair-styles" role="group" aria-label="Estilo do cabelo">
							<span>Cabelo</span>{#each AVATAR_ATLAS.hairStyles as style}<button
									type="button"
									aria-label={`Cabelo ${style.name.toLowerCase()}`}
									title={style.name}
									aria-pressed={(draft.hairStyle ?? 'curto') === style.id}
									onclick={() => (draft = { ...draft, hairStyle: style.id })}
									>{@render mannequin(draft.colors, draft.face, style.id)}<span>{style.name}</span></button
								>{/each}
						</div>
						<div class="faces" role="group" aria-label="Expressão do rosto">
							<span>Rosto</span><button
								type="button"
								aria-pressed={draft.face === 'smile'}
								onclick={() => (draft = { ...draft, face: 'smile' })}
								aria-label="Rosto com sorriso"
								title="Sorriso"><HudIcon name="smile" /></button
							><button
								type="button"
								aria-pressed={draft.face === 'neutral'}
								onclick={() => (draft = { ...draft, face: 'neutral' })}
								aria-label="Rosto neutro"
								title="Neutra"><HudIcon name="neutral" /></button
							>
						</div>
					</div>
				</div>
			{:else}
				<div id="kenney-panel" role="tabpanel" aria-labelledby="kenney-tab" class="kenney">
					<p class="hint">Texturas originais da Kenney. A prévia mostra o desenho da skin.</p>
					<div class="skins">
						{#each Object.entries(kenneyUrls) as [id, url]}<button
								class="skin"
								type="button"
								aria-label={`Skin da Kenney ${id}`}
								title={`Skin da Kenney ${id}`}
								aria-pressed={draft.kenneySkin === id}
								onclick={() => (draft = { ...draft, kenneySkin: id })}
								><img src={url} alt="" loading="lazy" decoding="async" width="64" height="64" /></button
							>{/each}
					</div>
				</div>
			{/if}
		</fieldset>
		{@render sound?.()}
		{#if message}<p role="status" class="message">{message}</p>{/if}
		<footer>
			<button type="button" onclick={onclose}>Cancelar</button><button
				class="apply"
				type="button"
				onclick={apply}
				disabled={busy}>{busy ? 'Aplicando…' : 'Usar este personagem'}</button
			>
		</footer>
	</div>
</div>

<style>
	.chooser {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: grid;
		place-items: center;
		padding: 12px;
		background: #10271be8;
		color: #f1f6ed;
		font: 0.875rem var(--font-ui, system-ui);
		box-sizing: border-box;
	}
	.panel {
		touch-action: pan-y;
		overscroll-behavior: contain;
		width: min(100%, 52rem);
		max-height: calc(100dvh - 24px);
		overflow: auto;
		background: #173a2b;
		border: 1px solid #ffffff38;
		border-radius: 20px;
		padding: 16px;
		box-sizing: border-box;
	}
	header,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.hair-styles {
		grid-column: 1/-1;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
	}
	.hair-styles > span {
		width: 100%;
	}
	.hair-styles button {
		display: grid;
		justify-items: center;
		gap: 2px;
		min-width: 64px;
		padding: 4px;
		font-size: 0.65rem;
	}
	.faces button {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		padding: 0;
		display: grid;
		place-items: center;
	}
	.choices {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.faces {
		grid-column: 2;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	h2 {
		margin: 0;
		font: 1.6rem var(--font-story, system-ui);
	}
	button {
		border: 1px solid #ffffff44;
		border-radius: 12px;
		min-width: 44px;
		min-height: 44px;
		padding: 8px 12px;
		font: inherit;
		color: inherit;
		background: #244c38;
		cursor: pointer;
	}
	button:focus-visible,
	input:focus-visible {
		outline: 3px solid #f2c94c;
		outline-offset: 3px;
	}
	.icon {
		border-radius: 50%;
		padding: 0;
		width: 44px;
		height: 44px;
		display: grid;
		place-items: center;
	}
	.tabs {
		display: flex;
		gap: 8px;
		margin: 8px 0;
	}
	[aria-selected='true'],
	[aria-pressed='true'] {
		outline: 2px solid #74c69d;
		outline-offset: 1px;
		background: #315f46;
	}
	.classic {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(12rem, 1fr);
		gap: 16px;
	}
	.presets,
	.skins {
		display: grid;
		grid-template-columns: repeat(6, minmax(44px, 1fr));
		gap: 8px;
		align-content: start;
	}
	.preset {
		display: grid;
		place-items: center;
		padding: 2px;
	}
	.mannequin {
		display: block;
		width: 38px;
		height: 48px;
	}
	.custom {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		align-content: start;
	}
	.preview {
		grid-row: span 2;
		display: grid;
		place-items: center;
	}
	.preview .mannequin {
		width: 72px;
		height: 90px;
	}
	label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	input[type='color'] {
		width: 48px;
		height: 44px;
		padding: 4px;
		border: 1px solid #ffffff44;
		border-radius: 8px;
		background: #244c38;
		cursor: pointer;
	}
	.hint {
		font-size: 0.75rem;
		color: #d4e8d6;
		margin: 8px 0;
		grid-column: 1/-1;
	}
	.kenney .skins {
		grid-template-columns: repeat(9, minmax(44px, 1fr));
	}
	.skin {
		padding: 4px;
		overflow: hidden;
	}
	.skin img {
		width: 100%;
		height: 64px;
		object-fit: contain;
		image-rendering: pixelated;
		display: block;
	}
	.message {
		color: #f2c94c;
	}
	footer {
		position: sticky;
		bottom: -16px;
		background: #173a2b;
		padding: 12px 0;
		margin-top: 16px;
		justify-content: flex-end;
	}
	.apply {
		background: #74c69d;
		color: #173a2b;
		font-weight: 700;
	}
	@media (max-width: 600px) {
		.classic {
			grid-template-columns: 1fr;
		}
		.kenney .skins {
			grid-template-columns: repeat(6, minmax(44px, 1fr));
		}
		.custom {
			grid-template-columns: repeat(2, 1fr);
		}
		.preview {
			grid-row: span 2;
		}
		.presets {
			grid-template-columns: repeat(6, minmax(38px, 1fr));
		}
	}
</style>
