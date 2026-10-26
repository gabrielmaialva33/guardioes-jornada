/**
 * Shared pieces of the golden-frame tools: the pose list, the output folders
 * (outside the repo: references are copyrighted and frames are large), small
 * argument parsing, ImageMagick calls and the automatic image metrics of
 * a-visual.md §6. No npm dependency beyond Playwright; images go through the
 * system `magick`.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Tier = 'low' | 'medium' | 'high';
export type Mode = 'gpu' | 'swiftshader';
export type PoseStatus = 'exists' | 'approx' | 'needs-runtime';

export interface Pose {
	id: string;
	name: string;
	covers: string;
	status: PoseStatus;
	runtimePose: string | null;
	timeOfDay: 'day' | 'night';
	camera: { position: number[]; target: number[]; fov: number } | null;
	avatar: { x: number; z: number; yaw: number } | null;
	references: string[];
	notes: string;
}

export interface PoseFile {
	canvas: { width: number; height: number };
	settleMs: number;
	clockSeconds: number;
	seed: number;
	tiers: Tier[];
	poses: Pose[];
}

/** Baselines, sets, diffs and sheets: never in the repo. */
export const GOLDEN_ROOT = process.env.GUARDIOES_GOLDEN_DIR ?? join(homedir(), '.cache/guardioes-golden');
export const REFERENCES = join(
	homedir(),
	'.cache/agents/2026-10-25-trilha-secreta/pesquisa-qualidade/referencias'
);
export const BASELINE = 'baseline';

export function loadPoses(): PoseFile {
	return JSON.parse(readFileSync(new URL('./poses.json', import.meta.url), 'utf8')) as PoseFile;
}

/** `<root>/<set>/<tier>-<mode>/`: one folder per capture run and configuration. */
export const runDir = (set: string, tier: Tier, mode: Mode) => join(GOLDEN_ROOT, set, `${tier}-${mode}`);

/** Creates the output root with a .keep, so the scratch GC never empties it. */
export async function ensureRoot() {
	await mkdir(GOLDEN_ROOT, { recursive: true });
	const keep = join(GOLDEN_ROOT, '.keep');
	if (!existsSync(keep)) await writeFile(keep, 'golden frames: baselines and outputs, kept on purpose\n');
}

/** `--name value` and `--flag` pairs; repeated names keep the last value. */
export function parseArgs(argv: string[]): Map<string, string> {
	const args = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const key = argv[i];
		if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith('--')) args.set(key.slice(2), 'true');
		else {
			args.set(key.slice(2), next);
			i++;
		}
	}
	return args;
}

export const list = (value: string | undefined, fallback: string[]) =>
	value
		? value
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		: fallback;

// --- ImageMagick -----------------------------------------------------------------

export async function magick(args: string[]): Promise<{ stdout: string; stderr: string }> {
	return run('magick', args, { maxBuffer: 1 << 26 });
}

/** Decoded 8-bit RGBA pixels of an image file. */
export async function readRgba(file: string): Promise<{ width: number; height: number; data: Uint8Array }> {
	const { stdout } = await run('magick', ['identify', '-format', '%w %h', `${file}[0]`]);
	const [width, height] = stdout.trim().split(' ').map(Number);
	const raw = await new Promise<Buffer>((resolve, reject) => {
		execFile(
			'magick',
			[`${file}[0]`, '-alpha', 'on', '-depth', '8', 'rgba:-'],
			{ encoding: 'buffer', maxBuffer: width * height * 4 + 1024 },
			(error, out) => (error ? reject(error) : resolve(out))
		);
	});
	if (raw.length !== width * height * 4) throw new Error(`unexpected raw size for ${file}`);
	return { width, height, data: new Uint8Array(raw.buffer, raw.byteOffset, raw.length) };
}

/**
 * `magick compare -metric AE`: writes the red-on-grey diff image and returns
 * the AE figure ImageMagick prints (it exits 1 when the images differ, which
 * is not an error). Only informative: on RGB frames ImageMagick 7.1.2 reports
 * fewer than the changed pixels (a 61×41 red patch, 2501 px, reads as 1321.7),
 * so the gate counts pixels itself with `changedPixels`.
 */
export async function compareImage(
	baseline: string,
	current: string,
	diff: string,
	fuzz: string
): Promise<number> {
	const args = ['compare', '-metric', 'AE', '-fuzz', fuzz, baseline, current, diff];
	let text: string;
	try {
		text = (await magick(args)).stderr;
	} catch (error) {
		const failed = error as { code?: number; stderr?: string };
		if (failed.code !== 1 || failed.stderr === undefined) throw error;
		text = failed.stderr;
	}
	const count = Number.parseFloat(text.trim().split(/\s+/)[0]);
	if (!Number.isFinite(count)) throw new Error(`could not read the AE metric: ${text}`);
	return count;
}

