/**
 * Regression check of a capture set against the last approved baseline:
 * per pose and tier/mode, the share of pixels that differ (any RGB channel
 * off by more than the fuzz), the diff image and AE figure of ImageMagick
 * `compare -metric AE`, and the change of
 * the automatic metrics (dark pixels, saturation, sky σ, void, draws,
 * triangles, programs). A pose fails above `--threshold` % (default 0.5).
 *
 * Usage (from the repo root):
 *   node game/golden/compare.ts --set after [--baseline baseline] [--threshold 0.5] [--fuzz 2%]
 *   node game/golden/compare.ts --approve after     (the set becomes the baseline; the old one moves to history/)
 *
 * Writes `<root>/reports/<set>-vs-<baseline>.{json,md}` and diffs in
 * `<root>/diffs/<set>/<tier>-<mode>/<pose>.png`. Exits 1 when a pose fails.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	BASELINE,
	changedPixels,
	compareImage,
	ensureRoot,
	type FrameMetrics,
	GOLDEN_ROOT,
	parseArgs
} from './lib.ts';

interface CaptureRecord {
	pose: string;
	name: string;
	tier: string;
	tierPicked: string;
	canvas: { width: number; height: number };
	counters: { drawCalls: number; triangles: number; programs: number };
	metrics: FrameMetrics;
	errors: string[];
}

const args = parseArgs(process.argv.slice(2));
await ensureRoot();

const approve = args.get('approve');
if (approve) {
	const source = join(GOLDEN_ROOT, approve);
	if (!existsSync(source)) throw new Error(`no capture set ${approve} in ${GOLDEN_ROOT}`);
	const target = join(GOLDEN_ROOT, BASELINE);
	if (existsSync(target)) {
		await mkdir(join(GOLDEN_ROOT, 'history'), { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		await rename(target, join(GOLDEN_ROOT, 'history', `${BASELINE}-${stamp}`));
	}
	await cp(source, target, { recursive: true });
	await writeFile(
		join(target, 'approved.json'),
		`${JSON.stringify({ from: approve, at: new Date().toISOString() }, null, '\t')}\n`
	);
	console.info(`approved ${approve} as the baseline (${target})`);
	process.exit(0);
}

const set = args.get('set') ?? 'after';
const baseline = args.get('baseline') ?? BASELINE;
const threshold = Number(args.get('threshold') ?? '0.5');
const fuzz = args.get('fuzz') ?? '2%';
const fuzzFraction = Number.parseFloat(fuzz) / (fuzz.endsWith('%') ? 100 : 255);
if (!Number.isFinite(fuzzFraction)) throw new Error(`bad --fuzz ${fuzz} (use 2% or 5)`);
const setDir = join(GOLDEN_ROOT, set);
const baseDir = join(GOLDEN_ROOT, baseline);
if (!existsSync(setDir))
	throw new Error(`no capture set ${set} in ${GOLDEN_ROOT} (run capture.ts --set ${set})`);
if (!existsSync(baseDir))
	throw new Error(`no baseline ${baseline}: approve a set first (compare.ts --approve <set>)`);

const readRecord = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as CaptureRecord;
const delta = (after: number, before: number, digits = 3) =>
	Number.isFinite(after) && Number.isFinite(before) ? Number((after - before).toFixed(digits)) : null;

const rows: Record<string, unknown>[] = [];
for (const config of (await readdir(setDir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
	const files = (await readdir(join(setDir, config.name))).filter((f) => /^[A-Z]\d+\.json$/.test(f));
	for (const file of files.sort()) {
		const pose = file.replace('.json', '');
		const current = await readRecord(join(setDir, config.name, file));
		const beforeJson = join(baseDir, config.name, file);
		if (!existsSync(beforeJson)) {
			rows.push({ config: config.name, pose, status: 'new', note: 'no baseline frame for this pose' });
			continue;
		}
		const before = await readRecord(beforeJson);
		const diffDir = join(GOLDEN_ROOT, 'diffs', set, config.name);
		await mkdir(diffDir, { recursive: true });
		const pixels = current.canvas.width * current.canvas.height;
		const baseFrame = join(baseDir, config.name, `${pose}.png`);
		const currentFrame = join(setDir, config.name, `${pose}.png`);
		const magickAE = await compareImage(baseFrame, currentFrame, join(diffDir, `${pose}.png`), fuzz);
		const different = await changedPixels(baseFrame, currentFrame, fuzzFraction);
		const changedPct = Number(((different / pixels) * 100).toFixed(3));
		rows.push({
			config: config.name,
			pose,
			name: current.name,
			status: changedPct <= threshold ? 'pass' : 'changed',
			changedPct,
			changedPixels: different,
			magickAE,
			tier: current.tierPicked,
			darkPct: current.metrics.darkPct,
			darkDelta: delta(current.metrics.darkPct, before.metrics.darkPct),
			saturation: current.metrics.meanSaturation,
			saturationDelta: delta(current.metrics.meanSaturation, before.metrics.meanSaturation, 4),
			skyStd: current.metrics.skyStd,
			skyStdDelta: delta(current.metrics.skyStd, before.metrics.skyStd, 4),
			voidLowerPct: current.metrics.voidLowerPct,
			voidDelta: delta(current.metrics.voidLowerPct, before.metrics.voidLowerPct),
			draws: current.counters.drawCalls,
			drawsDelta: current.counters.drawCalls - before.counters.drawCalls,
			triangles: current.counters.triangles,
			trianglesDelta: current.counters.triangles - before.counters.triangles,
			programs: current.counters.programs,
			errors: current.errors.length
		});
	}
}

const reports = join(GOLDEN_ROOT, 'reports');
await mkdir(reports, { recursive: true });
const name = `${set}-vs-${baseline}`;
await writeFile(
	join(reports, `${name}.json`),
	`${JSON.stringify({ set, baseline, threshold, fuzz, rows }, null, '\t')}\n`
);
const signed = (value: unknown) =>
	typeof value === 'number' && value > 0 ? `+${value}` : String(value ?? '—');
const lines = [
	`# Golden frames: ${set} vs ${baseline}`,
	'',
	`Threshold ${threshold}% of the pixels (fuzz ${fuzz}). Metrics: dark = % of pixels with HSL lightness < 12%; sat = mean HSL saturation; sky σ = luma std of the uncovered sky; void↓ = % of the lower half with nothing drawn.`,
	'',
	'| Config | Pose | Status | Changed % | Dark % (Δ) | Sat (Δ) | Sky σ (Δ) | Void↓ % (Δ) | Draws (Δ) | Tri (Δ) | Programs |',
	'|---|---|---|---|---|---|---|---|---|---|---|',
	...rows.map((r) =>
		r.status === 'new'
			? `| ${r.config} | ${r.pose} | new | — | | | | | | | |`
			: `| ${r.config} | ${r.pose} ${r.name} | ${r.status} | ${r.changedPct} | ${r.darkPct} (${signed(r.darkDelta)}) | ${r.saturation} (${signed(r.saturationDelta)}) | ${r.skyStd} (${signed(r.skyStdDelta)}) | ${r.voidLowerPct} (${signed(r.voidDelta)}) | ${r.draws} (${signed(r.drawsDelta)}) | ${r.triangles} (${signed(r.trianglesDelta)}) | ${r.programs} |`
	)
];
await writeFile(join(reports, `${name}.md`), `${lines.join('\n')}\n`);
console.info(lines.slice(4).join('\n'));
const changed = rows.filter((r) => r.status === 'changed');
console.info(
	`\n${rows.length} frames, ${changed.length} above ${threshold}%. Report: ${join(reports, `${name}.md`)}`
);
if (changed.length > 0) process.exitCode = 1;
