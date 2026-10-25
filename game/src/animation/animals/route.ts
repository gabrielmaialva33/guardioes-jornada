/**
 * A polyline the scene lays out for an animal: a trail for the jaguar, a branch
 * for the howler and the sloth, a row of handholds for the muriqui. Points are
 * world positions (feet on a trail, top of a branch, or a handhold), packed
 * x, y, z. Open routes are walked back and forth; closed ones loop.
 *
 * Sampling writes into a RouteCursor instead of taking and returning numbers:
 * see Playhead in ../track.ts for why (V8 boxes fractional arguments and return
 * values of calls it does not inline).
 */

export class RouteCursor {
	/** Arc length along the route, u. Wrapped (closed) or clamped (open) when sampled. */
	s = 0;
	/** Travel direction along the route: 1 forward, -1 backward. */
	direction = 1;
	x = 0;
	y = 0;
	z = 0;
	/** Unit tangent in the travel direction, and its yaw (0 = +z). */
	dx = 0;
	dy = 0;
	dz = 1;
	yaw = 0;
	/** Index of the segment the cursor is on. */
	segment = 0;
}

export class Route {
	readonly points: Float64Array;
	readonly count: number;
	readonly closed: boolean;
	/** Arc length at each point (and at the closing point for loops). */
	readonly lengths: Float64Array;
	readonly length: number;

	constructor(points: ArrayLike<number>, closed = false) {
		const count = Math.floor(points.length / 3);
		if (count < 1) throw new Error('A route needs at least one point');
		this.points = Float64Array.from({ length: count * 3 }, (_, i) => {
			const value = points[i];
			if (!Number.isFinite(value)) throw new Error('Route points must be finite');
			return value;
		});
		this.count = count;
		this.closed = closed && count > 2;
		const segments = this.closed ? count : count - 1;
		this.lengths = new Float64Array(segments + 1);
		for (let i = 0; i < segments; i++) {
			const a = i * 3;
			const b = ((i + 1) % count) * 3;
			const p = this.points;
			this.lengths[i + 1] =
				this.lengths[i] + Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
		}
		this.length = this.lengths[segments];
	}

	/** Number of segments. */
	get segments(): number {
		return this.lengths.length - 1;
	}

	/** Point `index` (wrapped on loops, clamped otherwise) into the cursor's x, y, z. */
	pointInto(index: number, cursor: RouteCursor) {
		const i = this.closed
			? ((index % this.count) + this.count) % this.count
			: Math.min(Math.max(index, 0), this.count - 1);
		cursor.x = this.points[i * 3];
		cursor.y = this.points[i * 3 + 1];
		cursor.z = this.points[i * 3 + 2];
	}

	/**
	 * Fills the cursor's position, tangent and yaw at its arc length. Open routes
	 * clamp s to [0, length]; loops wrap it. The tangent follows cursor.direction.
	 */
	locate(cursor: RouteCursor) {
		const length = this.length;
		let s = Number.isFinite(cursor.s) ? cursor.s : 0;
		if (this.closed && length > 0) s = ((s % length) + length) % length;
		else s = Math.min(Math.max(s, 0), length);
		cursor.s = s;
		const lengths = this.lengths;
		const segments = lengths.length - 1;
		if (segments === 0) {
			this.pointInto(0, cursor);
			cursor.segment = 0;
			return;
		}
		let i = Math.min(Math.max(cursor.segment, 0), segments - 1);
		while (i > 0 && s < lengths[i]) i--;
		while (i < segments - 1 && s > lengths[i + 1]) i++;
		cursor.segment = i;
		const p = this.points;
		const a = i * 3;
		const b = ((i + 1) % this.count) * 3;
		const span = lengths[i + 1] - lengths[i];
		const t = span > 0 ? (s - lengths[i]) / span : 0;
		cursor.x = p[a] + (p[b] - p[a]) * t;
		cursor.y = p[a + 1] + (p[b + 1] - p[a + 1]) * t;
		cursor.z = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
		const sign = cursor.direction < 0 ? -1 : 1;
		const inv = span > 0 ? sign / span : 0;
		cursor.dx = (p[b] - p[a]) * inv;
		cursor.dy = (p[b + 1] - p[a + 1]) * inv;
		cursor.dz = (p[b + 2] - p[a + 2]) * inv;
		if (cursor.dx !== 0 || cursor.dz !== 0) cursor.yaw = Math.atan2(cursor.dx, cursor.dz);
	}

	/**
	 * Moves the cursor by `cursor.direction × distance` (read from `step`), turning
	 * back at the ends of open routes. Returns nothing; read the cursor.
	 */
	advance(cursor: RouteCursor, step: StepDistance) {
		let s = cursor.s + cursor.direction * step.distance;
		if (!this.closed) {
			if (s > this.length) {
				s = 2 * this.length - s;
				cursor.direction = -1;
			} else if (s < 0) {
				s = -s;
				cursor.direction = 1;
			}
			s = Math.min(Math.max(s, 0), this.length);
		}
		cursor.s = s;
		this.locate(cursor);
	}
}

/** A distance carried in an object field (see the module comment). */
export class StepDistance {
	distance = 0;
}
