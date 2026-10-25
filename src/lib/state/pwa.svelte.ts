// Chromium-only event, not in TypeScript's DOM lib yet.
interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * What the guide needs to know before leaving for the trail: is the app
 * stored for offline use, is there a newer version, can it be installed.
 */
class Pwa {
	online = $state(true);
	offlineReady = $state(false);
	updateReady = $state(false);
	canInstall = $state(false);
	#installEvent: BeforeInstallPromptEvent | null = null;
	#registration: ServiceWorkerRegistration | null = null;

	async init() {
		this.online = navigator.onLine;
		addEventListener('online', () => (this.online = true));
		addEventListener('offline', () => (this.online = false));
		addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			this.#installEvent = event as BeforeInstallPromptEvent;
			this.canInstall = true;
		});
		addEventListener('appinstalled', () => (this.canInstall = false));

		if (!('serviceWorker' in navigator)) return;
		// Resolves once a worker is active, i.e. the whole app has been cached.
		const registration = await navigator.serviceWorker.ready;
		this.#registration = registration;
		this.offlineReady = registration.active !== null;

		const hasController = () => navigator.serviceWorker.controller !== null;
		if (registration.waiting && hasController()) this.updateReady = true;
		registration.addEventListener('updatefound', () => {
			const worker = registration.installing;
			worker?.addEventListener('statechange', () => {
				if (worker.state === 'installed' && hasController()) this.updateReady = true;
			});
		});
	}

	/** Switches to the new version. Only offered between journeys, never forced. */
	applyUpdate() {
		const waiting = this.#registration?.waiting;
		if (!waiting) return;
		navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
		waiting.postMessage('skip-waiting');
	}

	async install() {
		const event = this.#installEvent;
		if (!event) return;
		await event.prompt();
		const { outcome } = await event.userChoice;
		if (outcome === 'accepted') this.canInstall = false;
		this.#installEvent = null;
	}
}

export const pwa = new Pwa();
