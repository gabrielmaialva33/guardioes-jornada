/**
 * Review sheets: per pose and tier/mode, one row "before | after | reference
 * 1 | reference 2" (`magick montage`), plus one page per configuration that
 * stacks every pose. Poses the runtime cannot show yet get a placeholder tile,
 * so the owner still sees their targets.
 *
 * Usage (from the repo root):
 *   node game/golden/sheet.ts --after after [--before baseline] [--configs low-gpu,high-gpu]
 *
 * References come from pesquisa-qualidade/referencias/ (poses.json); sheets
 * are written to `<root>/sheets/<after>/` and never into the repo.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
	BASELINE,
	ensureRoot,
	GOLDEN_ROOT,
	list,
	loadPoses,
	magick,
	type Pose,
	parseArgs,
	REFERENCES
} from './lib.ts';

const args = parseArgs(process.argv.slice(2));
const after = args.get('after') ?? 'after';
const before = args.get('before') ?? BASELINE;
const config = loadPoses();
await ensureRoot();

const afterDir = join(GOLDEN_ROOT, after);
if (!existsSync(afterDir)) throw new Error(`no capture set ${after} in ${GOLDEN_ROOT}`);
const configs = list(
	args.get('configs'),
	(await readdir(afterDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
).sort();
const out = join(GOLDEN_ROOT, 'sheets', after);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const { width, height } = config.canvas;
const BACKGROUND = '#12201a';
const INK = '#e8f2ea';
const FONT = 'Adwaita-Sans';

/** A grey tile with a message, for a frame that does not exist (yet). */
async function placeholder(file: string, text: string) {
	await magick([
		'-size',
		`${width}x${height}`,
		'xc:#26332b',
		'-font',
		FONT,
		'-gravity',
		'center',
		'-fill',
		'#cfd8d3',
		'-pointsize',
		'26',
		'-annotate',
		'0',
		text,
		file
	]);
	return file;
}

async function sheet(pose: Pose, configName: string): Promise<string> {
	const scratch = join(out, '.tiles');
	await mkdir(scratch, { recursive: true });
	const frame = async (set: string, label: string) => {
		const file = join(GOLDEN_ROOT, set, configName, `${pose.id}.png`);
		if (existsSync(file)) return { file, label };
		const why = pose.status === 'needs-runtime' ? 'precisa do gancho ?golden=1' : `sem captura em ${set}`;
		return { file: await placeholder(join(scratch, `${pose.id}-${set}-${configName}.png`), why), label };
	};
	const tiles = [await frame(before, `antes (${before})`), await frame(after, `depois (${after})`)];
	for (const reference of pose.references.slice(0, 2)) {
		const file = join(REFERENCES, reference);
		tiles.push(
			existsSync(file)
				? { file, label: `ref: ${reference.replace(/\.(jpg|png)$/, '')}` }
				: {
						file: await placeholder(join(scratch, `missing-${reference}.png`), 'referência ausente'),
						label: reference
					}
		);
	}
	const status = pose.status === 'exists' ? '' : ` [${pose.status}]`;
	const target = join(out, `${pose.id}-${configName}.png`);
	await magick([
		'montage',
		'-font',
		FONT,
		'-background',
		BACKGROUND,
		'-fill',
		INK,
		'-pointsize',
		'15',
		'-title',
		`${pose.id} · ${pose.name} · ${configName}${status} — ${pose.covers}`,
		...tiles.flatMap((t) => ['-label', t.label, t.file]),
		'-tile',
		`${tiles.length}x1`,
		'-geometry',
		`${Math.round(width * 0.6)}x${Math.round(height * 0.6)}+6+6`,
		target
	]);
	return target;
}

for (const configName of configs) {
	const rows: string[] = [];
	for (const pose of config.poses) rows.push(await sheet(pose, configName));
	const page = join(out, `all-${configName}.png`);
	await magick([...rows, '-background', BACKGROUND, '-append', page]);
	console.info(`${configName}: ${rows.length} sheets, page ${page}`);
}
await rm(join(out, '.tiles'), { recursive: true, force: true });
