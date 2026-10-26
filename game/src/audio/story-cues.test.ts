import { describe, expect, it } from 'vitest';
import { emptyMarks, type StoryMarks, storyCues } from './story-cues.ts';

const marks = (change: Partial<StoryMarks> = {}): StoryMarks => ({
	...emptyMarks(),
	started: true,
	...change
});
const ids = (before: Partial<StoryMarks>, after: Partial<StoryMarks>) =>
	storyCues(marks(before), marks(after)).map((cue) => cue.id);

describe('story cues', () => {
	it('maps pick-ups, planting, flags and radio calls to their sounds', () => {
		expect(ids({}, { fruits: 1 })).toEqual(['collect']);
		expect(ids({}, { collected: 1 })).toEqual(['collect']);
		expect(ids({}, { nursery: true })).toEqual(['collect']);
		expect(ids({}, { planted: 1 })).toEqual(['land']);
		expect(ids({}, { marked: 1 })).toEqual(['collect']);
		expect(storyCues(marks(), marks({ marked: 1 }))[0].rate).toBeLessThan(1);
		expect(ids({}, { reported: 1 })).toEqual(['radio-call']);
		expect(ids({}, { dialogue: 'logger' })).toEqual(['radio-call']);
	});

	it('plays a mission or the badge alone', () => {
		expect(ids({}, { planted: 5, completed: 1 })).toEqual(['mission-complete']);
		expect(ids({ completed: 0b11111 }, { completed: 0b111111, finished: true })).toEqual(['badge']);
	});

	it('stays quiet when nothing grew, on a dialogue that is not the radio and on a restart', () => {
		expect(ids({ fruits: 2 }, { fruits: 2 })).toEqual([]);
		expect(ids({}, { dialogue: 'iara' })).toEqual([]);
		expect(ids({ dialogue: 'logger' }, { dialogue: 'logger' })).toEqual([]);
		expect(ids({ fruits: 5, planted: 5, completed: 1 }, {})).toEqual([]);
	});
});
