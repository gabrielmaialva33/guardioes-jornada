/** Mata: the dark forest look (default). Sol: high contrast for strong sunlight. */
export type Theme = 'mata' | 'sol';

interface Values {
	theme: Theme;
	sound: boolean;
	keepScreenOn: boolean;
}

const KEY = 'guardioes-preferences';
const DEFAULTS: Values = { theme: 'mata', sound: true, keepScreenOn: true };

function read(): Values {
	try {
		const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
		if (saved.theme !== 'sol') saved.theme = 'mata';
		return saved;
	} catch {
		return { ...DEFAULTS };
	}
}

/** Per-device settings. Small and synchronous, so they live in localStorage. */
class Preferences {
	theme = $state<Theme>(DEFAULTS.theme);
	sound = $state(DEFAULTS.sound);
	keepScreenOn = $state(DEFAULTS.keepScreenOn);

	load() {
		({ theme: this.theme, sound: this.sound, keepScreenOn: this.keepScreenOn } = read());
	}

	save() {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({ theme: this.theme, sound: this.sound, keepScreenOn: this.keepScreenOn })
			);
		} catch {
			// No storage (private tab): settings last only for this visit.
		}
	}
}

export const preferences = new Preferences();
