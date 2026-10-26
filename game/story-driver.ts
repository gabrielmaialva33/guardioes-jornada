/** E2E navigation through the real controller, never teleporting or setting mission progress. */

import type { Page } from '@playwright/test';
import { buildStoryWorld } from './src/level/build.ts';
import type {} from './src/scene/types.ts';
import type { Point } from './src/survival/types.ts';
import { prefabProxies } from './src/world-runtime/collision.ts';
export const storyBuild = buildStoryWorld();
const { world } = storyBuild,
	N = world.grid;
const blocked = new Uint8Array(N * N);
for (const b of world.blocks) {
	for (let i = 0; i < b.cylinders.length; i += 5) {
		const [x, , z, r] = b.cylinders.subarray(i, i + 5);
		for (let gz = Math.max(0, Math.floor(z - r - 1)); gz <= Math.min(world.size, Math.ceil(z + r + 1)); gz++)
			for (
				let gx = Math.max(0, Math.floor(x - r - 1));
				gx <= Math.min(world.size, Math.ceil(x + r + 1));
				gx++
			)
				if (Math.hypot(gx - x, gz - z) < r + 0.65) blocked[gz * N + gx] = 1;
	}
	for (let i = 0; i < b.boxes.length; i += 8) {
		const [x, , z, hx, , hz, c, s] = b.boxes.subarray(i, i + 8);
		for (
			let gz = Math.max(0, Math.floor(z - hx - hz - 1));
			gz <= Math.min(world.size, Math.ceil(z + hx + hz + 1));
			gz++
		)
			for (
				let gx = Math.max(0, Math.floor(x - hx - hz - 1));
				gx <= Math.min(world.size, Math.ceil(x + hx + hz + 1));
				gx++
			) {
				const dx = gx - x,
					dz = gz - z;
				if (Math.abs(dx * c - dz * s) < hx + 0.65 && Math.abs(dx * s + dz * c) < hz + 0.65)
					blocked[gz * N + gx] = 1;
			}
	}
}
for (const p of prefabProxies(world, storyBuild.level)) {
	const r = Math.hypot(p.sx, p.sz) / 2 + 1;
	for (let z = Math.max(0, Math.floor(p.z - r)); z <= Math.min(world.size, Math.ceil(p.z + r)); z++)
		for (let x = Math.max(0, Math.floor(p.x - r)); x <= Math.min(world.size, Math.ceil(p.x + r)); x++) {
			const dx = x - p.x,
				dz = z - p.z,
				c = Math.cos(p.yaw ?? 0),
				sn = Math.sin(p.yaw ?? 0);
			if (Math.abs(dx * c - dz * sn) < p.sx / 2 + 0.65 && Math.abs(dx * sn + dz * c) < p.sz / 2 + 0.65)
				blocked[z * N + x] = 1;
		}
}
// Raised Act 1 decks cannot be crossed by the ground-only route planner.
for (const d of storyBuild.level.act1?.decks ?? [])
	for (let z = Math.floor(d.z0 - 0.6); z <= Math.ceil(d.z1 + 0.6); z++)
		for (let x = Math.floor(d.x0 - 0.6); x <= Math.ceil(d.x1 + 0.6); x++)
			if (d.y - world.heights[z * N + x] > 0.4 && d.y - world.heights[z * N + x] < 3.5)
				blocked[z * N + x] = 1;
