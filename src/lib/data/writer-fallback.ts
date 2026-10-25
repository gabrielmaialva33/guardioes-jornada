import type { WriterLease } from './repository.ts';

type Signal = { type: 'probe' | 'candidate' | 'heartbeat' | 'release'; id: string };

/** Advisory only: suspended tabs cannot provide the guarantees of Web Locks. */
export function acquireFallbackWriter(): Promise<WriterLease | null> {
	let channel: BroadcastChannel;
	try {
		if (typeof BroadcastChannel === 'undefined') return Promise.resolve(() => {});
		channel = new BroadcastChannel('guardioes-writer');
	} catch {
		return Promise.resolve(() => {});
	}
	return new Promise((resolve) => {
		// getRandomValues also exists on phones predating crypto.randomUUID.
		const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
			part.toString(16).padStart(8, '0')
		).join('');
		const candidates = new Set<string>([id]);
		let writer = false,
			blocked = false,
			closed = false;
		let heartbeat: ReturnType<typeof setInterval> | undefined;
		let lose!: () => void;
		const lost = new Promise<void>((done) => {
			lose = done;
		});
		const send = (type: Signal['type']) => {
			try {
				channel.postMessage({ type, id } satisfies Signal);
			} catch {
				/* Coordination is best effort. */
			}
		};
		const release: WriterLease = () => {
			if (closed) return;
			closed = true;
			clearInterval(heartbeat);
			if (writer) send('release');
			channel.close();
		};
		release.lost = lost;
		channel.onmessage = (event: MessageEvent<unknown>) => {
			if (closed || !event.data || typeof event.data !== 'object') return;
			const message = event.data as Partial<Signal>;
			if (typeof message.id !== 'string' || message.id === id) return;
			if (message.type === 'probe') send(writer ? 'heartbeat' : 'candidate');
			else if (message.type === 'candidate') candidates.add(message.id);
			else if (message.type === 'release') candidates.delete(message.id);
			else if (message.type === 'heartbeat') {
				if (!writer) blocked = true;
				// Resolve a rare split election when a suspended tab resumes.
				else if (message.id < id) {
					release();
					lose();
				}
			}
		};
		send('probe');
		send('candidate');
		setTimeout(() => {
			if (blocked || [...candidates].some((candidate) => candidate < id)) {
				release();
				resolve(null);
				return;
			}
			writer = true;
			send('heartbeat');
			heartbeat = setInterval(() => send('heartbeat'), 1000);
			resolve(release);
		}, 250);
	});
}
