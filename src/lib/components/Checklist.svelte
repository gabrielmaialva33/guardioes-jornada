<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import type { Step } from '#lib/content/types.ts';
	import { feedback } from '#lib/feedback.ts';
	import { deletePhoto, photoKey, readPhoto, savePhoto } from '#lib/photos.ts';
	import { itemFound, type Session } from '#lib/session.ts';
	import { sessions } from '#lib/state/sessions.svelte.ts';

	interface Props {
		session: Session;
		step: Step;
	}

	let { session, step }: Props = $props();
	let selectedId = $state('');
	const group = $derived(session.groups.find((entry) => entry.id === selectedId) ?? session.groups[0]);
	const items = $derived(step.checklist ?? []);
	const count = $derived(
		group ? items.filter((item) => itemFound(session, group.id, step.id, item.id)).length : 0
	);
	let thumbnails = $state<Record<string, string>>({});
	let photoVersion = $state(0);
	let busyKeys = $state<string[]>([]);
	let message = $state('');
	let error = $state('');
	let removeOpen = $state(false);
	let removal = $state<{ session: Session; key: string; label: string } | null>(null);
	let fileInputs: Record<string, HTMLInputElement> = {};

	$effect(() => {
		const selected = group;
		const keys = selected
			? items
					.map((item) => photoKey(session.id, selected.id, item.id))
					.filter((key) => session.photos.includes(key))
			: [];
		// Replacing a photo keeps its storage key, so it needs a fresh object URL.
		void photoVersion;
		let active = true;
		const urls: string[] = [];
		thumbnails = {};
		for (const key of keys) {
			void readPhoto(key)
				.then((blob) => {
					if (!active || !blob) return;
					const url = URL.createObjectURL(blob);
					urls.push(url);
					thumbnails = { ...thumbnails, [key]: url };
				})
				.catch(() => {
					if (active) error = 'Não foi possível abrir uma das fotos deste aparelho.';
				});
		}
		return () => {
			active = false;
			for (const url of urls) URL.revokeObjectURL(url);
		};
	});

	function toggle(itemId: string) {
		if (!group) return;
		const checked = sessions.toggleItem(session, group.id, step.id, itemId);
		feedback(checked ? 'point' : 'unpoint', 15);
	}

	async function capture(event: Event, itemId: string) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !group || !sessions.ready || !sessions.find(session.id)) return;
		if (file.type && !file.type.startsWith('image/')) {
			error = 'Escolha um arquivo de imagem.';
			return;
		}
		// Keep the original targets even if the guide changes groups while saving.
		const target = session;
		const key = photoKey(target.id, group.id, itemId);
		if (busyKeys.includes(key)) return;
		busyKeys = [...busyKeys, key];
		error = '';
		message = '';
		try {
			await savePhoto(key, file);
			const current = sessions.find(target.id);
			if (
				!current ||
				!sessions.ready ||
				!current.groups.some((entry) => key.startsWith(`${current.id}:${entry.id}:`))
			) {
				await deletePhoto(key);
				throw new Error('The photo target is no longer writable.');
			}
			sessions.addPhoto(current, key);
			await sessions.flush();
			photoVersion += 1;
			message = 'Foto salva neste aparelho.';
		} catch {
			error = 'Não foi possível guardar a foto. Verifique o espaço livre e tente de novo.';
		} finally {
			busyKeys = busyKeys.filter((entry) => entry !== key);
		}
	}

	async function removePhoto() {
		const target = removal;
		if (!target || !sessions.ready || !sessions.find(target.session.id) || busyKeys.includes(target.key))
			return;
		busyKeys = [...busyKeys, target.key];
		error = '';
		try {
			await sessions.removePhoto(target.session, target.key);
			photoVersion += 1;
			message = 'Foto removida deste aparelho.';
			removeOpen = false;
			removal = null;
		} catch {
			error = 'Não foi possível remover a foto. Tente de novo.';
		} finally {
			busyKeys = busyKeys.filter((entry) => entry !== target.key);
		}
	}
</script>

