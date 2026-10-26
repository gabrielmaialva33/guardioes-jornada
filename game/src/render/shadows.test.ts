import {
	BoxGeometry,
	Color,
	Group,
	Mesh,
	MeshLambertMaterial,
	PCFShadowMap,
	type ShadowMapType,
	Vector3
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT } from '../style/palette.ts';
import {
	BlobShadows,
	createBlobTexture,
	SHADOW_TIERS,
	ShadowRig,
	SUN_AZIMUTH_DEG,
	sunDirection
} from './shadows.ts';

function mockRenderer() {
	return {
		shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false, type: PCFShadowMap as ShadowMapType }
	};
}

/** Runs `frames` updates at a fixed focus; returns how many shadow renders were requested. */
function idle(rig: ShadowRig, frames: number, x = 0, z = 0) {
	let renders = 0;
	for (let i = 0; i < frames; i++) if (rig.update(x, 0, z)) renders++;
	return renders;
}

describe('ShadowRig', () => {
	it('low: no shadow map, blobs for everyone, never asks for a shadow render', () => {
		const renderer = mockRenderer();
		const rig = new ShadowRig(renderer);
		expect(rig.tier).toBe('low');
		expect(renderer.shadowMap.enabled).toBe(false);
		expect(rig.sun.castShadow).toBe(false);
		expect(rig.blobs.mode).toBe('all');
		rig.markMoved();
		expect(idle(rig, 60)).toBe(0);
		expect(renderer.shadowMap.needsUpdate).toBe(false);
	});

	it('lights from the palette elevation on every tier, low included', () => {
		const rig = new ShadowRig(mockRenderer());
		const direction = rig.sun.position.clone().sub(rig.sun.target.position).normalize();
		expect(direction.distanceTo(sunDirection(LIGHT.daylight.sunElevationDeg, SUN_AZIMUTH_DEG))).toBeLessThan(
			1e-6
		);
		expect(rig.sun.color.equals(new Color(LIGHT.daylight.sun))).toBe(true);
		rig.setVariant('night');
		const night = rig.sun.position.clone().sub(rig.sun.target.position).normalize();
		expect(night.distanceTo(sunDirection(LIGHT.night.sunElevationDeg, SUN_AZIMUTH_DEG))).toBeLessThan(1e-6);
	});

	it('medium: 1024 map, autoUpdate off, renders only when something moved', () => {
		const renderer = mockRenderer();
		const rig = new ShadowRig(renderer);
		rig.setTier('medium');
		expect(renderer.shadowMap).toMatchObject({ enabled: true, autoUpdate: false, type: PCFShadowMap });
		expect(rig.sun.shadow.mapSize.x).toBe(1024);
		expect(rig.sun.castShadow).toBe(true);
		expect(rig.blobs.mode).toBe('items');
		// The first frame renders (invalidated by the tier change), then nothing while still.
		expect(rig.update(10, 0, 10)).toBe(true);
		expect(renderer.shadowMap.needsUpdate).toBe(true);
		renderer.shadowMap.needsUpdate = false; // three clears it after rendering
		expect(idle(rig, 120, 10, 10)).toBe(0);
		// Jitter along light-space right, centred on a texel: independent of the art-directed azimuth.
		const texel = (2 * SHADOW_TIERS.medium.extent) / SHADOW_TIERS.medium.mapSize;
		const right = new Vector3(0, 1, 0)
			.cross(sunDirection(LIGHT.daylight.sunElevationDeg, SUN_AZIMUTH_DEG))
			.normalize();
		const centre = right.clone().multiplyScalar(100 * texel);
		rig.update(centre.x, centre.y, centre.z);
		renderer.shadowMap.needsUpdate = false;
		let jitter = 0;
		for (let i = 0; i < 30; i++) {
			const offset = (i % 2 ? 0.3 : -0.3) * texel;
			if (rig.update(centre.x + right.x * offset, centre.y + right.y * offset, centre.z + right.z * offset))
				jitter++;
		}
		expect(jitter).toBe(0);
		// Walking at 9.6 u/s on 60 Hz: re-renders every frame, so the shadow stays under the feet.
		let renders = 0;
		for (let i = 1; i <= 60; i++) if (rig.update(10 + i * 0.16, 0, 10)) renders++;
		expect(renders).toBe(60);
		// Animating in place (markMoved) also re-renders; a thermal throttle halves it.
		rig.setInterval(2);
		renders = 0;
		for (let i = 0; i < 20; i++) {
			rig.markMoved();
			if (rig.update(20, 0, 10)) renders++;
		}
		expect(renders).toBe(10);
		rig.setInterval(undefined);
		// Still again: nothing more.
		expect(idle(rig, 60, 20, 10)).toBe(0);
	});

	it('follows the player with the light snapped to whole texels', () => {
		const rig = new ShadowRig(mockRenderer());
		rig.setTier('high');
		rig.update(3.3, 0, -7.9);
		const target = rig.sun.target.position.clone();
		const direction = rig.sun.position.clone().sub(target).normalize();
		expect(direction.distanceTo(sunDirection(LIGHT.daylight.sunElevationDeg, SUN_AZIMUTH_DEG))).toBeLessThan(
			1e-6
		);
		// The target sits within one texel (plus the coarse depth step) of the focus.
		expect(Math.hypot(target.x - 3.3, target.z + 7.9)).toBeLessThan(4);
	});

	it('sets casters and receivers per tier', () => {
		const renderer = mockRenderer();
		const rig = new ShadowRig(renderer);
		const avatar = new Group().add(new Mesh(new BoxGeometry(), new MeshLambertMaterial()));
		const tree = new Group().add(new Mesh(new BoxGeometry(), new MeshLambertMaterial()));
		const ground = new Mesh(new BoxGeometry(), new MeshLambertMaterial());
		rig.addCaster(avatar, 'actor');
		rig.addCaster(tree, 'static');
		rig.addReceiver(ground);
		const casts = (object: Group) => object.children[0].castShadow;
		expect([casts(avatar), casts(tree), ground.receiveShadow]).toEqual([false, false, false]);
		rig.setTier('medium');
		expect([casts(avatar), casts(tree), ground.receiveShadow]).toEqual([true, false, true]);
		rig.setTier('high');
		expect(rig.sun.shadow.mapSize.x).toBe(2048);
		expect([casts(avatar), casts(tree), ground.receiveShadow]).toEqual([true, true, true]);
	});

	it('frees the shadow map when dropping to low and rebuilds programs on scene materials', () => {
		const renderer = mockRenderer();
		const rig = new ShadowRig(renderer);
		const scene = new Group();
		const material = new MeshLambertMaterial();
		scene.add(new Mesh(new BoxGeometry(), material));
		rig.setTier('medium', scene);
		const dispose = vi.fn();
		rig.sun.shadow.map = { dispose } as never;
		const version = material.version;
		rig.setTier('low', scene);
		expect(dispose).toHaveBeenCalled();
		expect(rig.sun.shadow.map).toBeNull();
		expect(renderer.shadowMap.enabled).toBe(false);
		expect(material.version).toBeGreaterThan(version);
	});
});

