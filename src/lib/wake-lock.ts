/**
 * Keeps the phone screen on while a journey is open, so the guide does not
 * have to unlock it before every mission. Returns a release function.
 */
export function keepScreenOn(): () => void {
	let sentinel: WakeLockSentinel | null = null;
	let active = true;

	async function request() {
		if (!active || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
		try {
			sentinel = await navigator.wakeLock.request('screen');
		} catch {
			// Low battery or permission denied: carry on without the lock.
		}
	}

	// The browser drops the lock when the tab is hidden; ask again on return.
	const onVisible = () => void request();
	document.addEventListener('visibilitychange', onVisible);
	void request();

	return () => {
		active = false;
		document.removeEventListener('visibilitychange', onVisible);
		void sentinel?.release();
		sentinel = null;
	};
}
