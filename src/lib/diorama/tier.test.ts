import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pickTier, softwareGpu } from './tier.ts';

beforeEach(() => {
	vi.stubGlobal('window', {});
	vi.stubGlobal('WebGL2RenderingContext', class {});
	vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
	vi.stubGlobal('navigator', { onLine: true, deviceMemory: 8, hardwareConcurrency: 8, connection: { effectiveType: '4g', saveData: false } });
});
afterEach(() => vi.unstubAllGlobals());
it.each(['slow-2g', '2g', '3g'])('avoids downloading 3D on %s even with a saved full tier', (effectiveType) => {
	vi.stubGlobal('navigator', { ...navigator, connection: { effectiveType, saveData: false } });
	vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ tier: 'full', at: Date.now() }) });
	expect(pickTier()).toBe('svg');
});
it.each([{ deviceMemory: 2 }, { hardwareConcurrency: 2 }, { onLine: false }, { connection: { effectiveType: '4g', saveData: true } }])('uses SVG under resource constraint %j', (constraint) => {
	vi.stubGlobal('navigator', { ...navigator, ...constraint }); expect(pickTier()).toBe('svg');
});
it('keeps 3D available on a capable connected phone and uses lite for four cores', () => {
	expect(pickTier()).toBe('full'); vi.stubGlobal('navigator', { ...navigator, hardwareConcurrency: 4 }); expect(pickTier()).toBe('lite');
});
it('distinguishes software rendering from weak mobile GPUs', () => {
	expect(softwareGpu('ANGLE (SwiftShader Device)')).toBe(true); expect(softwareGpu('llvmpipe')).toBe(true); expect(softwareGpu('Adreno (TM) 510')).toBe(false);
});