describe('BlobShadows', () => {
	it('draws all blobs in one instanced draw, items only on map tiers', () => {
		const blobs = new BlobShadows(8);
		const avatar = blobs.add('actor');
		const coin = blobs.add('item');
		blobs.sync();
		expect(blobs.count).toBe(0);
		blobs.set(avatar, 1, 0, 2, 0.6);
		blobs.set(coin, 5, 0.5, 5, 0.3);
		blobs.sync();
		expect(blobs.count).toBe(2);
		expect(blobs.drawCalls).toBe(1);
		const m = blobs.mesh.instanceMatrix.array;
		expect(m[0]).toBeCloseTo(1.2);
		expect([m[12], m[13], m[14]]).toEqual([1, expect.closeTo(0.03), 2]);
		blobs.mode = 'items';
		blobs.sync();
		expect(blobs.count).toBe(1);
		// Jumping shrinks the blob.
		blobs.mode = 'all';
		blobs.set(avatar, 1, 0, 2, 0.6, 10);
		blobs.sync();
		expect(m[0]).toBeCloseTo(1.2 * 0.6);
		blobs.remove(avatar);
		blobs.sync();
		expect(blobs.count).toBe(1);
		expect(blobs.add('actor')).toBe(avatar);
		blobs.dispose();
	});

	it('tints toward the hemisphere ground colour, never black', () => {
		const blobs = new BlobShadows(1);
		const color = (blobs.mesh.material as MeshLambertMaterial).color;
		expect(color.equals(new Color(LIGHT.daylight.hemisphereGround))).toBe(true);
		expect(color.getHex()).not.toBe(0);
		blobs.setVariant('night');
		expect(color.equals(new Color(LIGHT.night.hemisphereGround))).toBe(true);
		blobs.dispose();
	});

	it('generates a radial gradient: solid centre, clear rim', () => {
		const texture = createBlobTexture(32);
		const data = texture.image.data as Uint8Array;
		const alpha = (i: number, j: number) => data[(j * 32 + i) * 4 + 3];
		expect(alpha(16, 16)).toBe(255);
		expect(alpha(0, 0)).toBe(0);
		expect(alpha(16, 0)).toBeLessThan(10);
		expect(alpha(16, 8)).toBeGreaterThan(alpha(16, 4));
	});
});
it('never casts or receives horizon and sky shadows even when their parent is registered', () => {
	const rig = new ShadowRig(mockRenderer()),
		parent = new Group(),
		sky = new Mesh(new BoxGeometry(), new MeshLambertMaterial());
	sky.userData.noShadow = true;
	parent.add(sky);
	rig.addCaster(parent, 'static');
	rig.addReceiver(parent);
	rig.setTier('high');
	expect(sky.castShadow).toBe(false);
	expect(sky.receiveShadow).toBe(false);
	rig.dispose();
	sky.geometry.dispose();
	sky.material.dispose();
});
