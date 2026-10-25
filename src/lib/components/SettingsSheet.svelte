<script lang="ts">
	import { preferences, type Theme } from '#lib/state/preferences.svelte.ts';
	import Sheet from './Sheet.svelte';

	let { open = $bindable() }: { open: boolean } = $props();

	const themes: { value: Theme; label: string; hint: string }[] = [
		{ value: 'mata', label: 'Mata', hint: 'Tons de floresta, para sombra e fim de tarde' },
		{ value: 'sol', label: 'Sol', hint: 'Fundo claro e mais contraste sob sol forte' }
	];

	function save() {
		preferences.save();
	}
</script>

<Sheet bind:open title="Ajustes">
	<fieldset>
		<legend>Tela</legend>
		{#each themes as theme (theme.value)}
			<label class="option">
				<input type="radio" name="theme" value={theme.value} bind:group={preferences.theme} onchange={save} />
				<span>
					<strong>{theme.label}</strong>
					<small>{theme.hint}</small>
				</span>
			</label>
		{/each}
	</fieldset>

	<label class="option">
		<input type="checkbox" bind:checked={preferences.keepScreenOn} onchange={save} />
		<span>
			<strong>Manter a tela acesa</strong>
			<small>Durante a jornada, o celular não apaga sozinho</small>
		</span>
	</label>

	<label class="option">
		<input type="checkbox" bind:checked={preferences.sound} onchange={save} />
		<span>
			<strong>Sons</strong>
			<small>Pontos, missões e fim do cronômetro</small>
		</span>
	</label>
</Sheet>

<style>
	fieldset {
		display: grid;
		gap: 0.25rem;
		margin: 0 0 1rem;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.5rem;
		font-weight: 700;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		min-height: var(--tap);
		padding: 0.25rem 0;
		cursor: pointer;
	}

	.option input {
		width: 1.4rem;
		height: 1.4rem;
		accent-color: var(--accent);
		flex: none;
	}

	.option span {
		display: grid;
	}

	small {
		color: var(--text-soft);
		font-size: var(--step--1);
	}
</style>
