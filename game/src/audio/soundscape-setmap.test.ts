import { describe, expect, it } from 'vitest';
import { buildZone } from '../level/zones/park.ts';
import type { ZoneId } from '../level/zones/spec.ts';
import { createGameAudio, DEFAULT_SETTINGS, type GameAudio, type LoopHandle } from './engine.ts';
import { FakeAudioContext, FakePage } from './fake-audio.test-helper.ts';
import { type FrameSounds, type MapOrigin, Soundscape, type SoundscapeMap } from './soundscape.ts';
import { createSurfaceSampler } from './surface.ts';
import { groundAt, nearestPoint, zoneSounds } from './zone-sounds.ts';

const mapOf = (id: ZoneId): SoundscapeMap => {
	const zone = buildZone(id);
	return { world: zone.world, level: zone.level, zone: id };
};
const originOf = (id: ZoneId): MapOrigin => {
	const zone = buildZone(id);
	return { x: zone.offsetX, z: zone.offsetZ };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface LoopRecord {
	id: string;
	fadeIn?: number;
	position: [number, number, number];
	playing: boolean;
	stopFade?: number;
}

/** A GameAudio that records loops, the listener and steps; `defer()` holds every preload until released. */
function recorder() {
	const loops: LoopRecord[] = [];
	const listener = { x: 0, y: 0, z: 0 };
	const steps: string[] = [];
	const pending: (() => void)[] = [];
	let defer = false;
	const audio: GameAudio = {
		state: 'running',
		voices: 0,
		unlock: async () => true,
		play: () => null,
		footstep(surface) {
			steps.push(surface);
			return null;
		},
		decode: async () => null,
		playBuffer: () => null,
		loopBuffer: () => null,
		loop(id, options = {}) {
			const record: LoopRecord = {
				id,
				fadeIn: options.fadeIn,
				position: [options.x ?? 0, options.y ?? 0, options.z ?? 0],
				playing: true
			};
			loops.push(record);
			const handle: LoopHandle = {
				id,
				get playing() {
					return record.playing;
				},
				stop(fade) {
					record.playing = false;
					record.stopFade = fade;
				},
				setGain() {},
				setPosition(x, y, z) {
					record.position = [x, y, z];
				}
			};
			return handle;
		},
		setListener(source) {
			const e = source.matrixWorld.elements;
			listener.x = e[12];
			listener.y = e[13];
			listener.z = e[14];
		},
		setBusVolume() {},
		mute() {},
		duck: () => () => {},
		settings: () => ({ volume: { ...DEFAULT_SETTINGS.volume }, muted: { ...DEFAULT_SETTINGS.muted } }),
		preload: () => (defer ? new Promise<void>((resolve) => pending.push(resolve)) : Promise.resolve()),
		dispose: async () => {}
	};
	return {
		audio,
		loops,
		listener,
		steps,
		pending,
		defer() {
			defer = true;
		}
	};
}

const playing = (loops: LoopRecord[]) =>
	loops
		.filter((l) => l.playing)
		.map((l) => l.id)
		.sort();

function listenerAt(x: number, y: number, z: number) {
	const elements = new Float32Array(16);
	elements[0] = elements[5] = elements[10] = elements[15] = 1;
	elements[12] = x;
	elements[13] = y;
	elements[14] = z;
	return { matrixWorld: { elements } };
}

const frameAt = (x: number, y: number, z: number): FrameSounds => ({
	position: { x, y, z },
	jumped: false,
	landed: false,
	landingSpeed: 0,
	events: []
});

/** The loops a soundscape started straight on `id` plays. */
async function loopsOn(id: ZoneId) {
	const rec = recorder();
	const sound = new Soundscape({ audio: rec.audio, map: mapOf(id), origin: originOf(id) });
	await sound.startNature();
	return playing(rec.loops);
}

describe('zone changes (setMap)', () => {
	it('leaves no voices or loops behind going Reserva → Vale → Reserva, on the same engine', async () => {
		const context = new FakeAudioContext();
		const audio = createGameAudio({
			createContext: () => context as unknown as AudioContext,
			page: new FakePage(),
			window: new FakePage(),
			canPlayType: () => '',
			fetch: () => Promise.reject(new Error('offline'))
		});
		await audio.unlock();
		/** Loops still scheduled (the unlock's silent sample is not one). */
		const liveLoops = () => context.live().filter((s) => s.loop);
		/** Sources the old zone stopped finish their fade. */
		const fadeEnds = () => {
			for (const source of context.sources) if (source.stoppedAt !== null) source.end();
		};
		const sound = new Soundscape({
			audio,
			map: mapOf('reserva'),
			origin: originOf('reserva'),
			reducedMotion: () => false
		});
		await sound.startNature();
		const reserva = audio.voices;
		expect(reserva).toBeGreaterThan(0);
		expect(liveLoops()).toHaveLength(reserva);

		sound.setMap(mapOf('vale'), originOf('vale'));
		// The old loops fade out over about a second, still holding their voices meanwhile.
		const fading = context.sources.filter((s) => s.stoppedAt !== null);
		expect(fading).toHaveLength(reserva);
		for (const source of fading) expect(source.stoppedAt).toBeCloseTo(1.01, 5);
		await flush();
		expect(audio.voices).toBeLessThanOrEqual(16);
		fadeEnds();
		const vale = audio.voices;
		expect(vale).toBe((await loopsOn('vale')).length);
		expect(liveLoops()).toHaveLength(vale);

		sound.setMap(mapOf('reserva'), originOf('reserva'));
		await flush();
		fadeEnds();
		expect(audio.voices).toBe(reserva);
		expect(liveLoops()).toHaveLength(reserva);

		await sound.dispose();
		fadeEnds();
		expect(audio.voices).toBe(0);
		expect(liveLoops()).toEqual([]);
	});

	it('crossfades into the new zone, and cuts with reduced motion', async () => {
		for (const reduced of [false, true]) {
			const rec = recorder();
			const sound = new Soundscape({
				audio: rec.audio,
				map: mapOf('reserva'),
				origin: originOf('reserva'),
				reducedMotion: () => reduced
			});
			await sound.startNature();
			const old = rec.loops.length;
			sound.setMap(mapOf('vale'), originOf('vale'));
			await flush();
			const fade = reduced ? 0 : 1;
			for (const loop of rec.loops.slice(0, old)) expect(loop.stopFade).toBe(fade);
			const fresh = rec.loops.slice(old);
			expect(fresh.length).toBeGreaterThan(0);
			for (const loop of fresh) expect(loop.fadeIn).toBe(fade);
			expect(playing(rec.loops)).toEqual(await loopsOn('vale'));
		}
	});

	it('keeps the fading emitters where they were in the world', async () => {
		const rec = recorder();
		const from = originOf('reserva');
		const to = originOf('vale');
		const sound = new Soundscape({ audio: rec.audio, map: mapOf('reserva'), origin: from });
		await sound.startNature();
		const placed = rec.loops.filter((l) => l.position.some((v) => v !== 0));
		expect(placed.length).toBeGreaterThan(0);
		const before = placed.map((l) => [...l.position]);
		sound.setMap(mapOf('vale'), to);
		placed.forEach((loop, k) => {
			const [x, y, z] = before[k];
			// The same world point, written in the Vale's frame.
			expect(loop.position[0]).toBeCloseTo(x + from.x - to.x, 5);
			expect(loop.position[1]).toBeCloseTo(y, 5);
			expect(loop.position[2]).toBeCloseTo(z + from.z - to.z, 5);
		});
	});

	it('drops a nature load that lands after the zone changed', async () => {
		const rec = recorder();
		rec.defer();
		const sound = new Soundscape({ audio: rec.audio, map: mapOf('reserva'), origin: originOf('reserva') });
		const first = sound.startNature();
		sound.setMap(mapOf('manguezal'), originOf('manguezal'));
		expect(rec.pending).toHaveLength(2);
		// The new zone's load lands first, the Reserva's late.
		rec.pending[1]();
		await flush();
		const manguezal = await loopsOn('manguezal');
		expect(playing(rec.loops)).toEqual(manguezal);
		const started = rec.loops.length;
		rec.pending[0]();
		await first;
		await flush();
		expect(rec.loops).toHaveLength(started);
		expect(rec.loops.some((l) => l.id === 'forest-day')).toBe(false);
	});

	it("starts nothing when the old zone's load lands first, then crossfades in on the new one", async () => {
		const rec = recorder();
		rec.defer();
		const sound = new Soundscape({
			audio: rec.audio,
			map: mapOf('reserva'),
			origin: originOf('reserva'),
			reducedMotion: () => false
		});
		void sound.startNature();
		sound.setMap(mapOf('vale'), originOf('vale'));
		rec.pending[0]();
		await flush();
		expect(rec.loops).toEqual([]);
		rec.pending[1]();
		await flush();
		expect(playing(rec.loops)).toEqual(await loopsOn('vale'));
		// The zone change's crossfade, not the first start's slower fades.
		for (const loop of rec.loops) expect(loop.fadeIn).toBe(1);
	});

	it('survives switching zones mid-load: only the last zone starts, once', async () => {
		for (const order of ['in order', 'reversed'] as const) {
			const rec = recorder();
			rec.defer();
			const sound = new Soundscape({
				audio: rec.audio,
				map: mapOf('reserva'),
				origin: originOf('reserva'),
				reducedMotion: () => false
			});
			void sound.startNature();
			sound.setMap(mapOf('vale'), originOf('vale'));
			sound.setMap(mapOf('praia'), originOf('praia'));
			sound.setMap(mapOf('copa'), originOf('copa'));
			expect(rec.loops).toEqual([]);
			const loads = order === 'in order' ? rec.pending : [...rec.pending].reverse();
			for (const resolve of loads) {
				resolve();
				await flush();
			}
			expect(rec.loops.map((l) => l.id).sort(), order).toEqual(await loopsOn('copa'));
			expect(playing(rec.loops)).toEqual(await loopsOn('copa'));
			for (const loop of rec.loops) expect(loop.fadeIn, order).toBe(1);
		}
	});

	it('changes map before the nature sounds were asked for, starting only the new one', async () => {
		const rec = recorder();
		const sound = new Soundscape({ audio: rec.audio, map: mapOf('reserva'), origin: originOf('reserva') });
		sound.setMap(mapOf('praia'), originOf('praia'));
		expect(rec.loops).toEqual([]);
		await sound.startNature();
		expect(playing(rec.loops)).toEqual(await loopsOn('praia'));
	});

	it('moves the world listener and the player into the zone frame by its origin', async () => {
		const rec = recorder();
		const sound = new Soundscape({ audio: rec.audio, map: mapOf('reserva'), origin: originOf('reserva') });
		await sound.startNature();
		const origin = originOf('praia');
		const { world, level } = buildZone('praia');
		sound.setMap(mapOf('praia'), origin);
		await flush();
		const [lx, lz] = [120.5, 40.25];
		const ground = groundAt(world, lx, lz);
		sound.update(
			1 / 60,
			listenerAt(origin.x + lx, ground + 3, origin.z + lz),
			frameAt(origin.x + lx, ground, origin.z + lz),
			'left',
			0
		);
		expect(rec.listener.x).toBeCloseTo(lx, 5);
		expect(rec.listener.y).toBeCloseTo(ground + 3, 5);
		expect(rec.listener.z).toBeCloseTo(lz, 5);
		expect(rec.steps).toEqual([createSurfaceSampler(world, level)(lx, ground, lz)]);
		// The surf follows the waterline point nearest the listener, in the zone's own frame.
		const plan = zoneSounds('praia', world, level);
		expect(plan.follow.length).toBeGreaterThan(0);
		for (const { id, points } of plan.follow) {
			const at = { x: 0, y: 0, z: 0 };
			nearestPoint(points, lx, lz, at);
			const loop = rec.loops.find((l) => l.id === id && l.playing);
			expect(loop?.position).toEqual([at.x, at.y, at.z]);
		}
	});

	it('does nothing after dispose', async () => {
		const rec = recorder();
		const sound = new Soundscape({ audio: rec.audio, map: mapOf('reserva'), origin: originOf('reserva') });
		await sound.startNature();
		await sound.dispose();
		const count = rec.loops.length;
		sound.setMap(mapOf('vale'), originOf('vale'));
		await flush();
		expect(rec.loops).toHaveLength(count);
		expect(playing(rec.loops)).toEqual([]);
	});
});
