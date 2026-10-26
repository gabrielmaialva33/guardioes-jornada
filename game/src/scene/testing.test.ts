import { expect, it } from 'vitest';
import { readTesting } from './testing.ts';

it('requires both an explicit e2e URL and a dev/acceptance build', () => {
	expect(readTesting('?e2e', false)).toBe(false);
	expect(readTesting('?debug', true)).toBe(false);
	expect(readTesting('?e2e&debug', true)).toBe(true);
});