/**
 * Pixels where any of R, G, B differs by more than `fuzz` (a fraction of 255,
 * e.g. 0.02). Alpha is ignored: the frames are opaque screenshots.
 */
export async function changedPixels(baseline: string, current: string, fuzz: number): Promise<number> {
	const [before, after] = await Promise.all([readRgba(baseline), readRgba(current)]);
	if (before.width !== after.width || before.height !== after.height)
		return Math.max(before.width * before.height, after.width * after.height);
	const limit = fuzz * 255;
	let changed = 0;
	for (let i = 0; i < before.data.length; i += 4) {
		if (
			Math.abs(before.data[i] - after.data[i]) > limit ||
			Math.abs(before.data[i + 1] - after.data[i + 1]) > limit ||
			Math.abs(before.data[i + 2] - after.data[i + 2]) > limit
		)
			changed++;
	}
	return changed;
}

// --- Metrics -----------------------------------------------------------------------

export interface FrameMetrics {
	/** % of pixels with HSL lightness < 12% (ART.md: nothing darker than #1e4d36 except the night sky). */
	darkPct: number;
	/** Mean HSL saturation, 0–1, over the frame and its thirds (top, middle, bottom). */
	meanSaturation: number;
	saturationByThird: [number, number, number];
	/** % of pixels where nothing was drawn (the CSS sky shows through). */
	skyPct: number;
	/** Standard deviation of the luma of those sky pixels, 0–1 (a flat sky is ≈ 0). */
	skyStd: number;
	/** % of the lower half with nothing drawn: holes or the world's edge (the gate of P4). */
	voidLowerPct: number;
}

/** HSL lightness and saturation of an 8-bit RGB pixel. */
function hsl(r: number, g: number, b: number): { l: number; s: number } {
	const max = Math.max(r, g, b) / 255;
	const min = Math.min(r, g, b) / 255;
	const l = (max + min) / 2;
	const d = max - min;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	return { l, s };
}

/**
 * Metrics of a frame. `mask` is the same frame captured with the page
 * background set to pure magenta: its magenta pixels are the ones the canvas
 * left transparent (sky or void). Without a mask the sky metrics are NaN.
 */
export function frameMetrics(
	frame: { width: number; height: number; data: Uint8Array },
	mask?: { width: number; height: number; data: Uint8Array }
): FrameMetrics {
	const { width, height, data } = frame;
	if (mask && (mask.width !== width || mask.height !== height))
		throw new Error('mask size differs from the frame');
	const total = width * height;
	let dark = 0;
	let saturation = 0;
	const thirds: [number, number, number] = [0, 0, 0];
	const thirdCounts: [number, number, number] = [0, 0, 0];
	let sky = 0;
	let skySum = 0;
	let skySquares = 0;
	let voidLower = 0;
	for (let y = 0; y < height; y++) {
		const third = Math.min(2, Math.floor((y * 3) / height)) as 0 | 1 | 2;
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const r = data[i];
			const g = data[i + 1];
			const b = data[i + 2];
			const { l, s } = hsl(r, g, b);
			if (l < 0.12) dark++;
			saturation += s;
			thirds[third] += s;
			thirdCounts[third]++;
			if (mask) {
				const m = mask.data;
				const isSky = m[i] > 235 && m[i + 1] < 20 && m[i + 2] > 235;
				if (isSky) {
					sky++;
					const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
					skySum += luma;
					skySquares += luma * luma;
					if (y >= height / 2) voidLower++;
				}
			}
		}
	}
	const skyMean = sky > 0 ? skySum / sky : Number.NaN;
	const round = (value: number, digits = 4) => Number(value.toFixed(digits));
	return {
		darkPct: round((dark / total) * 100, 3),
		meanSaturation: round(saturation / total),
		saturationByThird: thirds.map((sum, k) => round(sum / Math.max(1, thirdCounts[k]))) as [
			number,
			number,
			number
		],
		skyPct: mask ? round((sky / total) * 100, 3) : Number.NaN,
		skyStd:
			mask && sky > 0 ? round(Math.sqrt(Math.max(0, skySquares / sky - skyMean * skyMean))) : Number.NaN,
		voidLowerPct: mask ? round((voidLower / (total - width * Math.ceil(height / 2))) * 100, 3) : Number.NaN
	};
}
