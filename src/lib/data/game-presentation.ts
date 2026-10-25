/** A lease created synchronously inside the entry gesture, before any download or import. */
export interface PresentationEnvironment {
	fullscreenElement(): unknown;
	exitFullscreen?(): Promise<void>;
	orientation?: { lock?(orientation: 'landscape'): Promise<void>; unlock?(): void };
}
export interface GamePresentation {
	ready: Promise<boolean>;
	release(): Promise<void>;
}
export function beginGamePresentation(
	root: { requestFullscreen?(): Promise<void> },
	environment: PresentationEnvironment = {
		fullscreenElement: () => document.fullscreenElement,
		exitFullscreen: () => document.exitFullscreen(),
		orientation: screen.orientation
	}
): GamePresentation {
	const alreadyFullscreen = environment.fullscreenElement() === root;
	let released = false;
	let locked = false;
	let cleanup: Promise<void> | undefined;
	let fullscreen: Promise<void> | undefined;
	try {
		if (!alreadyFullscreen) fullscreen = root.requestFullscreen?.();
	} catch {
		// iOS and embedded browsers can reject synchronously; rotation remains optional.
	}
	const ready = (async () => {
		try {
			await fullscreen;
		} catch {
			/* Standalone may still allow orientation lock. */
		}
		if (released || !environment.orientation?.lock) return false;
		try {
			await environment.orientation.lock('landscape');
			locked = true;
			return true;
		} catch {
			return false;
		}
	})();
	return {
		ready,
		release() {
			released = true;
			if (!cleanup)
				cleanup = (async () => {
					await ready;
					// unlock restores the manifest's default (portrait in the installed PWA), not a new lock.
					if (locked) {
						try {
							environment.orientation?.unlock?.();
						} catch {
							/* Already unlocked. */
						}
					}
					if (!alreadyFullscreen && environment.fullscreenElement() === root) {
						try {
							await environment.exitFullscreen?.();
						} catch {
							/* Already exited. */
						}
					}
				})();
			return cleanup;
		}
	};
}
