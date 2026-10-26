<script lang="ts">
	import type { Bus } from './bank.ts';
	import type { AudioSettings } from './engine.ts';

	let {
		settings,
		onvolume,
		onmute
	}: {
		settings: AudioSettings;
		onvolume: (bus: Bus, volume: number) => void;
		onmute: (muted: boolean) => void;
	} = $props();
	// Natureza is the ambience bus, which carries the animals too.
	const SLIDERS: { bus: Bus; label: string }[] = [
		{ bus: 'master', label: 'Volume geral' },
		{ bus: 'music', label: 'Música' },
		{ bus: 'ambience', label: 'Natureza' },
		{ bus: 'sfx', label: 'Efeitos' }
	];
	const percent = (value: number) => Math.round(value * 100);
</script>

<section class="sound" aria-labelledby="sound-title">
	<h3 id="sound-title">Som</h3>
	<p class="hint">Muda na hora. Cancelar vale só para o personagem.</p>
	<button
		type="button"
		class="toggle"
		aria-pressed={!settings.muted.master}
		onclick={() => onmute(!settings.muted.master)}
		>{settings.muted.master ? 'Som desligado' : 'Som ligado'}</button
	>
	{#each SLIDERS as slider (slider.bus)}<label
			><span>{slider.label}</span><input
				type="range"
				min="0"
				max="100"
				step="5"
				value={percent(settings.volume[slider.bus])}
				disabled={settings.muted.master}
				aria-valuetext={`${percent(settings.volume[slider.bus])}%`}
				oninput={(event) => onvolume(slider.bus, Number(event.currentTarget.value) / 100)}
			/><output>{percent(settings.volume[slider.bus])}%</output></label
		>{/each}
</section>

<style>
	.sound {
		display: grid;
		gap: 6px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid #ffffff38;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: #c9dccf;
	}
	.toggle {
		justify-self: start;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid #ffffff66;
		border-radius: 999px;
		background: #10271b;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.toggle[aria-pressed='true'] {
		background: #f1d364;
		color: #173a2b;
		font-weight: 700;
	}
	label {
		display: grid;
		grid-template-columns: 7.5rem 1fr 3rem;
		align-items: center;
		gap: 8px;
		min-height: 44px;
	}
	input {
		width: 100%;
		min-height: 44px;
		margin: 0;
		accent-color: #f1d364;
		cursor: pointer;
	}
	input:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	output {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.toggle:focus-visible,
	input:focus-visible {
		outline: 3px solid #f6d968;
		outline-offset: 3px;
	}
</style>
