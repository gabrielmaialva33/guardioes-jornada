/**
 * The study fauna of the LOCAL-ONLY Green Hell study mode (stub while it is
 * being written; the full runtime replaces this file whole).
 */
import type { Camera, Group } from 'three';
import type { StoryLevel } from '../level/types.ts';
import type { Quality } from '../render/quality.ts';
import type { SurvivalWorld } from '../survival/types.ts';

export interface StudyFrame {
	dt: number;
	camera: Camera;
	playerPosition: { x: number; y: number; z: number };
	reducedMotion: boolean;
}

export interface StudyFaunaHost {
	/** The living world's group: the study animals join it when loaded. */
	parent: Group;
	world: SurvivalWorld;
	level?: StoryLevel;
	quality: Quality;
}

export interface StudyFaunaDebug {
	loaded: boolean;
	animals: number;
}

export interface StudyFauna {
	update(frame: StudyFrame): void;
	debug(): StudyFaunaDebug | null;
	dispose(): void;
}

export class StudyFaunaRuntime implements StudyFauna {
	constructor(readonly host: StudyFaunaHost) {}
	update(_frame: StudyFrame) {}
	debug(): StudyFaunaDebug {
		return { loaded: false, animals: 0 };
	}
	dispose() {}
}
