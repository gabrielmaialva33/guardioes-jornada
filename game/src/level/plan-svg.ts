/**
 * Top-down debug plan of the BUILT story map, as SVG text: height shading,
 * river, flags, the walk from the spawn, placements, obbies, missions and
 * triggers. Compare it with game/docs/level-plan.svg, which is drawn from the
 * control points before building. Pure string work, no DOM.
 */
import { FLAG, GRID, TREE_SPECIES } from '../survival/types.ts';
import type { StoryBuild } from './types.ts';

const P = 5;
const M = 30;

const px = (v: number) => (M + v * P).toFixed(1);
const f1 = (v: number) => v.toFixed(1);

function shade(h: number, flags: number, steps: number): string {
	if (flags & FLAG.river) return '#3e9ccf';
	// Height 0 → 18 from dark to light; forest greener, cleared tan, plateau grey.
	const t = Math.min(1, Math.max(0, (h + 1) / 19));
	const l = 30 + t * 55;
	let hue = 105;
	let sat = 30;
	if (flags & FLAG.forest) {
		hue = 135;
		sat = 38;
	}
	if (flags & FLAG.cleared) {
		hue = 42;
		sat = 45;
	}
	if (flags & FLAG.base) {
		hue = 55;
		sat = 25;
	}
	if ((flags & FLAG.walkable) !== 0 && steps < 0) {
		hue = 0;
		sat = 30;
	}
	return `hsl(${hue} ${sat}% ${l.toFixed(0)}%)`;
}

