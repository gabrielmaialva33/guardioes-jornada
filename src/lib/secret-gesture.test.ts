import { describe, expect, it } from 'vitest';
import { isKonami, KONAMI, pushKey, registerTap, TAP_COUNT, TAP_WINDOW_MS } from './secret-gesture.ts';

describe('secret gesture', () => {
	it('opens after five taps inside the window, not when they are spread out', () => {
		let taps: number[] = [];
		for (let i = 0; i < TAP_COUNT; i++) taps = registerTap(taps, i * 300);
		expect(taps).toHaveLength(TAP_COUNT);

		let slow: number[] = [];
		for (let i = 0; i < TAP_COUNT; i++) slow = registerTap(slow, i * (TAP_WINDOW_MS / 2 + 1));
		expect(slow.length).toBeLessThan(TAP_COUNT);
	});

	it('recognises the Konami code after extra presses, and only in order', () => {
		let keys: string[] = [];
		for (const code of ['ArrowUp', 'KeyX', 'ArrowUp', ...KONAMI]) keys = pushKey(keys, code);
		expect(isKonami(keys)).toBe(true);

		let wrong: string[] = [];
		for (const code of [...KONAMI].reverse()) wrong = pushKey(wrong, code);
		expect(isKonami(wrong)).toBe(false);
	});
});
