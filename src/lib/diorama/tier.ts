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
	const nav = navigator as Navigator & {
		deviceMemory?: number;
		connection?: { saveData?: boolean; effectiveType?: string };
	};
	if (
		nav.onLine === false ||
		nav.connection?.saveData ||
		/^(slow-2g|2g|3g)$/.test(nav.connection?.effectiveType ?? '')
	)
		return 'svg';
	if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return 'svg';
	if (nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) return 'svg';
	const saved = savedTier();
	if (saved) return saved;
	if (nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 4) return 'lite';
	return 'full';
}

export function softwareGpu(renderer: string): boolean {
	return /SwiftShader|llvmpipe|softpipe|Software/i.test(renderer);
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
