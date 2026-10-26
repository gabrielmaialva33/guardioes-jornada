/**
 * Dev-server-only middleware of the LOCAL-ONLY Green Hell study mode
 * (game/src/study/). It serves the owner's extraction in the git-ignored
 * `tmp/greenhell-port/` at `/__estudo/greenhell/`, read-only, straight from
 * disk: nothing is copied, transformed or bundled. The assets belong to Creepy
 * Jar and have no licence for redistribution, so this plugin applies to `serve`
 * only and a build never sees them. Modelled on dev-pack.ts.
 *
 * `/__estudo/greenhell/catalog.json` is built on the fly (src/study/data.ts has
 * its shape) from conversion-manifest.json, the GLB headers, the audio and
 * terrain folders and the curation in `study-cache/curation.json`, so per-asset
 * data never lives in the repo. It is cached in memory and mirrored to
 * `study-cache/catalog.json`.
 */
import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { Plugin } from 'vite';
import type {
	StudyAssetAnimal,
	StudyAssetPlant,
	StudyCatalog,
	StudyFit,
	StudyImage,
	StudySoundGroup,
	StudyTerrainTexture
} from './src/study/data.ts';

export const STUDY_DEV_PREFIX = '/__estudo/greenhell/';

/** Only what the study runtime fetches: models, textures, sounds and the JSON inventories. */
const types: Record<string, string> = {
	'.glb': 'model/gltf-binary',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.webm': 'audio/webm',
	'.m4a': 'audio/mp4',
	'.ogg': 'audio/ogg'
};

// --- catalog.json -------------------------------------------------------------

interface ManifestJob {
	name: string;
	kind: string;
	web_glb?: string;
	bytes?: number;
	triangles?: number;
	animations?: string[];
}

interface Curation {
	animals?: Record<string, { name?: string; fit?: StudyFit; why?: string }>;
	plants?: { pattern: string; role: string; fit?: StudyFit; why?: string }[];
	sounds?: { id: string; role: string; pattern: string; fit: StudyFit; animal?: string; note: string }[];
}

const clipKey = (name: string) => {
	const parts = name.split('|');
	return parts.length >= 3 ? parts[parts.length - 2] : name;
};

/** Width and height of a PNG, JPEG or WebP from its first bytes. */
function imageSize(b: Buffer): [number, number] {
	if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
	if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
		const chunk = b.toString('latin1', 12, 16);
		if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
		if (chunk === 'VP8L') {
			const v = b.readUInt32LE(21);
			return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
		}
		if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
	}
	if (b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = b[i + 1];
			if (marker >= 0xc0 && marker <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
			i += 2 + b.readUInt16BE(i + 2);
		}
	}
	return [0, 0];
}

interface GlbInfo {
	meshes: number;
	joints: number;
	textures: StudyImage[];
	casters: number;
}

/** Reads only the glTF JSON chunk and each embedded image's header. */
async function glbInfo(file: string): Promise<GlbInfo> {
	const handle = await open(file, 'r');
	try {
		const head = Buffer.alloc(20);
		await handle.read(head, 0, 20, 0);
		const jsonLength = head.readUInt32LE(12);
		const jsonBytes = Buffer.alloc(jsonLength);
		await handle.read(jsonBytes, 0, jsonLength, 20);
		const json = JSON.parse(jsonBytes.toString('utf8')) as {
			meshes?: unknown[];
			skins?: { joints: unknown[] }[];
			materials?: { name?: string }[];
			images?: { name?: string; bufferView?: number }[];
			bufferViews?: { byteOffset?: number; byteLength: number }[];
		};
		const binary = 20 + jsonLength + 8;
		const textures: StudyImage[] = [];
		for (const image of json.images ?? []) {
			const view = image.bufferView === undefined ? undefined : json.bufferViews?.[image.bufferView];
			if (!view) continue;
			const bytes = Buffer.alloc(Math.min(view.byteLength, 65536));
			await handle.read(bytes, 0, bytes.length, binary + (view.byteOffset ?? 0));
			const [width, height] = imageSize(bytes);
			textures.push({ name: image.name ?? '', width, height });
		}
		return {
			meshes: json.meshes?.length ?? 0,
			joints: (json.skins ?? []).reduce((n, skin) => n + skin.joints.length, 0),
			textures,
			casters: (json.materials ?? []).filter((m) => m.name?.endsWith('_caster')).length
		};
	} finally {
		await handle.close();
	}
}

