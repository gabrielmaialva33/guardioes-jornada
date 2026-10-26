/**
 * A minimal fake of the WebAudio API for the engine's tests (Vitest runs in
 * Node): just the nodes, params and context lifecycle the engine touches,
 * with every node and scheduling call recorded. Only imported by *.test.ts.
 */

export class FakeParam {
	value: number;
	readonly events: { type: string; value: number; time: number }[] = [];

	constructor(value = 0) {
		this.value = value;
	}

	setValueAtTime(value: number, time: number) {
		this.events.push({ type: 'set', value, time });
		this.value = value;
		return this;
	}

	linearRampToValueAtTime(value: number, time: number) {
		this.events.push({ type: 'linear', value, time });
		this.value = value;
		return this;
	}

	setTargetAtTime(value: number, time: number, _tau: number) {
		this.events.push({ type: 'target', value, time });
		this.value = value;
		return this;
	}

	cancelScheduledValues(time: number) {
		this.events.push({ type: 'cancel', value: this.value, time });
		return this;
	}
}

export class FakeNode {
	readonly kind: string;
	readonly outputs = new Set<FakeNode>();
	disconnected = false;

	constructor(kind: string) {
		this.kind = kind;
	}

	connect(target: FakeNode) {
		this.outputs.add(target);
		this.disconnected = false;
		return target;
	}

	disconnect() {
		this.outputs.clear();
		this.disconnected = true;
	}
}

export class FakeGain extends FakeNode {
	readonly gain = new FakeParam(1);

	constructor() {
		super('gain');
	}
}

export class FakePanner extends FakeNode {
	panningModel = 'HRTF';
	distanceModel = 'inverse';
	refDistance = 1;
	rolloffFactor = 1;
	maxDistance = 10000;
	readonly positionX = new FakeParam();
	readonly positionY = new FakeParam();
	readonly positionZ = new FakeParam();

	constructor() {
		super('panner');
	}
}

export class FakeCompressor extends FakeNode {
	readonly threshold = new FakeParam(-24);
	readonly knee = new FakeParam(30);
	readonly ratio = new FakeParam(12);
	readonly attack = new FakeParam(0.003);
	readonly release = new FakeParam(0.25);

	constructor() {
		super('compressor');
	}
}

export class FakeBuffer {
	readonly numberOfChannels: number;
	readonly length: number;
	readonly sampleRate: number;
	readonly #data: Float32Array[];

	constructor(channels: number, length: number, sampleRate: number) {
		this.numberOfChannels = channels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.#data = Array.from({ length: channels }, () => new Float32Array(length));
	}

	get duration() {
		return this.length / this.sampleRate;
	}

	getChannelData(channel: number) {
		return this.#data[channel];
	}
}

export class FakeSource extends FakeNode {
	buffer: FakeBuffer | null = null;
	loop = false;
	loopStart = 0;
	loopEnd = 0;
	readonly playbackRate = new FakeParam(1);
	onended: (() => void) | null = null;
	startedAt: number | null = null;
	stoppedAt: number | null = null;

	constructor() {
		super('source');
	}

	start(when = 0) {
		if (this.startedAt !== null) throw new Error('InvalidStateError: start twice');
		this.startedAt = when;
	}

	stop(when = 0) {
		if (this.startedAt === null) throw new Error('InvalidStateError: stop before start');
		this.stoppedAt = when;
	}

	/** Simulates the end of playback (natural or after stop). */
	end() {
		this.onended?.();
	}
}

export class FakeListener {
	readonly positionX = new FakeParam();
	readonly positionY = new FakeParam();
	readonly positionZ = new FakeParam();
	readonly forwardX = new FakeParam();
	readonly forwardY = new FakeParam();
	readonly forwardZ = new FakeParam(-1);
	readonly upX = new FakeParam();
	readonly upY = new FakeParam(1);
	readonly upZ = new FakeParam();
}

export class FakeAudioContext {
	state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
	currentTime = 0;
	readonly sampleRate = 48000;
	readonly destination = new FakeNode('destination');
	readonly listener = new FakeListener();
	readonly nodes: FakeNode[] = [];
	readonly sources: FakeSource[] = [];
	readonly buffers: FakeBuffer[] = [];
	readonly calls: string[] = [];
	decoded = 0;
	/** Set to make decodeAudioData reject (unsupported codec). */
	decodeFails: ((bytes: ArrayBuffer) => boolean) | null = null;

	createGain() {
		return this.#track(new FakeGain());
	}

	createPanner() {
		return this.#track(new FakePanner());
	}

	createDynamicsCompressor() {
		return this.#track(new FakeCompressor());
	}

	createBufferSource() {
		const source = this.#track(new FakeSource());
		this.sources.push(source);
		return source;
	}

	createBuffer(channels: number, length: number, sampleRate: number) {
		const buffer = new FakeBuffer(channels, length, sampleRate);
		this.buffers.push(buffer);
		return buffer;
	}

	decodeAudioData(bytes: ArrayBuffer) {
		if (this.decodeFails?.(bytes)) return Promise.reject(new Error('EncodingError'));
		this.decoded++;
		return Promise.resolve(new FakeBuffer(1, 4800, this.sampleRate));
	}

	resume() {
		this.calls.push('resume');
		if (this.state !== 'closed') this.state = 'running';
		return Promise.resolve();
	}

	suspend() {
		this.calls.push('suspend');
		if (this.state !== 'closed') this.state = 'suspended';
		return Promise.resolve();
	}

	close() {
		this.calls.push('close');
		this.state = 'closed';
		return Promise.resolve();
	}

	#track<T extends FakeNode>(node: T): T {
		this.nodes.push(node);
		return node;
	}

	/** Sources started but neither stopped nor ended: what would still be scheduled. */
	live() {
		return this.sources.filter((s) => s.startedAt !== null && s.stoppedAt === null);
	}
}

/** A `document` stand-in: an EventTarget with a writable `hidden`. */
export class FakePage extends EventTarget {
	hidden = false;
	listeners = 0;

	override addEventListener(
		type: string,
		listener: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean
	) {
		this.listeners++;
		const signal = typeof options === 'object' ? options.signal : undefined;
		signal?.addEventListener('abort', () => this.listeners--, { once: true });
		super.addEventListener(type, listener, options);
	}

	fire(type: string) {
		this.dispatchEvent(new Event(type));
	}
}
