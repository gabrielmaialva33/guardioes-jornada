import type { LocalRecord } from './repository.ts';

const PREFIX = 'guardioes-wal:';
interface JournalEntry {
	key: string;
	id: string;
	text: string;
	raw: unknown;
	parsed: boolean;
}

function browserStorage(): Storage | null {
	return typeof window === 'undefined' ? null : window.localStorage;
}

/** Synchronous safety net; private mode/quota errors must not block IndexedDB. */
export function journalRecord(record: LocalRecord): void {
	try {
		browserStorage()?.setItem(PREFIX + record.id, JSON.stringify(record));
	} catch {
		/* Best effort. */
	}
}

export function readJournal(): JournalEntry[] {
	const entries: JournalEntry[] = [];
	try {
		const storage = browserStorage();
		if (!storage) return entries;
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key?.startsWith(PREFIX)) keys.push(key);
		}
		for (const key of keys) {
			const text = storage.getItem(key);
			if (text === null) continue;
			try {
				entries.push({ key, id: key.slice(PREFIX.length), text, raw: JSON.parse(text), parsed: true });
			} catch {
				entries.push({ key, id: key.slice(PREFIX.length), text, raw: text, parsed: false });
			}
		}
	} catch {
		/* Storage may be unavailable even when its property exists. */
	}
	return entries;
}

/** Compare the complete snapshot: outbox metadata can change at the same rev. */
export function clearJournalEntry(key: string, text: string): void {
	try {
		const storage = browserStorage();
		if (storage && storage.getItem(key) === text) storage.removeItem(key);
	} catch {
		/* Replay is safe to repeat. */
	}
}

export function clearJournalRecord(record: LocalRecord): void {
	try {
		clearJournalEntry(PREFIX + record.id, JSON.stringify(record));
	} catch {
		/* Best effort. */
	}
}
