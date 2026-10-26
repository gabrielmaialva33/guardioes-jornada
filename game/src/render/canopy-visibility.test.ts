import { expect, it } from 'vitest';
import { CanopyVisibility, type CanopyVolume, segmentEntry } from './canopy-visibility.ts';

const crown: CanopyVolume = { x: 0, y: 7, z: 0, rx: 3, ry: 3, rz: 3, id: 0, setFade: () => true };
it('selects only crowns crossing the head-to-camera segment, including containment', () => {
	expect(segmentEntry(crown, { x: 0, y: 7, z: -8 }, { x: 0, y: 7, z: 8 })).toBeCloseTo(5 / 16);
	expect(segmentEntry(crown, { x: 0, y: 1, z: -8 }, { x: 0, y: 1, z: 8 })).toBeNull();
	expect(segmentEntry(crown, { x: 0, y: 7, z: 0 }, { x: 1, y: 7, z: 0 })).toBe(0);
	expect(segmentEntry(crown, { x: 8, y: 7, z: 0 }, { x: 9, y: 7, z: 0 })).toBeNull();
});
it('fades in 150 ms and restores without touching other instances', () => {
	const values: number[] = [];
	const c = new CanopyVisibility([
		{
			...crown,
			setFade: (_id, v) => {
				values.push(v);
				return true;
			}
		}
	]);
	c.update({ x: 0, y: 7, z: 7 }, { x: 0, y: 7, z: -7 }, 0.075);
	expect(values.at(-1)).toBeCloseTo(0.5);
	c.update({ x: 0, y: 7, z: 7 }, { x: 0, y: 7, z: -7 }, 0.075);
	expect(values.at(-1)).toBe(0);
	c.update({ x: 9, y: 7, z: 7 }, { x: 9, y: 7, z: -7 }, 0.15);
	expect(values.at(-1)).toBe(1);
	expect(c.fading).toBe(0);
});
it('pulls in only when the desired camera is inside a crown; traversed crowns still fade', () => {
	const c = new CanopyVisibility([crown]);
	expect(c.occlusion({ x: 0, y: 7, z: -8 }, { x: 0, y: 0, z: 1 }, 8)).toBeCloseTo(4.7);
	expect(c.occlusion({ x: 0, y: 7, z: -8 }, { x: 0, y: 0, z: 1 }, 16)).toBeNull();
	expect(c.occlusion({ x: 0, y: 7, z: 0 }, { x: 0, y: 0, z: 1 }, 1)).toBeNull();
});
it('fades the same tree when only its trunk crosses the view, restoring it after the camera moves', () => {
	const values: number[] = [];
	const c = new CanopyVisibility([
		{
			...crown,
			trunk: { x: 0, z: 0, bottom: 0, top: 5, radius: 0.8 },
			setFade: (_id, opacity) => {
				values.push(opacity);
				return true;
			}
		}
	]);
	c.update({ x: 0, y: 2, z: 7 }, { x: 0, y: 2, z: -7 }, 0.15);
	expect(values.at(-1)).toBe(0);
	c.update({ x: 3, y: 2, z: 7 }, { x: 3, y: 2, z: -7 }, 0.15);
	expect(values.at(-1)).toBe(1);
	c.update({ x: 0, y: -2, z: 7 }, { x: 0, y: -2, z: -7 }, 0.15);
	expect(values.at(-1)).toBe(1);
	// The foliage popper remains independent: the trunk is already in the physics BVH.
	expect(c.occlusion({ x: 0, y: 2, z: -7 }, { x: 0, y: 0, z: 1 }, 7)).toBeNull();
});
