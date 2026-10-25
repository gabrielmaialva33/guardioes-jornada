/** Two seconds at 60 Hz; sorting happens only when the HUD is sampled. */
export class FrameStats {
	readonly #samples: Float64Array;
	#next = 0;
	#count = 0;
	constructor(capacity = 120) {
		this.#samples = new Float64Array(capacity);
	}
	add(seconds: number) {
		if (!(seconds > 0 && seconds < 1)) return;
		this.#samples[this.#next] = seconds * 1000;
		this.#next = (this.#next + 1) % this.#samples.length;
		this.#count = Math.min(this.#count + 1, this.#samples.length);
	}
	read() {
		if (!this.#count) return { fps: 0, frameP95Ms: 0 };
		const sorted = this.#samples.slice(0, this.#count).sort();
		return {
			fps: (1000 * this.#count) / sorted.reduce((sum, ms) => sum + ms, 0),
			frameP95Ms: sorted[Math.ceil(this.#count * 0.95) - 1]
		};
	}
	reset() {
		this.#count = this.#next = 0;
	}
}