async function readJson<T>(file: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as T;
	} catch {
		return null;
	}
}

async function list(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).sort();
	} catch {
		return [];
	}
}

/** Build the served catalog from the files under `directory` (tmp/greenhell-port). */
export async function buildStudyCatalog(directory: string): Promise<StudyCatalog> {
	const manifest = await readJson<{ success?: ManifestJob[]; total_jobs?: number }>(
		join(directory, 'conversion-manifest.json')
	);
	const curation = (await readJson<Curation>(join(directory, 'study-cache/curation.json'))) ?? {};
	const animals: StudyAssetAnimal[] = [];
	const plants: StudyAssetPlant[] = [];
	for (const job of manifest?.success ?? []) {
		if (!job.web_glb || (job.kind !== 'animal' && job.kind !== 'scenery')) continue;
		let info: GlbInfo = { meshes: 0, joints: 0, textures: [], casters: 0 };
		let bytes = job.bytes ?? 0;
		try {
			info = await glbInfo(join(directory, job.web_glb));
			bytes = (await stat(join(directory, job.web_glb))).size;
		} catch {
			continue;
		}
		const base = { id: job.name, path: job.web_glb, bytes, tris: job.triangles ?? 0, meshes: info.meshes };
		if (job.kind === 'animal') {
			const curated = curation.animals?.[job.name] ?? {};
			animals.push({
				kind: 'animal',
				...base,
				...curated,
				joints: info.joints,
				textures: info.textures,
				clips: [...new Set((job.animations ?? []).map(clipKey))]
			});
		} else {
			const rule = curation.plants?.find((r) => new RegExp(r.pattern).test(job.name));
			plants.push({
				kind: 'plant',
				...base,
				casters: info.casters,
				textures: info.textures,
				...(rule ? { role: rule.role, fit: rule.fit, why: rule.why } : {})
			});
		}
	}

	// Sounds: one file per name (the extraction holds some twice), grouped by the curation's patterns.
	const byName = new Map<string, string>();
	for (const file of await list(join(directory, 'audio'))) {
		if (extname(file) !== '.webm') continue;
		const name = file.slice(0, -5).replace(/^\d+-/, '');
		if (!byName.has(name)) byName.set(name, `audio/${file}`);
	}
	const sounds: StudySoundGroup[] = [];
	const grouped = new Set<string>();
	for (const group of curation.sounds ?? []) {
		const pattern = new RegExp(group.pattern);
		const files: string[] = [];
		for (const [name, path] of byName)
			if (!grouped.has(name) && pattern.test(name)) {
				files.push(path);
				grouped.add(name);
			}
		const { pattern: _pattern, ...rest } = group;
		sounds.push({ kind: 'sound', ...rest, files });
	}
	const unsorted = [...byName].filter(([name]) => !grouped.has(name)).map(([, path]) => path);
	if (unsorted.length)
		sounds.push({
			kind: 'sound',
			id: 'unsorted',
			role: 'other',
			fit: 'maybe',
			note: 'not curated',
			files: unsorted
		});

	const terrain: StudyTerrainTexture[] = [];
	for (const file of await list(join(directory, 'terrain'))) {
		if (extname(file) !== '.png') continue;
		const path = `terrain/${file}`;
		const handle = await open(join(directory, path), 'r');
		const head = Buffer.alloc(32);
		try {
			await handle.read(head, 0, 32, 0);
		} finally {
			await handle.close();
		}
		const [width, height] = imageSize(head);
		const stem = file.slice(0, -4).replace(/^\d+-/, '');
		const role = /splatmap/i.test(stem)
			? 'splatmap'
			: /heightmap/i.test(stem)
				? 'heightmap'
				: /_N$/.test(stem)
					? 'normal'
					: 'albedo';
		terrain.push({
			kind: 'terrain',
			id: stem,
			path,
			bytes: (await stat(join(directory, path))).size,
			width,
			height,
			role,
			layer: role === 'albedo' || role === 'normal' ? stem.replace(/_N$/, '') : ''
		});
	}
	return {
		generatedAt: new Date().toISOString(),
		jobs: manifest?.total_jobs ?? manifest?.success?.length ?? 0,
		animals,
		plants,
		sounds,
		terrain
	};
}

