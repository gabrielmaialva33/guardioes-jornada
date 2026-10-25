<script lang="ts">
	import Icon from '#lib/components/Icon.svelte';
	import { feedback } from '#lib/feedback.ts';

	interface Props {
		seconds: number;
		label: string;
	}

	let { seconds, label }: Props = $props();
	const uid = $props.id();
	const duration = $derived(Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0);
	let remaining = $state(0);
	let running = $state(false);
	let finished = $state(false);
	let deadline = 0;
	const displaySeconds = $derived(Math.ceil(remaining / 1000));
	const minutes = $derived(String(Math.floor(displaySeconds / 60)).padStart(2, '0'));
	const rest = $derived(String(displaySeconds % 60).padStart(2, '0'));

	$effect(() => {
		void label;
		remaining = duration;
		running = false;
		finished = false;
		deadline = 0;
	});

	function updateRemaining() {
		remaining = Math.max(0, deadline - Date.now());
		if (remaining === 0) {
			running = false;
			if (!finished) {
				finished = true;
				feedback('time-up', 300);
			}
		}
	}

	$effect(() => {
		if (!running) return;
		// Recompute from a deadline: sleeping tabs must not stretch the activity.
		const interval = window.setInterval(updateRemaining, 200);
		const resume = () => {
			if (document.visibilityState === 'visible') updateRemaining();
		};
		document.addEventListener('visibilitychange', resume);
		window.addEventListener('focus', updateRemaining);
		return () => {
			window.clearInterval(interval);
			document.removeEventListener('visibilitychange', resume);
			window.removeEventListener('focus', updateRemaining);
		};
	});

	function start() {
		if (remaining <= 0) return;
		deadline = Date.now() + remaining;
		running = true;
	}

	function pause() {
		updateRemaining();
		running = false;
	}

	function reset() {
		running = false;
		remaining = duration;
		finished = false;
		deadline = 0;
	}
</script>

<section class="timer" aria-labelledby="{uid}-label">
	<h3 id="{uid}-label">{label}</h3>
	<p class="time" role="timer" aria-live="off" aria-label="{minutes} minutos e {rest} segundos">
		{minutes}<span aria-hidden="true">:</span>{rest}
	</p>
	<progress max={duration || 1} value={duration - remaining} aria-label="Tempo decorrido"></progress>
	<div class="controls">
		{#if running}
			<button class="button" type="button" onclick={pause}><Icon name="pause" /> Pausar</button>
		{:else}
			<button class="button" type="button" onclick={start} disabled={remaining <= 0}>
				<Icon name="play" />
				{remaining < duration && remaining > 0 ? 'Retomar' : 'Iniciar'}
			</button>
		{/if}
		<button class="button quiet" type="button" onclick={reset}><Icon name="reset" /> Reiniciar</button>
	</div>
	<p class="status" role="status">
		{finished ? 'Tempo encerrado.' : running ? 'Contando o tempo.' : 'Pronto para continuar.'}
	</p>
</section>

<style>
	.timer {
		display: grid;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		background: var(--surface-solid);
		text-align: center;
	}
	h3 {
		font-size: var(--step-1);
	}
	.time {
		font-family: var(--font-story);
		font-size: clamp(3.5rem, 16vw, 5rem);
		font-weight: 700;
		font-variant-numeric: lining-nums tabular-nums;
		line-height: 1.1;
	}
	progress {
		appearance: none;
		width: 100%;
		height: 0.375rem;
		overflow: hidden;
		border: 0;
		border-radius: var(--radius-s);
		background: var(--border);
		color: var(--accent);
	}
	progress::-webkit-progress-bar {
		background: var(--border);
	}
	progress::-webkit-progress-value {
		background: var(--accent);
	}
	progress::-moz-progress-bar {
		background: var(--accent);
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
	}
	.controls .button {
		flex: 1 1 8rem;
	}
	.status {
		color: var(--text-soft);
		font-size: var(--step--1);
	}
</style>
