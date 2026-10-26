import { type SpeciesRegistry, validId } from './registry.ts';
export type DiscoveryOrigin = 'photo' | 'mission' | 'trap';
export interface Discovery {
	firstSeen: number;
	origins: DiscoveryOrigin[];
	[extension: string]: unknown;
}
export interface GuideDocument {
	version: 1;
	discoveries: Record<string, Discovery>;
	[extension: string]: unknown;
}
export interface GuideDecode {
	status: 'missing' | 'ok' | 'future' | 'invalid';
	document: GuideDocument | null;
}
const record = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
export function decodeGuide(raw: unknown): GuideDecode {
	if (raw == null) return { status: 'missing', document: null };
	if (!record(raw)) return { status: 'invalid', document: null };
	if (typeof raw.version === 'number' && raw.version > 1) return { status: 'future', document: null };
	if (raw.version !== 1 || !record(raw.discoveries) || Object.keys(raw.discoveries).length > 1024)
		return { status: 'invalid', document: null };
	for (const [id, d] of Object.entries(raw.discoveries))
		if (
			!validId(id) ||
			!record(d) ||
			!Number.isFinite(d.firstSeen) ||
			Number(d.firstSeen) < 0 ||
			!Array.isArray(d.origins) ||
			d.origins.length < 1 ||
			d.origins.length > 3 ||
			d.origins.some((x) => !['photo', 'mission', 'trap'].includes(x))
		)
			return { status: 'invalid', document: null };
	return { status: 'ok', document: structuredClone(raw) as GuideDocument };
}
/** Pure device-local discovery model. Unknown future species survive snapshots but do not inflate the counter. */
export class GuideBook {
	readonly #document: GuideDocument;
	revision = 0;
	constructor(
		readonly registry: SpeciesRegistry,
		document: GuideDocument = { version: 1, discoveries: {} }
	) {
		this.#document = structuredClone(document);
		this.#document.discoveries = Object.create(null);
		for (const [id, entry] of Object.entries(document.discoveries)) {
			const key = registry.find(id)?.id ?? id,
				previous = this.#document.discoveries[key];
			this.#document.discoveries[key] = previous
				? {
						...entry,
						...previous,
						firstSeen: Math.min(previous.firstSeen, entry.firstSeen),
						origins: [...new Set([...previous.origins, ...entry.origins])]
					}
				: structuredClone(entry);
		}
	}
	get total() {
		return this.registry.entries.length;
	}
	get count() {
		let n = 0;
		for (const s of this.registry.entries) if (this.#document.discoveries[s.id]) n++;
		return n;
	}
	has(id: string) {
		return !!this.#document.discoveries[this.registry.find(id)?.id ?? ''];
	}
	get(id: string): Discovery | undefined {
		const d = this.#document.discoveries[this.registry.find(id)?.id ?? ''];
		return d ? structuredClone(d) : undefined;
	}
	discover(id: string, origin: DiscoveryOrigin, at: number) {
		const s = this.registry.find(id);
		if (!s || !Number.isFinite(at) || at < 0 || !['photo', 'mission', 'trap'].includes(origin)) return false;
		const d = this.#document.discoveries[s.id];
		if (d?.origins.includes(origin)) return false;
		if (d) d.origins.push(origin);
		else this.#document.discoveries[s.id] = { firstSeen: at, origins: [origin] };
		this.revision++;
		return true;
	}
	snapshot(): GuideDocument {
		return structuredClone(this.#document);
	}
}