const index = (x: number, z: number) => Math.round(z) * N + Math.round(x);
function floorAt(q: number) {
	if (world.flags[q] & 16) {
		const x = q % N,
			z = Math.floor(q / N);
		for (const c of world.crossings)
			if (c.kind !== 'stepping-stones') {
				const dx = c.to.x - c.from.x,
					dz = c.to.z - c.from.z,
					t = ((x - c.from.x) * dx + (z - c.from.z) * dz) / (dx * dx + dz * dz);
				if (t >= 0 && t <= 1) return c.from.y + (c.to.y - c.from.y) * t;
			}
	}
	return world.heights[q];
}
export function walkingPath(start: Point, target: Point, radius: number) {
	const source = index(start.x, start.z),
		previous = new Int32Array(N * N).fill(-1),
		queue = new Int32Array(N * N);
	let read = 0,
		end = 1,
		goal = -1;
	queue[0] = source;
	previous[source] = source;
	while (read < end) {
		const q = queue[read++],
			x = q % N,
			z = Math.floor(q / N);
		if (Math.hypot(x - target.x, z - target.z) <= radius) {
			goal = q;
			break;
		}
		for (const [dx, dz] of [
			[-1, 0],
			[1, 0],
			[0, -1],
			[0, 1],
			[-1, -1],
			[-1, 1],
			[1, -1],
			[1, 1]
		]) {
			const px = x + dx,
				pz = z + dz;
			if (px < 1 || pz < 1 || px >= world.size || pz >= world.size) continue;
			const next = pz * N + px;
			if (previous[next] >= 0 || blocked[next] || !(world.flags[next] & 1)) continue;
			if (
				dx &&
				dz &&
				(!(world.flags[z * N + px] & 1) ||
					!(world.flags[pz * N + x] & 1) ||
					blocked[z * N + px] ||
					blocked[pz * N + x])
			)
				continue;
			if (Math.abs(floorAt(next) - floorAt(q)) > Math.hypot(dx, dz) * 0.9) continue;
			previous[next] = q;
			queue[end++] = next;
		}
	}
	if (goal < 0) throw new Error(`walk-path ${start.x},${start.z} -> ${target.x},${target.z}`);
	const path: { x: number; z: number }[] = [];
	for (let q = goal; q !== source; q = previous[q]) path.push({ x: q % N, z: Math.floor(q / N) });
	path.reverse();
	return path;
}
export async function walk(page: Page, target: Point, radius = 0.8, allowVictory = false) {
	const start = await page.evaluate(() => globalThis.__gameDebug?.());
	if (!start) throw new Error('debug-not-ready');
	const path = walkingPath(start, target, Math.max(radius, 0.72));
	await drive(page, path, Math.max(12000, path.length * 450), false, allowVictory);
}
export async function drive(
	page: Page,
	path: { x: number; z: number }[],
	timeout = 15000,
	jump = false,
	allowVictory = false
) {
	await page.evaluate(
		async ({ path, timeout, jump, allowVictory }) => {
			const down = new Set<string>();
			const key = (code: string, value: boolean) => {
				if (down.has(code) === value) return;
				window.dispatchEvent(new KeyboardEvent(value ? 'keydown' : 'keyup', { code, bubbles: true }));
				if (value) down.add(code);
				else down.delete(code);
			};
			try {
				await new Promise<void>((resolve, reject) => {
					let waypoint = 0;
					const started = performance.now();
					const startState = globalThis.__gameDebug?.();
					const startedSim = startState?.simulationTime;
					let lastProgress = started,
						lastX = startState?.x ?? 0,
						lastZ = startState?.z ?? 0;
					const initialY = startState?.y ?? 0;
					if (jump) key('Space', true);
					const step = () => {
						const state = globalThis.__gameDebug?.();
						if (allowVictory && state?.storyFinished) {
							resolve();
							return;
						}
						if (!state) {
							reject(new Error('no-game'));
							return;
						}
						if (Math.hypot(state.x - lastX, state.z - lastZ) > 0.03) {
							lastProgress = performance.now();
							lastX = state.x;
							lastZ = state.z;
						}
						const simElapsed =
							startedSim !== undefined && state.simulationTime !== undefined
								? (state.simulationTime - startedSim) * 1000
								: performance.now() - started;
						if (
							simElapsed > timeout ||
							performance.now() - lastProgress > Math.max(15000, timeout) ||
							performance.now() - started > Math.max(45000, timeout * 8)
						) {
							reject(
								new Error(
									`navigation-timeout ${state.x.toFixed(2)},${state.y.toFixed(2)},${state.z.toFixed(2)} -> ${JSON.stringify(path[waypoint])}`
								)
							);
							return;
						}
						while (
							waypoint < path.length &&
							Math.hypot(path[waypoint].x - state.x, path[waypoint].z - state.z) <
								(waypoint === path.length - 1 ? 0.22 : 0.55)
						)
							waypoint++;
						if (waypoint === path.length) {
							resolve();
							return;
						}
						const p = path[waypoint],
							dx = p.x - state.x,
							dz = p.z - state.z,
							yaw = state.cameraYaw;
						let x = dx * Math.cos(yaw) - dz * Math.sin(yaw),
							y = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
						if (Math.abs(x) < Math.abs(y) * 0.414) x = 0;
						else if (Math.abs(y) < Math.abs(x) * 0.414) y = 0;
						key('KeyD', x > 0.05);
						key('KeyA', x < -0.05);
						key('KeyW', y > 0.05);
						key('KeyS', y < -0.05);
						if (jump && (!state.grounded || state.y > initialY + 0.15)) key('Space', false);
						requestAnimationFrame(step);
					};
					requestAnimationFrame(step);
				});
			} finally {
				for (const code of down) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
			}
		},
		{ path, timeout, jump, allowVictory }
	);
}

/** Mission 0: actual walking approach and fixed-tick ladder traversal. */
export async function climbTreehouse(page: Page) {
	const ladder = storyBuild.level.act1?.treehouse.ladder;
	if (!ladder) throw Error('treehouse');
	await walk(page, { ...ladder.bottom, z: ladder.bottom.z + 1 }, 0.5);
	await drive(page, [ladder.bottom], 5000);
	await page.keyboard.down('w');
	try {
		await page.waitForFunction(() => globalThis.__gameDebug?.().park?.house === true, null, {
			timeout: 10000
		});
	} finally {
		await page.keyboard.up('w');
	}
	await page.getByRole('button', { name: 'Continuar', exact: true }).press('Enter');
	await page.getByRole('button', { name: 'Voltar à base', exact: true }).click();
	await page.waitForFunction((p) => {
		const s = globalThis.__gameDebug?.();
		return s && Math.hypot(s.x - p.x, s.z - p.z) < 1;
	}, storyBuild.level.start.spawn);
}
