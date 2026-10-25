import type { Attachment } from 'svelte/attachments';

/**
 * The door to the Secret Trail: a long press or five quick taps on the forest,
 * or the Konami code on a keyboard. Scrolling, dragging or a second finger
 * cancel the press, so the forest never opens it by accident.
 */
export const LONG_PRESS_MS = 1500;
export const TAP_COUNT = 5;
export const TAP_WINDOW_MS = 2000;
/** Longest press that still counts as a tap. */
export const TAP_MAX_MS = 300;
/** Finger travel that turns a press into a drag or scroll. */
export const SLOP_PX = 10;

export const KONAMI = [
	'ArrowUp',
	'ArrowUp',
	'ArrowDown',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowLeft',
	'ArrowRight',
	'KeyB',
	'KeyA'
];

/** Tap times still inside the window, plus this one. */
export function registerTap(taps: readonly number[], now: number): number[] {
	return [...taps.filter((t) => now - t <= TAP_WINDOW_MS), now];
}

/** The last keys pressed, as long as the code. */
export function pushKey(keys: readonly string[], code: string): string[] {
	return [...keys, code].slice(-KONAMI.length);
}

export function isKonami(keys: readonly string[]) {
	return keys.length === KONAMI.length && keys.every((code, i) => code === KONAMI[i]);
}

function isTyping(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
	);
}

export function secretGesture(onfound: () => void): Attachment<HTMLElement> {
	return (node) => {
		const controller = new AbortController();
		const { signal } = controller;
		let press: { id: number; x: number; y: number; at: number } | null = null;
		let timer = 0;
		let taps: number[] = [];
		let keys: string[] = [];
		// A tap or press that opens the sheet still ends in a click, which would land
		// on the sheet's backdrop and close it right away: swallow that one click.
		let swallowClick = false;
		let swallowTimer = 0;
		/** Pointer whose long press already opened the sheet and is still down. */
		let held: number | null = null;
		const swallowAfterRelease = () => {
			clearTimeout(swallowTimer);
			swallowTimer = window.setTimeout(() => (swallowClick = false), 500);
		};

		const found = () => {
			taps = [];
			keys = [];
			onfound();
		};
		const cancel = () => {
			clearTimeout(timer);
			press = null;
		};

		node.addEventListener(
			'pointerdown',
			(e) => {
				// A second finger is a pinch, not a press.
				if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return cancel();
				press = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp };
				clearTimeout(timer);
				timer = window.setTimeout(() => {
					if (!press) return;
					held = press.id;
					press = null;
					swallowClick = true;
					found();
				}, LONG_PRESS_MS);
			},
			{ signal }
		);
		node.addEventListener(
			'pointermove',
			(e) => {
				if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP_PX)
					cancel();
			},
			{ signal }
		);
		node.addEventListener(
			'pointerup',
			(e) => {
				if (held === e.pointerId) {
					held = null;
					swallowAfterRelease();
					return;
				}
				if (press?.id !== e.pointerId) return;
				const quick = e.timeStamp - press.at <= TAP_MAX_MS;
				cancel();
				if (!quick) return;
				taps = registerTap(taps, e.timeStamp);
				if (taps.length < TAP_COUNT) return;
				swallowClick = true;
				swallowAfterRelease();
				found();
			},
			{ signal }
		);
		for (const type of ['pointerleave', 'lostpointercapture'] as const) {
			node.addEventListener(type, cancel, { signal });
		}
		node.addEventListener(
			'pointercancel',
			() => {
				cancel();
				// A cancelled pointer never clicks.
				if (held === null) return;
				held = null;
				swallowClick = false;
			},
			{ signal }
		);
		// Android opens the long-press menu before our timer ends.
		node.addEventListener('contextmenu', (e) => (press || held !== null) && e.preventDefault(), { signal });
		window.addEventListener(
			'click',
			(e) => {
				if (!swallowClick) return;
				swallowClick = false;
				e.preventDefault();
				e.stopPropagation();
			},
			{ signal, capture: true }
		);
		window.addEventListener('scroll', cancel, { signal, passive: true });
		window.addEventListener(
			'keydown',
			(e) => {
				if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
				keys = pushKey(keys, e.code);
				if (isKonami(keys)) found();
			},
			{ signal }
		);

		return () => {
			cancel();
			clearTimeout(swallowTimer);
			controller.abort();
		};
	};
}
