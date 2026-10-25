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
	/** iPhone/iPad in the browser: Safari may evict data of sites not added to the home screen. */
	iosNeedsInstall = $state(false);
	persisted = $state<boolean | null>(null);
	#installEvent: BeforeInstallPromptEvent | null = null;
	#registration: ServiceWorkerRegistration | null = null;

	async init() {
		this.online = navigator.onLine;
		const standalone =
			matchMedia('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;
		const ios =
			/iPad|iPhone|iPod/.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
		this.iosNeedsInstall = ios && !standalone;
		// Ask once for durable storage so the browser does not evict journeys under pressure.
		void navigator.storage
			?.persist?.()
			.then((granted) => (this.persisted = granted))
			.catch(() => {});
		addEventListener('online', () => (this.online = true));
		addEventListener('offline', () => (this.online = false));
		addEventListener('beforeinstallprompt', (event) => {
			event.preventDefault();
			this.#installEvent = event as BeforeInstallPromptEvent;
			this.canInstall = true;
		});
		addEventListener('appinstalled', () => (this.canInstall = false));

		if (!('serviceWorker' in navigator)) return;
		// Activation confirms all route shells and their static dependencies are cached.
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
