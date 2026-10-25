import { AVATAR_PARTS, type AvatarColors, type AvatarProfile } from '../data/local-save.ts';
export interface SkinSink<Image> {
	classic(colors: AvatarColors, face: AvatarProfile['face']): void;
	kenney(image: Image): void;
	commit(): void;
}
/** Latest choice wins; decoded bitmaps are never retained, even when an obsolete request resolves late. */
export class SkinUpdates<Image extends { close(): void }> {
	readonly #sink: SkinSink<Image>;
	readonly #load: (id: string, signal: AbortSignal) => Promise<Image>;
	#generation = 0;
	#desired = '';
	#committed = '';
	#disposed = false;
	#abort: AbortController | undefined;
	#pending: Promise<boolean> | undefined;
	constructor(sink: SkinSink<Image>, load: (id: string, signal: AbortSignal) => Promise<Image>) {
		this.#sink = sink;
		this.#load = load;
	}
	apply(profile: AvatarProfile): Promise<boolean> {
		if (this.#disposed) return Promise.resolve(false);
		const key =
			profile.style === 'kenney'
				? `kenney:${profile.kenneySkin}`
				: `classic:${AVATAR_PARTS.map((part) => profile.colors[part]).join(':')}:${profile.face}`;
		if (key === this.#desired) return this.#pending ?? Promise.resolve(false);
		this.#desired = key;
		const generation = ++this.#generation;
		this.#abort?.abort();
		if (key === this.#committed) {
			this.#pending = undefined;
			return Promise.resolve(false);
		}
		const abort = new AbortController();
		this.#abort = abort;
		const pending = (async () => {
			try {
				if (profile.style === 'classic') this.#sink.classic(profile.colors, profile.face);
				else {
					const image = await this.#load(profile.kenneySkin, abort.signal);
					try {
						if (this.#disposed || generation !== this.#generation) return false;
						this.#sink.kenney(image);
					} finally {
						image.close();
					}
				}
				if (this.#disposed || generation !== this.#generation) return false;
				this.#sink.commit();
				this.#committed = key;
				return true;
			} catch (error) {
				if (this.#disposed || generation !== this.#generation) return false;
				this.#desired = this.#committed;
				throw error;
			}
		})();
		this.#pending = pending;
		const clear = () => {
			if (generation === this.#generation) this.#pending = undefined;
		};
		pending.then(clear, clear);
		return pending;
	}
	dispose() {
		this.#disposed = true;
		this.#generation++;
		this.#abort?.abort();
		this.#pending = undefined;
	}
}
