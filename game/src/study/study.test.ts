/**
 * The LOCAL-ONLY Green Hell study mode: the gate matrix, the entry's early
 * returns, the URL left alone, the herd plan on the story map, the painted
 * look's pixel maths, the clip and skin fixes, and the dev middleware (path
 * safety and the catalog built on the fly). No study asset is read here: the
 * middleware tests build their own tiny fixtures in the agents' scratch folder.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
	AnimationClip,
	Bone,
	Box3,
	BoxGeometry,
	Float32BufferAttribute,
	Group,
	Matrix4,
	MeshBasicMaterial,
	Skeleton,
	SkinnedMesh,
	Uint16BufferAttribute,
	Vector3,
	VectorKeyframeTrack
} from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildStudyCatalog, studyMiddleware } from '../../study-dev.ts';
import { buildStoryWorld } from '../level/build.ts';
import { LIGHTNESS, RAMPS, SATURATION } from '../style/palette.ts';
import { FLAG } from '../survival/types.ts';
import { STUDY_PICKS } from './catalog.ts';
import { clipKey } from './data.ts';
import { fixSkinOffset, makeInPlace, resolveRoles } from './fauna.ts';
import { type StudyContext, studyAutomated, studyEnabled, studyLook, studyUrl } from './gate.ts';
import { BANK_BAND, habitatAt, planStudyHerds } from './herds.ts';
import { startStudy } from './index.ts';
import { posterizePixels, rgbToHsl } from './stylize.ts';

const open: StudyContext = { dev: true, browser: true, test: false, webdriver: false, softwareTest: false };

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe('study gate', () => {
	it('is on by default on the dev server, in a browser, for people', () => {
		expect(studyEnabled('', open)).toBe(true);
		expect(studyEnabled('?debug', open)).toBe(true);
		expect(studyEnabled('?debug&pose=bridge', open)).toBe(true);
		expect(studyEnabled('?estudo=greenhell', open)).toBe(true);
	});

	it('turns off with ?estudo=off, also when forced elsewhere', () => {
		expect(studyEnabled('?estudo=off', open)).toBe(false);
		expect(studyEnabled('?debug&estudo=off', open)).toBe(false);
		expect(studyEnabled('?estudo=off', { ...open, webdriver: true })).toBe(false);
	});

	it('stays off in automated runs unless forced with ?estudo=greenhell', () => {
		const cases: [string, Partial<StudyContext>][] = [
			['?golden=1', {}],
			['?debug&golden=1&tier=high', {}],
			['?e2e', {}],
			['?e2e=1', {}],
			['', { webdriver: true }],
			['', { softwareTest: true }],
			['', { test: true }]
		];
		for (const [search, context] of cases) {
			const ctx = { ...open, ...context };
			expect(studyAutomated(search, ctx), search + JSON.stringify(context)).toBe(true);
			expect(studyEnabled(search, ctx), search + JSON.stringify(context)).toBe(false);
			expect(studyEnabled(`${search}${search ? '&' : '?'}estudo=greenhell`, ctx)).toBe(true);
		}
	});

	it('is off without a DOM and off on anything but the dev server', () => {
		expect(studyEnabled('?estudo=greenhell', { ...open, browser: false })).toBe(false);
		expect(studyEnabled('?estudo=greenhell', { ...open, dev: false })).toBe(false);
		vi.stubEnv('DEV', false);
		expect(studyEnabled('?estudo=greenhell', open)).toBe(false);
		expect(studyEnabled('', open)).toBe(false);
	});

	it('reads the look and builds encoded dev URLs under the study prefix', () => {
		expect(studyLook('')).toBe('painted');
		expect(studyLook('?look=raw')).toBe('raw');
		expect(studyLook('?look=painted')).toBe('painted');
		expect(studyUrl('animals/browser/x.glb')).toBe('/__estudo/greenhell/animals/browser/x.glb');
		expect(studyUrl('/audio/1-Toucan SFX 2.webm')).toBe('/__estudo/greenhell/audio/1-Toucan%20SFX%202.webm');
	});
});

describe('study entry', () => {
	const host = () => ({ parent: new Group(), world: buildStoryWorld().world, quality: 'low' as const });

	it('returns early (nothing created) when not DEV, when off, in automated runs and in Node', () => {
		vi.stubEnv('DEV', false);
		expect(startStudy(host(), '?estudo=greenhell', open)).toBeNull();
		vi.unstubAllEnvs();
		expect(startStudy(host(), '?estudo=off', open)).toBeNull();
		expect(startStudy(host(), '?golden=1', open)).toBeNull();
		expect(startStudy(host(), '', { ...open, webdriver: true })).toBeNull();
		// The real context under Vitest: MODE test, no DOM.
		expect(startStudy(host(), '?estudo=greenhell')).toBeNull();
		expect(startStudy(host())).toBeNull();
	});

	it('starts when the gate is open, and disposes before its module even loads', () => {
		const h = host();
		const study = startStudy(h, '', open);
		expect(study).not.toBeNull();
		expect(study?.debug()).toBeNull();
		study?.dispose();
		expect(h.parent.children).toHaveLength(0);
	});

	it('never touches the URL (no history writes, the query stays as it was)', () => {
		const search = '?debug&pose=bridge';
		const history = { replaceState: vi.fn(), pushState: vi.fn() };
		vi.stubGlobal('location', { search, href: `http://localhost:5196/${search}` });
		vi.stubGlobal('history', history);
		expect(studyEnabled(undefined, open)).toBe(true);
		expect(studyLook()).toBe('painted');
		const study = startStudy(host(), undefined, open);
		study?.dispose();
		expect(history.replaceState).not.toHaveBeenCalled();
		expect(history.pushState).not.toHaveBeenCalled();
		expect(location.search).toBe(search);
		expect(new URLSearchParams(location.search).get('pose')).toBe('bridge');
	});
});

describe('study herds on the story map', () => {
	const { world, level } = buildStoryWorld();
	const plan = planStudyHerds(world, level);
	const at = (x: number, z: number) => Math.round(z) * world.grid + Math.round(x);

	it('places every group of the brief, deterministically', () => {
		const count = (prefix: string) => plan.members.filter((m) => m.key.startsWith(prefix)).length;
		expect(count('capivara-')).toBe(3);
		expect(count('anta')).toBe(2);
		expect(count('cateto-')).toBe(5);
		expect(count('tatu')).toBe(1);
		expect(count('sapo-')).toBe(3);
		expect(count('caranguejo-')).toBe(4);
		expect(count('onca-parda')).toBe(1);
		expect(planStudyHerds(world, level).members).toEqual(plan.members);
		for (const m of plan.members) expect(STUDY_PICKS[m.species], m.species).toBeDefined();
	});

	it('keeps every member on its habitat, dry and off the bridges', () => {
		for (const m of plan.members) {
			expect(habitatAt(world, plan.riverDistance, m.habitat, m.x, m.z), m.key).toBe(true);
			expect(world.flags[at(m.x, m.z)] & (FLAG.river | FLAG.crossing), m.key).toBe(0);
		}
		for (const m of plan.members.filter((m) => m.habitat === 'bank'))
			expect(plan.riverDistance[at(m.x, m.z)], m.key).toBeLessThanOrEqual(BANK_BAND[1]);
		const puma = plan.members.find((m) => m.key === 'onca-parda');
		expect(puma?.x).toBeGreaterThan(140);
	});

	it('gives every follower a leader of its own group', () => {
		for (const m of plan.members.filter((m) => m.behaviour === 'follow')) {
			const leader = plan.members[m.leader];
			expect(leader, m.key).toBeDefined();
			expect(leader.group).toBe(m.group);
		}
	});
});

describe('painted look', () => {
	it('keeps every opaque pixel inside the world range and leaves clear pixels alone', () => {
		const data = new Uint8ClampedArray(256 * 4);
		for (let i = 0; i < 256; i++) {
			data.set([i, (i * 7) % 256, 255 - i, i % 3 === 0 ? 0 : 255], i * 4);
		}
		const clear = data.filter((_, k) => k % 4 !== 3 && data[k - (k % 4) + 3] === 0);
		posterizePixels(data);
		for (let i = 0; i < 256; i++) {
			if (data[i * 4 + 3] === 0) continue;
			const [, s, l] = rgbToHsl(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
			expect(l).toBeGreaterThanOrEqual(LIGHTNESS.min - 0.01);
			expect(l).toBeLessThanOrEqual(LIGHTNESS.max + 0.01);
			if (s > 0.02) expect(s).toBeLessThanOrEqual(SATURATION.max + 0.01);
		}
		expect(data.filter((_, k) => k % 4 !== 3 && data[k - (k % 4) + 3] === 0)).toEqual(clear);
	});

	it('cuts a smooth gradient into a few tones and sends greys to the rock ramp', () => {
		const grey = new Uint8ClampedArray(64 * 4);
		for (let i = 0; i < 64; i++) grey.set([i * 4, i * 4, i * 4, 255], i * 4);
		expect(posterizePixels(grey, 1, 4)).toBe('rock');
		const tones = new Set<string>();
		for (let i = 0; i < 64; i++) tones.add(grey.slice(i * 4, i * 4 + 3).join(','));
		expect(tones.size).toBeLessThanOrEqual(4);
		const rock = RAMPS.rock.map((hex) => {
			const n = Number.parseInt(hex.slice(1), 16);
			return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
		});
		for (const tone of tones) expect(rock).toContain(tone);
	});

	it('sends a brown animal to a brown ramp', () => {
		const brown = new Uint8ClampedArray([110, 72, 40, 255, 70, 45, 25, 255]);
		expect(['wood', 'soil']).toContain(posterizePixels(brown));
	});
});

describe('clips and skins', () => {
	it('reads clip keys from the converter names', () => {
		expect(clipKey('Capybara|walk_forward_reduced|Base Layer')).toBe('walk_forward_reduced');
		expect(clipKey('Peccary|peccary_big|alerted|Base Layer')).toBe('alerted');
		expect(clipKey('plain')).toBe('plain');
	});

	it('resolves each role to a clip of the file, with fallbacks', () => {
		const roles = resolveRoles(STUDY_PICKS.Capybara, [
			'idle_look_around',
			'walk_forward_reduced',
			'eat',
			'idle_scratch'
		]);
		expect(roles).toEqual({
			idle: 'idle_look_around',
			walk: 'walk_forward_reduced',
			run: 'walk_forward_reduced',
			eat: 'eat',
			alerted: 'idle_look_around',
			extra: 'idle_scratch',
			show: null
		});
	});

	it('makes a travelling clip play in place and keeps its bob', () => {
		const track = new VectorKeyframeTrack('hip.position', [0, 0.5, 1], [0, 1, 0, 1, 1.2, 0, 2, 1, 0]);
		const clip = new AnimationClip('walk', 1, [track]);
		makeInPlace(clip);
		const v = clip.tracks[0].values;
		expect(v[6] - v[0]).toBeCloseTo(0);
		expect(v[3]).toBeCloseTo(0);
		expect(v[4] - v[1]).toBeCloseTo(0.2);
	});

	it('moves a skin baked a root offset away back onto its skeleton', () => {
		const geometry = new BoxGeometry(1, 1, 1);
		const count = geometry.attributes.position.count;
		geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
		geometry.setAttribute(
			'skinWeight',
			new Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4)
		);
		const bone = new Bone();
		const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
		mesh.add(bone);
		const broken = new Matrix4().makeTranslation(10, 0, 0);
		mesh.bind(new Skeleton([bone], [broken]), new Matrix4());
		const root = new Group();
		root.add(mesh);
		const centre = () => {
			root.updateMatrixWorld(true);
			return new Box3().setFromObject(root, true).getCenter(new Vector3());
		};
		expect(centre().x).toBeCloseTo(10);
		expect(fixSkinOffset(root)).toBe(true);
		expect(centre().length()).toBeCloseTo(0);
		expect(fixSkinOffset(root)).toBe(false);
	});
});

describe('study middleware', () => {
	let scratch: string;
	let origin: string;
	const dir = () => join(scratch, 'port');
	const server = createServer((request, response) => {
		studyMiddleware(dir())(request, response, () => {
			response.statusCode = 418;
			response.end('next');
		});
	});

	/** A GLB with a JSON chunk only: what the catalog reads. */
	const glb = (json: object) => {
		const text = Buffer.from(JSON.stringify(json));
		const chunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
		const header = Buffer.alloc(20);
		header.writeUInt32LE(0x46546c67, 0);
		header.writeUInt32LE(2, 4);
		header.writeUInt32LE(20 + chunk.length, 8);
		header.writeUInt32LE(chunk.length, 12);
		header.writeUInt32LE(0x4e4f534a, 16);
		return Buffer.concat([header, chunk]);
	};

	beforeAll(async () => {
		const parent = join(homedir(), '.cache/agents/2026-10-26-greenhell-study');
		await mkdir(parent, { recursive: true });
		scratch = await mkdtemp(join(parent, 'study-dev-http-'));
		await mkdir(join(dir(), 'animals/browser'), { recursive: true });
		await mkdir(join(dir(), 'scenery/browser'), { recursive: true });
		await mkdir(join(dir(), 'audio'), { recursive: true });
		await mkdir(join(dir(), 'study-cache'), { recursive: true });
		await writeFile(
			join(dir(), 'animals/browser/Beast-web.glb'),
			glb({ meshes: [{}], skins: [{ joints: [0, 1, 2] }] })
		);
		await writeFile(
			join(dir(), 'scenery/browser/tree_a-web.glb'),
			glb({ meshes: [{}, {}], materials: [{ name: 'bark' }, { name: 'bark_caster' }] })
		);
		await writeFile(join(dir(), 'audio/1-call_01.webm'), 'a');
		await writeFile(join(dir(), 'audio/2-call_01.webm'), 'b');
		await writeFile(join(dir(), 'audio/3-wind_01.webm'), 'c');
		await writeFile(join(dir(), '.secret.json'), '{}');
		await writeFile(join(scratch, 'outside.json'), '{"leak":true}');
		await writeFile(
			join(dir(), 'conversion-manifest.json'),
			JSON.stringify({
				total_jobs: 2,
				success: [
					{
						name: 'Beast',
						kind: 'animal',
						web_glb: 'animals/browser/Beast-web.glb',
						triangles: 12,
						animations: ['Beast|walk|Base Layer', 'Beast|idle|Base Layer', 'b_leg|idle|Base Layer']
					},
					{ name: 'tree_a', kind: 'scenery', web_glb: 'scenery/browser/tree_a-web.glb', triangles: 40 }
				]
			})
		);
		await writeFile(
			join(dir(), 'study-cache/curation.json'),
			JSON.stringify({
				animals: { Beast: { name: 'bicho', fit: 'pick', why: 'test' } },
				plants: [{ pattern: '^tree_', role: 'tree', fit: 'pick', why: 'test' }],
				sounds: [{ id: 'calls', role: 'call', pattern: '^call_\\d+$', fit: 'pick', note: 'test' }]
			})
		);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('server-address');
		origin = `http://127.0.0.1:${address.port}`;
	});

	afterAll(async () => {
		server.closeIdleConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(scratch, { recursive: true, force: true });
	});

	it('serves files under the prefix and passes everything else on', async () => {
		const ok = await fetch(`${origin}/__estudo/greenhell/audio/3-wind_01.webm`);
		expect(ok.status).toBe(200);
		expect(ok.headers.get('content-type')).toBe('audio/webm');
		expect(ok.headers.get('cache-control')).toBe('no-store');
		expect(await ok.text()).toBe('c');
		expect((await fetch(`${origin}/src/main.ts`)).status).toBe(418);
		expect(
			(await fetch(`${origin}/__estudo/greenhell/audio/3-wind_01.webm`, { method: 'POST' })).status
		).toBe(405);
	});

	/** A raw request: the path reaches the middleware exactly as written (fetch would normalise it). */
	const raw = (path: string) =>
		new Promise<{ status: number; body: string }>((resolve, reject) => {
			const url = new URL(origin);
			get({ host: url.hostname, port: url.port, path }, (response) => {
				let body = '';
				response.on('data', (chunk) => {
					body += chunk;
				});
				response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
			}).on('error', reject);
		});

	it('refuses traversal, dotfiles, unknown types and missing files', async () => {
		for (const path of [
			'%2e%2e/outside.json',
			'../outside.json',
			'..%2Foutside.json',
			'audio/%2e%2e/%2e%2e/outside.json',
			'audio/../../outside.json',
			'.secret.json',
			'conversion-manifest.py',
			'nope.glb',
			'audio//3-wind_01.webm'
		]) {
			const { status, body } = await raw(`/__estudo/greenhell/${path}`);
			expect(status, path).toBe(404);
			expect(body).not.toContain('leak');
		}
	});

	it('builds catalog.json on the fly from the manifest, the files and the curation', async () => {
		const response = await fetch(`${origin}/__estudo/greenhell/catalog.json`);
		expect(response.status).toBe(200);
		const catalog = await response.json();
		expect(catalog.jobs).toBe(2);
		expect(catalog.animals).toEqual([
			expect.objectContaining({ id: 'Beast', name: 'bicho', fit: 'pick', joints: 3, clips: ['walk', 'idle'] })
		]);
		expect(catalog.plants).toEqual([
			expect.objectContaining({ id: 'tree_a', role: 'tree', casters: 1, meshes: 2 })
		]);
		const calls = catalog.sounds.find((s: { id: string }) => s.id === 'calls');
		expect(calls.files).toEqual(['audio/1-call_01.webm']);
		expect(catalog.sounds.find((s: { id: string }) => s.id === 'unsorted').files).toEqual([
			'audio/3-wind_01.webm'
		]);
		expect(await buildStudyCatalog(dir())).toMatchObject({ jobs: 2 });
	});
});