export function planSvg({ world, level }: StoryBuild): string {
	const n = GRID;
	const size = (n - 1) * P + 2 * M;
	const out: string[] = [];
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size + 280}" height="${size}" font-family="sans-serif">`,
		`<rect width="${size + 280}" height="${size}" fill="#f4f6ee"/>`
	);
	for (let j = 0; j < n - 1; j++)
		for (let i = 0; i < n - 1; i++) {
			const q = j * n + i;
			out.push(
				`<rect x="${px(i)}" y="${px(j)}" width="${P}" height="${P}" fill="${shade(world.heights[q], world.flags[q], world.baseSteps[q])}"/>`
			);
		}
	// Contours every 3 u: mark cells whose 3 u band differs from the east or south neighbour.
	for (let j = 0; j < n - 1; j++)
		for (let i = 0; i < n - 1; i++) {
			const band = (q: number) => (world.heights[q] / 3) | 0;
			const q = j * n + i;
			if (band(q) !== band(q + 1) || band(q) !== band(q + n))
				out.push(
					`<rect x="${px(i)}" y="${px(j)}" width="${P}" height="${P}" fill="#1e2a22" opacity="0.18"/>`
				);
		}
	for (const t of level.trails)
		out.push(
			`<polyline points="${t.points.map(([x, z]) => `${px(x)},${px(z)}`).join(' ')}" fill="none" stroke="#8f6e52" stroke-width="${t.halfWidth * 2 * P}" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>`
		);
	for (const c of world.crossings)
		if (c.kind !== 'stepping-stones')
			out.push(
				`<line x1="${px(c.from.x)}" y1="${px(c.from.z)}" x2="${px(c.to.x)}" y2="${px(c.to.z)}" stroke="#5e4330" stroke-width="${c.halfWidth * 2 * P}"/>`
			);
	const trees = world.trees;
	for (let k = 0; k < trees.count; k++) {
		const species = TREE_SPECIES[trees.kind[k]];
		const fill = species === 'ipe-amarelo' ? '#f2c94c' : species === 'araucaria' ? '#2d6a4f' : '#1e4d36';
		out.push(
			`<circle cx="${px(trees.x[k])}" cy="${px(trees.z[k])}" r="${f1(1.3 * P * trees.scale[k] * (species === 'jequitiba' ? 1.4 : 1))}" fill="${fill}" opacity="0.85"/>`
		);
	}
	const rocks = world.rocks;
	for (let k = 0; k < rocks.count; k++)
		out.push(
			`<circle cx="${px(rocks.x[k])}" cy="${px(rocks.z[k])}" r="${f1(Math.max(1.5, 3.5 * rocks.scale[k] * (rocks.kind[k] === 1 ? 0.5 : 1)))}" fill="#6f7d74" stroke="#2c3530"/>`
		);
	const deco = world.decorations;
	for (let k = 0; k < deco.count; k++)
		out.push(`<circle cx="${px(deco.x[k])}" cy="${px(deco.z[k])}" r="1.2" fill="#74c69d"/>`);
	for (const o of level.obbies)
		for (const p of o.pieces) {
			if (p.piece === 'stone')
				out.push(
					`<circle cx="${px(p.x)}" cy="${px(p.z)}" r="${f1(p.radius * P)}" fill="#b3bdb5" stroke="#4f5c55"/>`
				);
			else {
				// A square turned to the heading: local x = (yawC, −yawS), local z = (yawS, yawC).
				const corners = [
					[-1, -1],
					[1, -1],
					[1, 1],
					[-1, 1]
				].map(([a, b]) => {
					const x = p.x + p.radius * (a * p.yawC + b * p.yawS);
					const z = p.z + p.radius * (-a * p.yawS + b * p.yawC);
					return `${px(x)},${px(z)}`;
				});
				out.push(`<polygon points="${corners.join(' ')}" fill="#a8805c" stroke="#5e4330"/>`);
				out.push(
					`<text x="${px(p.x)}" y="${px(p.z)}" font-size="9" text-anchor="middle" dy="3" fill="#fff">${f1(p.y)}</text>`
				);
			}
		}
	for (const o of level.obbies)
		for (const p of [o.takeoff, o.landing])
			out.push(`<circle cx="${px(p.x)}" cy="${px(p.z)}" r="3" fill="#ff9fb7" stroke="#5a2e2e"/>`);
	for (const t of level.triggers) {
		if (t.kind === 'planting' || t.kind === 'trap')
			out.push(
				`<circle cx="${px(t.x)}" cy="${px(t.z)}" r="${f1(Math.max(4, t.radius * P))}" fill="#5fa36a" stroke="#1e4d36"/>`
			);
		if (t.kind === 'trap')
			out.push(
				`<path d="M${px(t.x - 1.2)},${px(t.z - 1.2)} L${px(t.x + 1.2)},${px(t.z + 1.2)} M${px(t.x + 1.2)},${px(t.z - 1.2)} L${px(t.x - 1.2)},${px(t.z + 1.2)}" stroke="#5a2e2e" stroke-width="3"/>`
			);
		if (t.kind === 'logger' || t.kind === 'onca' || t.kind === 'observation' || t.kind === 'mirante')
			out.push(
				`<circle cx="${px(t.x)}" cy="${px(t.z)}" r="${f1(t.radius * P)}" fill="none" stroke="#5a2e2e" stroke-dasharray="6 4"/>`
			);
	}
	for (const c of level.collectibles) {
		const fill = c.kind === 'gold-leaf' ? '#ffd166' : c.kind === 'trash' ? '#e9f4e4' : '#4b2a4f';
		out.push(
			`<rect x="${f1(M + c.x * P - 3.5)}" y="${f1(M + c.z * P - 3.5)}" width="7" height="7" fill="${fill}" stroke="#1e2a22"/>`
		);
	}
	for (const c of [level.start, ...level.checkpoints])
		out.push(
			`<path d="M${px(c.spawn.x)},${px(c.spawn.z)} l0,-16 l10,4 l-10,4" fill="#73cbf0" stroke="#1e2a22" stroke-width="1.5"/>`
		);
	for (const h of level.handholds)
		out.push(`<circle cx="${px(h.x)}" cy="${px(h.z)}" r="1.5" fill="#ff9fb7"/>`);
	for (const a of world.animals)
		out.push(
			`<text x="${px(a.x)}" y="${px(a.z)}" font-size="11" fill="#412805" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="3">${a.species}</text>`
		);
	for (const l of level.landmarks)
		if (l.label !== '')
			out.push(
				`<text x="${px(l.x)}" y="${px(l.z)}" dy="-8" font-size="11" font-weight="600" fill="#1e2a22" text-anchor="middle" paint-order="stroke" stroke="#f4f4ef" stroke-width="3">${l.label}</text>`
			);
	for (const m of level.missions)
		out.push(
			`<circle cx="${px(m.target.x)}" cy="${px(m.target.z)}" r="11" fill="#ffd166" stroke="#5e4330" stroke-width="2"/>`,
			`<text x="${px(m.target.x)}" y="${px(m.target.z)}" dy="5" font-size="14" font-weight="800" text-anchor="middle" fill="#412805">${m.id}</text>`
		);
	for (let k = 0; k <= 4; k++) {
		const a = px(k * 40);
		out.push(
			`<line x1="${a}" y1="${px(0)}" x2="${a}" y2="${px(160)}" stroke="#1e2a22" stroke-opacity="0.25"/>`,
			`<line x1="${px(0)}" y1="${a}" x2="${px(160)}" y2="${a}" stroke="#1e2a22" stroke-opacity="0.25"/>`,
			`<text x="${a}" y="${M - 8}" font-size="11" text-anchor="middle">${k * 40}</text>`,
			`<text x="${M - 6}" y="${a}" font-size="11" text-anchor="end">${k * 40}</text>`
		);
	}
	const lx = size + 10;
	const lines = [
		'Reserva da Iara (construído)',
		`checksum ${(world.checksum >>> 0).toString(16)} / ${(level.checksum >>> 0).toString(16)}`,
		`árvores ${world.trees.count}, rochas ${world.rocks.count}, cobertura ${world.decorations.count}`,
		`problemas: ${world.problems.length === 0 ? 'nenhum' : world.problems.join('; ')}`,
		'',
		'vermelho: andável sem acesso',
		'rosa: decolagem/pouso dos obbies',
		'faixas escuras: curvas de 3 u',
		'tracejado: gatilhos (madeireiro 12, onça 15)'
	];
	lines.forEach((t, k) => {
		out.push(
			`<text x="${lx}" y="${M + 14 + k * 18}" font-size="${k === 0 ? 15 : 11}" fill="#1e2a22">${t}</text>`
		);
	});
	out.push('</svg>');
	return out.join('\n');
}
