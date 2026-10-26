<script lang="ts">
	import type { ControlPreferences } from './controls.ts';
	let {
		settings,
		onchange,
		error = ''
	}: {
		settings: ControlPreferences;
		onchange: (patch: Partial<ControlPreferences>) => void;
		error?: string;
	} = $props();
</script>

<section aria-labelledby="controls-title">
	<h3 id="controls-title">Controles</h3>
	<label
		><input
			type="checkbox"
			checked={settings.leftHanded}
			onchange={(e) => onchange({ leftHanded: e.currentTarget.checked })}
		/><span>Modo canhoto<small>Movimento à direita; pulo e ação à esquerda.</small></span></label
	>
	<label
		><input
			type="checkbox"
			checked={settings.largeButtons}
			onchange={(e) => onchange({ largeButtons: e.currentTarget.checked })}
		/><span>Botões maiores<small>Aumenta o analógico, o pulo e a ação.</small></span></label
	>
	{#if error}<p role="status">{error}</p>{/if}
</section>

<style>
	section {
		display: grid;
		gap: 8px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid #ffffff38;
	}
	h3 {
		font-size: 1rem;
		margin: 0;
	}
	label {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 52px;
		cursor: pointer;
	}
	input {
		width: 24px;
		height: 24px;
		accent-color: #74c69d;
	}
	input:focus-visible {
		outline: 3px solid #74c69d;
		outline-offset: 4px;
	}
	span {
		display: grid;
		gap: 3px;
	}
	small {
		font-size: 0.75rem;
		color: #c9dccf;
	}
	p {
		font-size: 0.8rem;
		color: #f1d8bd;
		margin: 0;
	}
</style>
