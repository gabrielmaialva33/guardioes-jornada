/**
 * What the avatar looks at (AvatarInput.lookTarget): Iara first, then animals,
 * then collectibles, each within its range and a cone around the facing
 * direction, nearest first within a kind.
 *
 * Hysteresis keeps the head from snapping between targets: the current target
 * is kept while it stays inside a wider cone and a longer range, and only a
 * kind of higher priority takes over from it; a newcomer of the same or a
 * lower kind waits until the current one is let go.
 *
 * Pure and allocation-free: it returns one of the candidates (or null) and
 * the caller passes back the id it got last time.
 */

const DEG = Math.PI / 180;

export type LookKind = 'iara' | 'animal' | 'collectible';

export interface LookCandidate {
	/** Stable id across frames (an entity id). */
	readonly id: number;
	readonly kind: LookKind;
	/** The point to look at (eyes, head or the item), world units. */
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** The avatar's feet and facing, as in AvatarInput (yaw 0 faces +z). */
export interface Looker {
	readonly x: number;
	readonly z: number;
	readonly yaw: number;
}

export const LOOK_PICK = {
	/** Priority, lower first. */
	rank: { iara: 0, animal: 1, collectible: 2 } as Readonly<Record<LookKind, number>>,
	/** Range (u) to pick a target. */
	range: { iara: 10, animal: 14, collectible: 6 } as Readonly<Record<LookKind, number>>,
	/** Half angle of the cone around the facing direction to pick a target. */
	cone: 60 * DEG,
	/** The current target is kept out to range × keepRange and cone + keepCone. */
	keepRange: 1.3,
	keepCone: 25 * DEG,
	/** Closer than this the head would turn to the feet: ignored. */
	minRange: 0.6
} as const;

/** How far (a share of the kind's range) and how far off the facing (radians) a candidate is, or NaN outside. */
function offset(c: LookCandidate, avatar: Looker, rangeScale: number, cone: number): number {
	const dx = c.x - avatar.x;
	const dz = c.z - avatar.z;
	const distance = Math.sqrt(dx * dx + dz * dz);
	if (!(distance >= LOOK_PICK.minRange) || distance > LOOK_PICK.range[c.kind] * rangeScale) return Number.NaN;
	// Angle between the facing (sin yaw, cos yaw) and the direction, without atan2's branch cuts.
	const facing = (Math.sin(avatar.yaw) * dx + Math.cos(avatar.yaw) * dz) / distance;
	if (!(facing >= Math.cos(cone))) return Number.NaN;
	return distance;
}

/**
 * The candidate to look at, or null. `currentId` is the id returned last time
 * (null at first): kept while it stays in the wider cone and range, unless a
 * candidate of a higher-priority kind is in the normal cone.
 */
export function pickLookTarget(
	candidates: readonly LookCandidate[],
	avatar: Looker,
	currentId: number | null = null
): LookCandidate | null {
	let current: LookCandidate | null = null;
	if (currentId !== null)
		for (const c of candidates)
			if (c.id === currentId) {
				const keep = offset(
					c,
					avatar,
					LOOK_PICK.keepRange,
					Math.min(Math.PI, LOOK_PICK.cone + LOOK_PICK.keepCone)
				);
				if (!Number.isNaN(keep)) current = c;
				break;
			}

	let best: LookCandidate | null = null;
	let bestRank = 3;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const c of candidates) {
		const distance = offset(c, avatar, 1, LOOK_PICK.cone);
		if (Number.isNaN(distance)) continue;
		const rank = LOOK_PICK.rank[c.kind];
		if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
			best = c;
			bestRank = rank;
			bestDistance = distance;
		}
	}
	if (current !== null && (best === null || bestRank >= LOOK_PICK.rank[current.kind])) return current;
	return best;
}
