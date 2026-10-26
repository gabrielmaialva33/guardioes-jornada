/**
 * Writes src/world-gen/park-edges.ts: the zones' heights along the park's outer boundary
 * (world-gen/park.ts PARK_BOUNDARY), from level/zones buildParkFresh(). Exact float32 values.
 * park-stitch.test.ts fails when a zone changes; regenerate, then let Biome reflow the table:
 *
 *   node game/scripts/world-gen/park-edges-table.ts
 *   ./node_modules/.bin/biome format --write game/src/world-gen/park-edges.ts
 *
 * Environment:
 *   ROOT  repository root to read the zones from (default: this checkout).
 *   OUT   file to write (default: <ROOT>/game/src/world-gen/park-edges.ts).
 *
 * See game/docs/world-gen.md.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
const source = (path: string) => pathToFileURL(join(ROOT, 'game/src', path)).href;

const { buildParkFresh } = (await import(
	source('level/zones/park.ts')
)) as typeof import('../../src/level/zones/park.ts');
const { zoneHeight } = (await import(
	source('level/zones/zone.ts')
)) as typeof import('../../src/level/zones/zone.ts');
const { PARK_BOUNDARY } = (await import(
	source('world-gen/park.ts')
)) as typeof import('../../src/world-gen/park.ts');

const park = buildParkFresh();

/** The shortest decimal that reads back as the same float32. */
const lit = (v: number): string => {
	for (let p = 1; p <= 9; p++) {
		const s = Number(v.toPrecision(p));
		if (Math.fround(s) === v) return String(s);
	}
	return String(v);
};

const rows: string[] = [];
for (const e of PARK_BOUNDARY) {
	const zone = park.get(e.zone);
	if (!zone) throw new Error(`zone ${e.zone} is missing from the park`);
	const vals: string[] = [];
	for (let k = e.from; k <= e.to; k++) {
		const [x, z] = e.side === 'west' || e.side === 'east' ? [e.at, k] : [k, e.at];
		vals.push(lit(zoneHeight(zone, x, z)));
	}
	const lines: string[] = [];
	let line = '\t\t';
	vals.forEach((v, k) => {
		const piece = v + (k < vals.length - 1 ? ',' : '');
		if (line.length + piece.length + 1 > 108) {
			lines.push(line.trimEnd());
			line = '\t\t';
		}
		line += `${piece} `;
	});
	lines.push(line.trimEnd());
	rows.push(
		`\t// ${e.zone} ${e.side} at ${e.at}, ${e.from}..${e.to}\n\tFloat32Array.of(\n${lines.join('\n')}\n\t)`
	);
}

const checksums = [...park].map(([id, b]) => `${id} 0x${b.world.checksum.toString(16)}`).join(', ');
const src = `/**
 * The zones' heights along the park's outer boundary (park.ts PARK_BOUNDARY,
 * same order), one per unit from each edge's \`from\` to its \`to\`: what the
 * generated world meets with no step (park-stitch.ts). Generated from
 * level/zones buildParkFresh() by game/scripts/world-gen/park-edges-table.ts
 * (game/docs/world-gen.md); park-stitch.test.ts fails when a zone changes, and says so.
 * Built from: ${checksums}.
 */
export const PARK_EDGE_HEIGHTS: readonly Float32Array[] = [
${rows.join(',\n')}
];
`;

const out = process.env.OUT ?? join(ROOT, 'game/src/world-gen/park-edges.ts');
writeFileSync(out, src);
console.log('wrote', out, src.length, 'bytes');
