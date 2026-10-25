/**
 * Quality tiers for the diorama:
 * - svg: no WebGL2, or the 3D scene proved too slow or kept losing its context.
 * - lite: weak or unknown-cheap device: DPR 1, no antialiasing, a thinner forest.
 * - full: everything, DPR up to 2 within a pixel budget.
 *
 * The first guess uses cheap signals (no WebGL context is created here).
 * The engine then reads the GPU name from its own context and can lower
 * full to lite; a slow-frame probe during the first animations demotes one
 * level and remembers it on this device for a month.
 */
export type Tier = 'svg' | 'lite' | 'full';

const KEY = 'guardioes-diorama-tier';
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

/** GPUs that struggle with fill rate, and software renderers. */
const WEAK_GPU =
	/Mali-(4\d\d|T\d+|G(31|51|52|57|68)\b)|PowerVR|\bIMG\b|Adreno \(TM\) ([2-5]\d\d|6[01]\d)\b|GE8\d{3}|SwiftShader|llvmpipe|softpipe|Software/i;

export function pickTier(): Tier {
	if (typeof window === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return 'svg';
	const saved = savedTier();
	if (saved) return saved;

	const nav = navigator as Navigator & { deviceMemory?: number };
	if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return 'lite';
	// Safari reports few cores on every iPhone; Apple GPUs handle this scene fine.
	const apple = /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
	if (!apple && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4) return 'lite';
	return 'full';
}

export function weakGpu(renderer: string): boolean {
	return WEAK_GPU.test(renderer);
}

export function demote(tier: Tier): Tier {
	return tier === 'full' ? 'lite' : 'svg';
}

/** Remembers a demotion on this device. */
export function remember(tier: Tier) {
	try {
		localStorage.setItem(KEY, JSON.stringify({ tier, at: Date.now() }));
	} catch {
		// Private mode or storage full: the probe will simply run again.
	}
}

function savedTier(): Tier | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const { tier, at } = JSON.parse(raw) as { tier?: Tier; at?: number };
		if (!tier || !at || Date.now() - at > REMEMBER_MS) return null;
		return tier === 'svg' || tier === 'lite' || tier === 'full' ? tier : null;
	} catch {
		return null;
	}
}
