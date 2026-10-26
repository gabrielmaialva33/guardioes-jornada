import { expect, it } from 'vitest';
import { GuideService } from '../guia/persistence.ts';
import { SpeciesRegistry } from '../guia/registry.ts';
import { SPECIES } from '../guia/species.ts';
import { CameraTrap } from './camera-trap.ts';
import { GuideMechanicsBridge } from './guide-bridge.ts';
import { PhotoCamera } from './photo.ts';

async function setup() {
	const blobs = new Map<string, Blob>();
	const service = await GuideService.open(
		new SpeciesRegistry(SPECIES),
		{
			async read() {
				return null;
			},
			async write() {
				return true;
			}
		},
		{
			async get(id) {
				return blobs.get(id) ?? null;
			},
			async put(id, blob) {
				blobs.set(id, blob);
			}
		}
	);
	return { service, blobs };
}
function photo() {
	const p = new PhotoCamera([
		{ id: 'a', species: 'tucano', position: { x: 0, y: 0, z: 2 } },
		{ id: 'b', species: 'saira', position: { x: 0, y: 0, z: 2 } }
	]);
	p.evaluate(
		{
			origin: { x: 0, y: 0, z: 0 },
			forward: { x: 0, y: 0, z: 1 },
			right: { x: 1, y: 0, z: 0 },
			up: { x: 0, y: 1, z: 0 },
			tanHalfFov: 1,
			aspect: 1
		},
		() => false
	);
	p.action();
	p.action();
	return p;
}
it('records all captured species once per revision and copies the saved list before async encoding', async () => {
	const { service, blobs } = await setup();
	let resolve: (blob: Blob) => void = () => {};
	const bridge = new GuideMechanicsBridge(
		service,
		() =>
			new Promise((r) => {
				resolve = r;
			})
	);
	const camera = photo();
	const pending = bridge.photoSaved(camera, { source: {} as CanvasImageSource, width: 1, height: 1 });
	camera.savedCount = 0;
	resolve(new Blob(['photo'], { type: 'image/jpeg' }));
	await pending;
	expect(service.book.count).toBe(2);
	expect(blobs.size).toBe(2);
	expect(await bridge.photoSaved(camera)).toBe(false);
});
it('discovers even when canvas encoding fails and only collects a ready trap', async () => {
	const { service } = await setup();
	const bridge = new GuideMechanicsBridge(service, async () => {
		throw new Error('tainted');
	});
	await bridge.photoSaved(photo(), { source: {} as CanvasImageSource, width: 1, height: 1 });
	expect(service.book.count).toBe(2);
	expect(bridge.photoIssue).toBe(true);
	const trap = new CameraTrap('muriqui', 'V4');
	expect(await bridge.collectTrap(trap)).toBe(false);
	trap.place(5);
	trap.missionCompleted('V3', 6);
	expect(await bridge.collectTrap(trap)).toBe(true);
	expect(service.book.has('muriqui')).toBe(true);
	expect(await bridge.collectTrap(trap)).toBe(false);
});
it('does not consume a ready trap for an unregistered species', async () => {
	const { service } = await setup();
	const bridge = new GuideMechanicsBridge(service);
	const trap = new CameraTrap('future-species', 'future-mission');
	trap.place(1);
	trap.missionCompleted('other', 2);
	expect(await bridge.collectTrap(trap)).toBe(false);
	expect(trap.phase).toBe('ready');
});