/** Rebuilt when the manifest, the curation or the audio and terrain folders change. */
function catalogCache(directory: string) {
	let key = '';
	let body: Promise<string> | null = null;
	return async (): Promise<string> => {
		const stamps = await Promise.all(
			['conversion-manifest.json', 'study-cache/curation.json', 'audio', 'terrain'].map((p) =>
				stat(join(directory, p)).then(
					(s) => s.mtimeMs,
					() => 0
				)
			)
		);
		const next = stamps.join(':');
		if (body && next === key) return body;
		key = next;
		body = buildStudyCatalog(directory).then(async (catalog) => {
			const text = `${JSON.stringify(catalog, null, '\t')}\n`;
			// A mirror for people and tools; it stays under tmp/ like everything derived.
			await mkdir(join(directory, 'study-cache'), { recursive: true });
			await writeFile(join(directory, 'study-cache/catalog.json'), text).catch(() => {});
			return text;
		});
		body.catch(() => {
			body = null;
		});
		return body;
	};
}

// --- the middleware -------------------------------------------------------------

export function studyMiddleware(directory: string, base = '') {
	const prefix = `${base}${STUDY_DEV_PREFIX}`;
	const catalog = catalogCache(directory);
	return (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
		const path = (request.url ?? '').split('?')[0];
		if (!path.startsWith(prefix)) {
			next();
			return;
		}
		const fail = (status: number) => {
			response.statusCode = status;
			response.end();
		};
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('X-Frame-Options', 'DENY');
		// Dev machine only: never cached by a proxy, never indexed.
		response.setHeader('X-Robots-Tag', 'noindex');
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			response.setHeader('Allow', 'GET, HEAD');
			fail(405);
			return;
		}
		let relative: string;
		try {
			relative = decodeURIComponent(path.slice(prefix.length));
		} catch {
			fail(404);
			return;
		}
		if (relative === 'catalog.json') {
			void catalog().then(
				(text) => {
					response.setHeader('Content-Type', types['.json']);
					response.setHeader('Content-Length', Buffer.byteLength(text));
					response.end(request.method === 'HEAD' ? undefined : text);
				},
				() => fail(500)
			);
			return;
		}
		if (
			relative.includes('\\') ||
			relative.includes('\0') ||
			relative.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
		) {
			fail(404);
			return;
		}
		const type = types[extname(relative).toLowerCase()];
		if (!type) {
			fail(404);
			return;
		}
		void (async () => {
			try {
				const [root, file] = await Promise.all([realpath(directory), realpath(resolve(directory, relative))]);
				if (!file.startsWith(root + sep)) {
					fail(404);
					return;
				}
				const info = await stat(file);
				if (!info.isFile()) {
					fail(404);
					return;
				}
				response.setHeader('Content-Type', type);
				response.setHeader('Content-Length', info.size);
				if (request.method === 'HEAD') {
					response.end();
					return;
				}
				pipeline(createReadStream(file), response, () => {});
			} catch {
				fail(404);
			}
		})();
	};
}

/** `apply: 'serve'`: the plugin does not exist in `vite build`. */
export function greenHellStudyDev(): Plugin {
	return {
		name: 'greenhell-study-dev',
		apply: 'serve',
		configureServer(server) {
			server.middlewares.use(studyMiddleware(resolve(server.config.root, '../tmp/greenhell-port')));
		}
	};
}
