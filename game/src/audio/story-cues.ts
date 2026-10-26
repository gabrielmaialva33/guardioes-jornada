/**
 * Mission sounds from the story state: StoryGame keeps its rules pure and
 * bumps `revision` on every change, so the sounds come from comparing two
 * snapshots of its counters instead of hooks inside the rules. Runs only when
 * the revision changed.
 *
 * Mapping (c-audio.md §2.2–2.3; plant and mark have no recording yet and use
 * the nearest essential sound):
 * - harvest a fruit, pick up trash or a gold leaf, take the seedlings: collect;
 * - plant a seed or a seedling: land (a soft thud of earth), lower;
 * - flag a trap: collect, lower pitch;
 * - call Iara (radio dialogue) or the inspectors: radio-call;
 * - a mission done: mission-complete; the last one: badge (instead).
 * A mission or the badge plays alone, so a radio answer that completes a
 * mission does not stack two jingles.
 */
import type { SoundId } from './bank.ts';

export interface StoryMarks {
	fruits: number;
	collected: number;
	planted: number;
	marked: number;
	reported: number;
	nursery: boolean;
	/** Bit (id − 1) per completed mission. */
	completed: number;
	finished: boolean;
	dialogue: string | null;
	started: boolean;
}

/** The part of StoryGame the cues read. */
export interface StoryLike {
	readonly data: {
		started: boolean;
		fruits: readonly string[];
		collected: readonly string[];
		planted: readonly string[];
		marked: readonly string[];
		reported: readonly string[];
		nurseryTaken: boolean;
	};
	readonly dialogue: { id: string } | null;
	readonly level: { missions: readonly { id: number }[] };
	readonly finished: boolean;
	completed(id: number): boolean;
}

export interface StoryCue {
	id: SoundId;
	/** Playback-rate factor (pitch). */
	rate: number;
	gain: number;
}

export function emptyMarks(): StoryMarks {
	return {
		fruits: 0,
		collected: 0,
		planted: 0,
		marked: 0,
		reported: 0,
		nursery: false,
		completed: 0,
		finished: false,
		dialogue: null,
		started: false
	};
}

export function readMarks(story: StoryLike, out: StoryMarks): StoryMarks {
	const data = story.data;
	out.fruits = data.fruits.length;
	out.collected = data.collected.length;
	out.planted = data.planted.length;
	out.marked = data.marked.length;
	out.reported = data.reported.length;
	out.nursery = data.nurseryTaken;
	out.completed = 0;
	for (const m of story.level.missions) if (story.completed(m.id)) out.completed |= 1 << (m.id - 1);
	out.finished = story.finished;
	out.dialogue = story.dialogue?.id ?? null;
	out.started = data.started;
	return out;
}

/** Dialogues that are a radio call. */
const RADIO_DIALOGUES = new Set(['logger', 'logger-reply']);

/** The sounds between two snapshots, in play order; a restart (counters going down) is silent. */
export function storyCues(before: StoryMarks, after: StoryMarks): StoryCue[] {
	if (after.finished && !before.finished) return [{ id: 'badge', rate: 1, gain: 1 }];
	if ((after.completed & ~before.completed) !== 0) return [{ id: 'mission-complete', rate: 1, gain: 1 }];
	const cues: StoryCue[] = [];
	if (
		after.fruits > before.fruits ||
		after.collected > before.collected ||
		(after.nursery && !before.nursery)
	)
		cues.push({ id: 'collect', rate: 1, gain: 1 });
	if (after.planted > before.planted) cues.push({ id: 'land', rate: 0.85, gain: 0.8 });
	if (after.marked > before.marked) cues.push({ id: 'collect', rate: 0.75, gain: 0.8 });
	if (
		after.reported > before.reported ||
		(after.dialogue !== null && after.dialogue !== before.dialogue && RADIO_DIALOGUES.has(after.dialogue))
	)
		cues.push({ id: 'radio-call', rate: 1, gain: 1 });
	return cues;
}
