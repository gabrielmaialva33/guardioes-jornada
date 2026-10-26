<script lang="ts">
	import type { ButtonRole, InputModel } from '../engine/input.ts';
	import type { StoryAction } from '../missions/story.ts';
	import { actionControl, touchHaptic, type ControlPreferences } from './controls.ts';
	import HudIcon from './HudIcon.svelte';
	let {
		input,
		action,
		preferences,
		moved,
		ready
	}: {
		input: InputModel;
		action: StoryAction | null | undefined;
		preferences: ControlPreferences;
		moved: boolean;
		ready: boolean;
	} = $props();
	const control = $derived(actionControl(action));
	let base: HTMLDivElement,
		knob: HTMLDivElement,
		ghost: HTMLDivElement,
		hint: HTMLDivElement,
		jump: HTMLButtonElement;
	let actionButton: HTMLButtonElement | undefined = $state();
	function keys(e: KeyboardEvent) {
		if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation();
	}
	function activate(e: MouseEvent, role: ButtonRole) {
		if (e.detail === 0) input.tapButton(role);
	}
	function down(e: PointerEvent) {
		if (e.pointerType === 'touch' || e.pointerType === 'pen') touchHaptic();
	}
	export function draw() {
		if (!jump) return;
		const layout = input.layout,
			stick = input.stick;
		const place = (node: HTMLElement, x: number, y: number, size: number) => {
			node.style.left = `${x}px`;
			node.style.top = `${y}px`;
			node.style.width = node.style.height = `${size}px`;
		};
		place(
			base,
			stick.originX - layout.outerRingSize / 2,
			stick.originY - layout.outerRingSize / 2,
			layout.outerRingSize
		);
		base.style.setProperty('--ring', `${layout.ringSize}px`);
		base.style.opacity = stick.active ? '1' : '0';
		place(
			knob,
			stick.x - layout.thumbstickSize / 2,
			stick.y - layout.thumbstickSize / 2,
			layout.thumbstickSize
		);
		knob.style.opacity = stick.active ? '1' : '0';
		place(
			ghost,
			layout.ghostX - layout.outerRingSize / 2,
			layout.ghostY - layout.outerRingSize / 2,
			layout.outerRingSize
		);
		ghost.style.opacity = !moved && !stick.active ? '1' : '0';
		hint.style.left = `${Math.max(84, Math.min(layout.ghostX, innerWidth - 84))}px`;
		hint.style.top = `${layout.ghostY - layout.outerRingSize / 2 - 36}px`;
		hint.style.opacity = !moved && !stick.active ? '1' : '0';
		const j = layout.jumpButton;
		place(jump, j.x, j.y, j.width);
		jump.classList.toggle('pressed', input.frame.jumpHeld);
		if (actionButton) {
			const size = layout.bigScreen ? 88 : 76;
			place(
				actionButton,
				preferences.leftHanded ? j.x + j.width + 12 : j.x - size - 12,
				j.y + (j.height - size) / 2,
				size
			);
			actionButton.classList.toggle('pressed', input.frame.actionHeld);
		}
	}
</script>

<div class="ghost" bind:this={ghost} aria-hidden="true"><span></span></div>
<div class="stick-base" bind:this={base} aria-hidden="true"><span></span></div>
<div class="stick-knob" bind:this={knob} aria-hidden="true"></div>
<div class="stick-hint" bind:this={hint} aria-hidden="true">Arraste para andar</div>
{#if control}<button
		bind:this={actionButton}
		class="context-action"
		type="button"
		data-game-button="action"
		aria-label={control.accessibleName}
		title={control.accessibleName}
		disabled={!ready}
		onkeydown={keys}
		onkeyup={keys}
		onpointerdown={down}
		onclick={(e) => activate(e, 'action')}><HudIcon name={control.icon} /><span>{control.label}</span></button
	>{/if}
<button
	bind:this={jump}
	class="jump"
	type="button"
	data-game-button="jump"
	aria-label="Pular"
	title="Pular"
	disabled={!ready}
	onkeydown={keys}
	onkeyup={keys}
	onpointerdown={down}
	onclick={(e) => activate(e, 'jump')}><HudIcon name="jump" /></button
>

<style>
	button {
		position: absolute;
		display: grid;
		place-items: center;
		box-sizing: border-box;
		border: 2px solid #ffffffa0;
		border-radius: 50%;
		padding: 7px;
		color: #fff;
		background: #14271ca6;
		font: inherit;
		cursor: pointer;
		touch-action: none;
		pointer-events: auto;
		transition:
			transform 120ms ease,
			background 120ms ease;
	}
	button:focus-visible {
		outline: 3px solid #74c69d;
		outline-offset: 4px;
	}
	button:disabled {
		opacity: 0.5;
	}
	.jump {
		width: 70px;
		height: 70px;
		right: 25px;
		bottom: 20px;
		box-shadow:
			inset 0 0 0 2px #10271b88,
			0 2px 6px #10271b40;
	}
	.jump :global(svg) {
		width: 55%;
		height: 55%;
		filter: drop-shadow(0 1px 1px #10271ba0);
	}
	button:global(.pressed),
	button:active {
		transform: scale(0.92);
		background: #617a70cc;
	}
	.context-action {
		width: 76px;
		height: 76px;
		right: 107px;
		bottom: 17px;
		gap: 0;
		border-color: #c4f4dc;
		color: #10271b;
		background: #74c69de6;
		animation: pulse 2s ease-in-out infinite;
	}
	.context-action span {
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
	}
	.context-action:global(.pressed) {
		background: #b7e8cf;
	}
	@keyframes pulse {
		50% {
			box-shadow: 0 0 0 5px #74c69d30;
		}
	}
	.ghost,
	.stick-base,
	.stick-knob {
		position: absolute;
		box-sizing: border-box;
		pointer-events: none;
		opacity: 0;
		transition: opacity 150ms ease;
		border-radius: 50%;
	}
	.ghost {
		border: 2px solid #ffffff66;
		background: #ffffff10;
		box-shadow: 0 0 0 1px #10271b88;
	}
	.ghost span {
		position: absolute;
		inset: 35%;
		border: 1px solid #fff8;
		border-radius: 50%;
		background: #fff3;
	}
	.stick-base {
		border: 2px solid #ffffffbb;
		background: #ffffff20;
		box-shadow: 0 0 0 2px #10271b80;
	}
	.stick-base span {
		position: absolute;
		left: 50%;
		top: 50%;
		width: var(--ring);
		height: var(--ring);
		transform: translate(-50%, -50%);
		border: 1px solid #ffffffaa;
		background: #ffffff40;
		border-radius: 50%;
	}
	.stick-knob {
		border: 2px solid #f2fff5e0;
		background: #ffffff80;
		box-shadow:
			0 0 0 2px #10271bb0,
			0 2px 4px #10271b60;
	}
	.stick-hint {
		position: absolute;
		pointer-events: none;
		transform: translateX(-50%);
		padding: 5px 9px;
		border-radius: 999px;
		background: #10271bda;
		color: #fff;
		font-size: 0.7rem;
		white-space: nowrap;
		opacity: 0;
		transition: opacity 150ms ease;
	}
	@media (prefers-reduced-motion: reduce) {
		button,
		.ghost,
		.stick-base,
		.stick-knob,
		.stick-hint {
			transition: none;
		}
		.context-action {
			animation: none;
		}
	}
</style>
