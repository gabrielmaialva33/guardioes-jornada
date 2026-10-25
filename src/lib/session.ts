import type { Achievement, Area, Journey, Rank, Step } from './content/types.ts';

export interface Group {
	id: string;
	name: string;
	color: string;
}

/** Every point awarded is an event; a group's score is always their sum. */
export interface ScoreEvent {
	id: string;
	at: number;
	groupId: string;
	delta: number;
	stepId: string | null;
	/** Checklist item that earned the point, if any. */
	item?: string;
}

/** One class going through a journey, run from the guide's phone. */
export interface Session {
	id: string;
	/** Local revision, independent of the phone's wall clock. */
	rev: number;
	ownerId: string | null;
	journeyId: string;
	createdAt: number;
	updatedAt: number;
	school: string;
	className: string;
	guide: string;
	/** Visit date as YYYY-MM-DD. */
	date: string;
	groups: Group[];
	/** Index of the current step; equals steps.length once the journey is over. */
	step: number;
	/** The current mission has been revealed to the class. */
	revealed: boolean;
	scores: ScoreEvent[];
	/** Keys of photos stored on this device (see photos.ts). */
	photos: string[];
	oathAt: number | null;
	/** Printed on the certificates; anyone can check it online once the session is backed up. */
	certificateCode: string;
}

export interface Progress {
	missions: number;
	oath: boolean;
}

/** What the class gained when a step was completed, for the celebration screen. */
export interface Gains {
	step: Step;
	areas: Area[];
	achievements: Achievement[];
	rank: Rank | null;
}

export function newId(): string {
	return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

// Crockford base32: no I, L, O or U, so a code copied from paper is hard to misread.
// 32 symbols divide 256 evenly, so every symbol is equally likely.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newCertificateCode(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CROCKFORD[b % 32]).join('');
}

/** Normalizes a typed code the way Crockford base32 decoders do (O→0, I/L→1). */
export function normalizeCertificateCode(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/** Fills in fields that older app versions did not save. */
export function normalizeSession(raw: Partial<Session> & Pick<Session, 'id'>): Session {
	return {
		rev: 1,
		ownerId: null,
		journeyId: 'penap',
		createdAt: Date.now(),
		updatedAt: 0,
		school: '',
		className: '',
		guide: '',
		date: todayIso(),
		groups: [],
		step: 0,
		revealed: false,
		scores: [],
		photos: [],
		oathAt: null,
		certificateCode: newCertificateCode(),
		...raw
	};
}

export function currentStep(session: Session, journey: Journey): Step | null {
	return journey?.steps[session.step] ?? null;
}

export function isFinished(session: Session, journey: Journey): boolean {
	return !!journey && session.step >= journey.steps.length;
}

export function missionCount(journey: Journey): number {
	return journey.steps.filter((s) => s.kind === 'mission').length;
}

/** 1-based position of a mission within the journey, or 0 if it is not a mission. */
export function missionNumber(journey: Journey, stepId: string): number {
	return journey.steps.filter((s) => s.kind === 'mission').findIndex((s) => s.id === stepId) + 1;
}

export function progressOf(session: Session, journey: Journey): Progress {
	return {
		missions: journey.steps.slice(0, session.step).filter((s) => s.kind === 'mission').length,
		oath: session.oathAt !== null
	};
}

export function openAreas(journey: Journey, missions: number): Area[] {
	return journey.areas.filter((a) => missions >= a.missions);
}

export function rankOf(journey: Journey, missions: number): Rank {
	return journey.ranks.findLast((r) => missions >= r.missions) ?? journey.ranks[0];
}

/** Each finished mission is worth this much class XP; ranks unlock at mission counts. */
export const XP_PER_MISSION = 100;

export interface Level {
	rank: Rank;
	number: number;
	next: Rank | null;
	xp: number;
	/** Progress toward the next rank, 0 to 1 (1 at the top rank). */
	progress: number;
}

export function levelOf(journey: Journey, missions: number): Level {
	const index = journey.ranks.findLastIndex((r) => missions >= r.missions);
	const rank = journey.ranks[Math.max(0, index)];
	const next = journey.ranks[index + 1] ?? null;
	const progress = next ? (missions - rank.missions) / (next.missions - rank.missions) : 1;
	return { rank, number: Math.max(0, index) + 1, next, xp: missions * XP_PER_MISSION, progress };
}

export function earnedAchievements(journey: Journey, progress: Progress): Achievement[] {
	return journey.achievements.filter((a) =>
		a.oath ? progress.oath : a.missions !== undefined && progress.missions >= a.missions
	);
}

export function gainsBetween(journey: Journey, step: Step, before: Progress, after: Progress): Gains {
	const hadAchievement = new Set(earnedAchievements(journey, before).map((a) => a.id));
	const hadArea = new Set(openAreas(journey, before.missions).map((a) => a.id));
	const rankBefore = rankOf(journey, before.missions);
	const rankAfter = rankOf(journey, after.missions);
	return {
		step,
		areas: openAreas(journey, after.missions).filter((a) => !hadArea.has(a.id)),
		achievements: earnedAchievements(journey, after).filter((a) => !hadAchievement.has(a.id)),
		rank: rankAfter.name !== rankBefore.name ? rankAfter : null
	};
}

export function groupScore(session: Session, groupId: string): number {
	return session.scores.reduce((sum, e) => (e.groupId === groupId ? sum + e.delta : sum), 0);
}

/** Groups from highest to lowest score; ties keep creation order. */
export function standings(session: Session): { group: Group; score: number }[] {
	return session.groups
		.map((group) => ({ group, score: groupScore(session, group.id) }))
		.toSorted((a, b) => b.score - a.score);
}

export function itemFound(session: Session, groupId: string, stepId: string, item: string): boolean {
	return session.scores.some((e) => e.groupId === groupId && e.stepId === stepId && e.item === item);
}

// Plain Date on purpose: Temporal is still missing on the older phones guides carry.
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

export function formatDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	return dateFormat.format(new Date(year, month - 1, day));
}

export function todayIso(): string {
	const now = new Date();
	return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
		.map((n) => String(n).padStart(2, '0'))
		.join('-');
}
