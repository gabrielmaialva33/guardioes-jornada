<script lang="ts">
	import type { StoryView } from './view.ts';
	let {
		view,
		onchoice,
		onclose,
		onselect,
		onrestart,
		onexit,
		onmenu
	}: {
		view: StoryView;
		onchoice: (id: string) => void;
		onclose: () => void;
		onselect: (id: number) => void;
		onrestart: () => void;
		onexit: () => void;
		onmenu: (open: boolean) => void;
	} = $props();
	let expanded = $state(false);

	function keys(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Escape' && !view.dialogue?.finished) {
			event.preventDefault();
			onclose();
		}
		if (event.key === 'Tab') {
			const root = event.currentTarget;
			if (!(root instanceof HTMLElement)) return;
			const nodes = root.querySelectorAll<HTMLElement>('button:not([disabled]),[tabindex="0"]');
			const first = nodes[0],
				last = nodes[nodes.length - 1];
			if (
				event.shiftKey &&
				(document.activeElement === first || document.activeElement === root.querySelector('.dialog'))
			) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		}
	}
</script>

<div
	role="group"
	aria-label="Progresso na reserva"
	class="missions"
	inert={!!view.dialogue}
	onpointerdown={(e) => e.stopPropagation()}
>
	<button
		onkeydown={(e) => e.stopPropagation()}
		onkeyup={(e) => e.stopPropagation()}
		type="button"
		aria-expanded={expanded}
		aria-controls="mission-list"
		onclick={() => {
			expanded = !expanded;
			onmenu(expanded);
		}}>Missões · {view.missions.filter((m) => m.completed).length} de 6</button
	>
	{#if expanded}<ol id="mission-list" aria-label="Missões da reserva">
			{#each view.missions as m (m.id)}<li>
					<button
						onkeydown={(e) => e.stopPropagation()}
						onkeyup={(e) => e.stopPropagation()}
						type="button"
						disabled={!m.available || m.completed}
						aria-pressed={view.selected === m.id}
						onclick={() => {
							onselect(m.id);
							expanded = false;
							onmenu(false);
						}}
						><span>{m.name}</span><small
							>{m.completed
								? 'Concluída'
								: m.available
									? `${m.progress} de ${m.count}`
									: 'Conclua as missões anteriores'}</small
						></button
					>
				</li>{/each}
		</ol>{/if}
	<p class="inventory">
		Sementes {view.seeds} · Mudas {view.seedlings}<br />Resíduos {view.trash}/10 · Folhas {view.leaves}/7
	</p>
</div>
{#if view.saveError || view.readOnlySave}<p class="save-warning" role="status">
		{view.readOnlySave
			? 'Este celular tem um save de uma versão mais recente. Esta partida não vai substituí-lo.'
			: 'Não foi possível guardar o progresso neste celular. A partida continua aberta.'}
	</p>{/if}
{#if view.notice}{#key view.revision}<output class="toast" aria-live="polite" data-mission-notice
			>{view.notice}</output
		>{/key}{/if}
{#if view.dialogue}{#key view.dialogue.id}
		<div
			class="scrim"
			onpointerdown={(e) => e.stopPropagation()}
			onkeydown={keys}
			onkeyup={(e) => e.stopPropagation()}
			role="presentation"
		>
			<div
				class="dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby="dialog-title"
				tabindex="-1"
				{@attach (node) => {
					node.focus({ preventScroll: true });
				}}
			>
				<p class="speaker">{view.dialogue.speaker}</p>
				<h2 id="dialog-title">
					{view.dialogue.finished
						? 'Parabéns! Você protegeu a Trilha Secreta!'
						: view.dialogue.id === 'logger'
							? 'Observar com segurança'
							: view.dialogue.speaker === 'Iara'
								? 'Uma missão pela mata'
								: 'Cuidar da reserva'}
				</h2>
				{#each view.dialogue.finished ? view.dialogue.lines.slice(1) : view.dialogue.lines as line}<p>
						{line}
					</p>{/each}
				<div class="answers">
					{#if view.dialogue.finished}<button class="primary" type="button" onclick={onexit}
							>Voltar para a jornada</button
						><button type="button" onclick={onrestart}>Jogar de novo</button><button
							type="button"
							onclick={onclose}>Continuar explorando</button
						>{:else}{#each view.dialogue.choices ?? [] as choice}<button
								type="button"
								onclick={() => onchoice(choice.id)}>{choice.label}</button
							>{/each}<button type="button" onclick={onclose}
							>{view.dialogue.choices?.length ? 'Agora não' : 'Continuar'}</button
						>{/if}
				</div>
			</div>
		</div>
	{/key}{/if}

<style>
	.missions {
		position: absolute;
		left: max(12px, env(safe-area-inset-left));
		top: max(72px, calc(env(safe-area-inset-top) + 72px));
		width: min(30vw, 19rem);
		pointer-events: auto;
		color: #f1f6ed;
		font: 0.75rem var(--font-ui, system-ui);
	}
	button {
		min-height: 44px;
		border: 1px solid #ffffff55;
		border-radius: 12px;
		padding: 8px 12px;
		background: #173a2bef;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
	}
	button:focus-visible,
	.dialog:focus-visible {
		outline: 3px solid #ffd166;
		outline-offset: 3px;
	}
	button:disabled {
		opacity: 0.65;
		cursor: default;
	}
	button[aria-pressed='true'] {
		border-color: #ffd166;
	}
	.missions > button {
		width: 100%;
	}
	ol {
		margin: 4px 0;
		padding: 0;
		list-style: none;
		max-height: 45dvh;
		overflow: auto;
		overscroll-behavior: contain;
	}
	li button {
		display: grid;
		width: 100%;
		gap: 2px;
	}
	small {
		font-size: 0.65rem;
	}
	.inventory {
		margin: 4px 0;
		padding: 6px;
		background: #173a2be8;
		border-radius: 8px;
		font-size: 0.65rem;
	}
	.toast {
		animation: toast-dismiss 180ms ease 5s forwards;
		position: absolute;
		left: 50%;
		bottom: max(14px, env(safe-area-inset-bottom));
		transform: translateX(-50%);
		max-width: 38vw;
		padding: 8px 12px;
		border-radius: 12px;
		background: #173a2be8;
		color: #f1f6ed;
		font: 0.7rem var(--font-ui, system-ui);
		pointer-events: none;
	}
	@keyframes toast-dismiss {
		to {
			opacity: 0;
			visibility: hidden;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.toast {
			animation-duration: 1ms;
		}
	}
	.save-warning {
		position: absolute;
		left: 50%;
		top: 12px;
		transform: translateX(-50%);
		max-width: 40vw;
		background: #573d24;
		color: #fff2d0;
		padding: 8px;
		font: 0.7rem var(--font-ui, system-ui);
	}
	.scrim {
		position: absolute;
		inset: 0;
		z-index: 8;
		display: grid;
		place-items: center;
		padding: 16px;
		background: #10271bcc;
		color: #f1f6ed;
		pointer-events: auto;
	}
	.dialog {
		max-height: calc(100dvh - 32px);
		overflow: auto;
		overscroll-behavior: contain;
		box-sizing: border-box;
		max-width: 38rem;
		width: 100%;
		border-radius: 20px;
		padding: 20px;
		background: #173a2b;
		font: 0.9rem/1.5 var(--font-ui, system-ui);
		touch-action: pan-y;
	}
	.speaker {
		margin: 0 0 4px;
		color: #ffd166;
		font-size: 0.8rem;
	}
	h2 {
		margin: 0;
		font: 1.8rem var(--font-story, system-ui);
	}
	p {
		margin: 10px 0;
	}
	.answers {
		display: grid;
		gap: 8px;
		margin-top: 16px;
	}
	.answers .primary {
		background: #ffd166;
		color: #173a2b;
		font-weight: 700;
	}
</style>
