/**
 * Shape of a journey script. The app is only the engine: every line the guide
 * reads lives in content files like `mata-atlantica.ts`, so whoever owns the story can
 * edit missions without touching the rest of the code.
 */

import type { IconName } from '../icons.generated.ts';

export type StepKind = 'opening' | 'mission' | 'oath';

export interface ChecklistItem {
	id: string;
	label: string;
}

export interface Step {
	id: string;
	kind: StepKind;
	title: string;
	/** Emblem shown on the step card (Phosphor icon, see scripts/icons.ts). */
	icon: IconName;
	/** Opening line, read aloud by the guide. */
	callout: string;
	instructions?: string;
	power?: string;
	/** Drawing rendered by the app (see components/Illustration.svelte). */
	illustration?: 'canela-and-cedro';
	timer?: { seconds: number; label: string };
	/** Shows the scoreboard inside the mission so the guide can award points on the spot. */
	scored?: boolean;
	/** Things each group must find; every item found is worth 1 point. */
	checklist?: ChecklistItem[];
}

export interface Area {
	id: string;
	name: string;
	icon: IconName;
	description: string;
	/** Missions the class must finish to open this area. */
	missions: number;
}

export interface Rank {
	name: string;
	missions: number;
}

export interface Achievement {
	id: string;
	name: string;
	description: string;
	missions?: number;
	oath?: boolean;
}

/** A team participants can join; named after a tree they meet on the trail. */
export interface GroupOption {
	name: string;
	color: string;
	/** One line shown when choosing the group. */
	hint: string;
}

export interface Closing {
	title: string;
	text: string;
	pledge: string;
}

export interface Journey {
	id: string;
	name: string;
	place: string;
	steps: Step[];
	/** Teams offered when a participant joins; points and certificates follow them. */
	groups: GroupOption[];
	areas: Area[];
	ranks: Rank[];
	achievements: Achievement[];
	closing: Closing;
}
