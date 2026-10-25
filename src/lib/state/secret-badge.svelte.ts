/**
 * The Secret Trail badge, earned by finishing the hidden game on this phone.
 * It lives apart from journeys on purpose: it never changes scores, the oath
 * or certificates, and it is not synced.
 */
const KEY = 'guardioes-secret-badge';

function read(): number | null {
	try {
		const value = Number(localStorage.getItem(KEY));
		return Number.isFinite(value) && value > 0 ? value : null;
	} catch {
		// Storage blocked (private mode, prerender): the badge starts unearned.
		return null;
	}
}

class SecretBadge {
	/** When the badge was earned on this phone, or null. */
	earnedAt = $state<number | null>(typeof localStorage === 'undefined' ? null : read());

	get earned() {
		return this.earnedAt !== null;
	}

	/** Idempotent: earning it again keeps the first date. */
	earn() {
		if (this.earnedAt !== null) return;
		this.earnedAt = Date.now();
		try {
			localStorage.setItem(KEY, String(this.earnedAt));
		} catch {
			// Kept for this visit only.
		}
	}
}

export const secretBadge = new SecretBadge();