<section class="checklist" aria-label="Registros da natureza">
	<div class="groups" role="group" aria-label="Escolher grupo">
		{#each session.groups as entry (entry.id)}
			<button
				type="button"
				class="chip"
				style:--group-color={entry.color}
				aria-pressed={group?.id === entry.id}
				onclick={() => {
					selectedId = entry.id;
					message = '';
					error = '';
				}}
			>
				<span class="dot" aria-hidden="true"></span>{entry.name}
			</button>
		{/each}
	</div>
	{#if group}
		<p class="count" role="status">
			{count} de {items.length} encontrados <span>no grupo {group.name}</span>
		</p>
		<ul>
			{#each items as item (item.id)}
				{@const key = photoKey(session.id, group.id, item.id)}
				{@const checked = itemFound(session, group.id, step.id, item.id)}
				<li>
					<div class="item-actions">
						<button
							class="toggle"
							type="button"
							disabled={!sessions.ready}
							aria-pressed={checked}
							onclick={() => toggle(item.id)}
						>
							<span class="checkbox" class:checked aria-hidden="true"
								>{#if checked}<Icon name="check" size={20} />{/if}</span
							>
							<span>{item.label}</span>
						</button>
						<button
							class="icon-button"
							type="button"
							disabled={!sessions.ready || busyKeys.includes(key)}
							aria-label="{session.photos.includes(key)
								? 'Trocar'
								: 'Adicionar'} foto: {item.label}, grupo {group.name}"
							onclick={() => fileInputs[item.id]?.click()}
						>
							<Icon name="camera" />
						</button>
						<input
							hidden
							bind:this={fileInputs[item.id]}
							type="file"
							accept="image/*"
							capture="environment"
							onchange={(event) => void capture(event, item.id)}
						/>
					</div>
					{#if busyKeys.includes(key)}<p class="photo-status" role="status">Guardando a alteração…</p>{/if}
					{#if session.photos.includes(key)}
						<div class="photo">
							{#if thumbnails[key]}<img
									src={thumbnails[key]}
									alt="Registro de {item.label.toLocaleLowerCase('pt-BR')} pelo grupo {group.name}"
									width="80"
									height="80"
								/>{/if}
							<button
								class="button danger"
								type="button"
								disabled={!sessions.ready || busyKeys.includes(key)}
								aria-label="Remover foto: {item.label}, grupo {group.name}"
								onclick={() => {
									removal = { session, key, label: item.label };
									removeOpen = true;
								}}><Icon name="trash" size={20} /> Remover foto</button
							>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p>Nenhum grupo cadastrado nesta jornada.</p>
	{/if}
	<p class="hint">Fotografe a natureza, não as pessoas.</p>
	{#if message}<p class="hint" role="status">{message}</p>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<Sheet bind:open={removeOpen} title="Remover foto?">
	<p>
		O registro de {removal?.label.toLocaleLowerCase('pt-BR')} será removido deste aparelho. A marcação do item será
		mantida.
	</p>
	{#snippet actions()}
		<button
			class="button danger wide"
			type="button"
			disabled={!sessions.ready || (!!removal && busyKeys.includes(removal.key))}
			onclick={() => void removePhoto()}>Remover foto</button
		>
		<button class="button quiet wide" type="button" onclick={() => (removeOpen = false)}>Manter foto</button>
	{/snippet}
</Sheet>

<style>
	.checklist {
		display: grid;
		gap: 1rem;
	}
	.groups {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		min-height: var(--tap);
		padding: 0.5rem 1rem;
		border: 2px solid var(--border);
		border-radius: var(--radius-m);
		background: transparent;
		color: var(--text);
		font-weight: 700;
		cursor: pointer;
		touch-action: manipulation;
	}
	.chip[aria-pressed='true'] {
		border-color: var(--group-color);
		background: var(--surface-solid);
		box-shadow: inset 0 -3px var(--group-color);
	}
	.dot {
		width: 0.75rem;
		height: 0.75rem;
		flex: none;
		border-radius: 50%;
		background: var(--group-color);
	}
	.count {
		font-weight: 700;
	}
	.count span {
		color: var(--text-soft);
		font-weight: 400;
	}
	ul {
		display: grid;
		gap: 0.625rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		padding: 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		background: var(--surface-solid);
	}
	.item-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex: 1;
		min-width: 0;
		min-height: var(--tap);
		padding: 0.5rem;
		border: 0;
		border-radius: var(--radius-s);
		background: transparent;
		color: var(--text);
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
	}
	.checkbox {
		display: grid;
		place-items: center;
		width: 1.625rem;
		height: 1.625rem;
		flex: none;
		border: 2px solid var(--accent);
		border-radius: 0.3rem;
	}
	.checked {
		background: var(--accent);
		color: var(--on-accent);
	}
	.icon-button {
		flex: none;
		color: var(--accent);
	}
	.icon-button:disabled {
		opacity: 0.45;
		cursor: wait;
	}
	.photo {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		padding: 0.5rem;
	}
	.photo img {
		width: 5rem;
		height: 5rem;
		border-radius: var(--radius-s);
		object-fit: cover;
	}
	.photo-status,
	.hint {
		color: var(--text-soft);
		font-size: var(--step--1);
	}
	.photo-status {
		padding: 0.5rem;
	}
	.error {
		color: var(--danger);
	}
</style>
