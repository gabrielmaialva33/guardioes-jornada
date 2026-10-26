import { describe, expect, it } from 'vitest';
import { RELIEF } from '../level/layout.ts';
import { WADE_LIMIT, WATER_LEVEL } from '../survival/types.ts';
import { layerSeeds, WORLD_SEED } from './constants.ts';
import {
	BAIXADA_FOOT,
	COSTAO_FOOT,
	CREST_S,
	coastX,
	macroFields,
	macroHeight,
	newMacroPoint,
	samplePoint,
	serraFoot
} from './macro.ts';

const layers = layerSeeds(WORLD_SEED);
const fields = macroFields(WORLD_SEED);
const RESERVA_ROWS = [-40, -20, 0, 40, 80, 120, 160, 180, 200];

describe('macro relief', () => {
	it("keeps the Reserva's coast and serra foot along its z range and stitch band", () => {
		for (const z of RESERVA_ROWS) {
			expect(coastX(z, layers)).toBe(0);
			expect(serraFoot(z, layers)).toBe(COSTAO_FOOT);
		}
	});

	it('reproduces LEVEL.md §3 there: restinga, baixada, encosta, then the serra', () => {
		const h = (x: number) => macroHeight(x, COSTAO_FOOT);
		for (let x = 0; x <= 8; x++) expect(h(x)).toBe(RELIEF.restingaY);
		for (let x = 14; x <= 104; x++) {
			expect(h(x)).toBeGreaterThanOrEqual(RELIEF.baixadaFrom);
			expect(h(x)).toBeLessThanOrEqual(RELIEF.baixadaTo);
		}
		expect(h(RELIEF.encostaFromX)).toBeCloseTo(RELIEF.encostaFromY, 9);
		expect(h(118)).toBeCloseTo(4.5, 9);
		expect(h(RELIEF.encostaToX)).toBeCloseTo(RELIEF.encostaToY, 9);
		expect(h(RELIEF.serraFromX)).toBeCloseTo(7.5, 9);
		for (let x = 137; x <= 160; x++) {
			expect(h(x)).toBeGreaterThanOrEqual(RELIEF.serraFromY);
			expect(h(x)).toBeLessThanOrEqual(RELIEF.serraToY);
		}
		expect(h(160)).toBeGreaterThan(17);
		for (let x = -200; x < -12; x++) expect(h(x)).toBeLessThan(WATER_LEVEL);
	});

	it('adds only the Reserva-sized detail in the stitch band', () => {
		const p = newMacroPoint();
		for (const z of [-40, -20, -1, 161, 180, 200])
			for (let x = 0; x <= 104; x++) {
				samplePoint(x, z, 0, COSTAO_FOOT, fields, p);
				expect(p.calm).toBe(0);
				expect(p.e).toBe(x);
				if (x <= 8) expect(p.ground).toBe(RELIEF.restingaY);
				if (x >= 14) {
					expect(p.ground).toBeGreaterThanOrEqual(RELIEF.baixadaMin);
					expect(p.ground).toBeLessThanOrEqual(RELIEF.baixadaMax);
				}
			}
	});

	it('alternates costões (~130 u) and wide baixadas (~600 u) along the coast', () => {
		const feet: number[] = [];
		for (let z = -40000; z <= 40000; z += 100) feet.push(serraFoot(z, layers));
		const costao = feet.filter((f) => f < 200).length / feet.length;
		const baixada = feet.filter((f) => f > 500).length / feet.length;
		expect(Math.min(...feet)).toBe(COSTAO_FOOT);
		expect(Math.max(...feet)).toBeGreaterThan(BAIXADA_FOOT - 10);
		expect(costao).toBeGreaterThan(0.15);
		expect(baixada).toBeGreaterThan(0.15);
		let switches = 0;
		let wide = feet[0] > 366;
		for (const f of feet)
			if (f > 450 !== wide && (f > 450 || f < 280)) {
				wide = f > 450;
				switches++;
			}
		expect(switches).toBeGreaterThan(10);
	});

	it('closes the west with the sea and climbs east without end', () => {
		const p = newMacroPoint();
		for (const z of [-7000, -1000, 2500, 9000, 31000]) {
			const coast = coastX(z, layers);
			const foot = serraFoot(z, layers);
			let last = Number.NEGATIVE_INFINITY;
			let lastE = Number.NEGATIVE_INFINITY;
			// Up to the crest (the warp moves e by at most 25 u).
			for (let x = Math.floor(coast) - 300; x < coast + foot + CREST_S - 30; x += 2) {
				samplePoint(x, z, coast, foot, fields, p);
				expect(p.e).toBeGreaterThan(lastE);
				lastE = p.e;
				expect(p.macro).toBeGreaterThanOrEqual(last);
				last = p.macro;
				if (x < coast - 60) expect(p.ground).toBeLessThan(WADE_LIMIT);
			}
			expect(last).toBeGreaterThan(44);
			for (const x of [coast + foot + 600, 20000, 200000]) {
				samplePoint(x, z, coast, foot, fields, p);
				expect(p.ground).toBeGreaterThan(36);
				expect(p.ground).toBeLessThan(54);
			}
		}
	});

	it('keeps river water under the ground it flows through', () => {
		const p = newMacroPoint();
		for (let k = 0; k < 4000; k++) {
			const x = -100 + ((k * 7919) % 1300);
			const z = -5000 + ((k * 104729) % 10000);
			samplePoint(x, z, coastX(z, layers), serraFoot(z, layers), fields, p);
			expect(p.floor).toBeLessThanOrEqual(p.ground);
		}
	});
});
