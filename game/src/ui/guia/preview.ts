import '@fontsource-variable/alegreya/index.css';
import '@fontsource-variable/atkinson-hyperlegible-next/index.css';
import { flushSync, mount, unmount } from 'svelte';
import { AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { GuideService } from '../../guia/persistence.ts';
import { SpeciesRegistry } from '../../guia/registry.ts';
import { SPECIES } from '../../guia/species.ts';
import { IndexedDbThumbnails } from '../../guia/thumbnails.ts';
import { createMechanicsFixture } from '../../mechanics/fixture.ts';
import { GuideMechanicsBridge } from '../../mechanics/guide-bridge.ts';
import { PhotoProjection } from '../../mechanics/photo-three.ts';
import GuidePanel from './GuidePanel.svelte';

const query = new URLSearchParams(location.search),
	empty = query.has('empty');
const key = empty ? 'guardioes-guia-preview-empty' : 'guardioes-guia-preview';
const target = document.querySelector<HTMLElement>('#mount'),
	launcher = document.querySelector<HTMLButtonElement>('#launcher'),
	status = document.querySelector<HTMLElement>('#status');
if (!target || !launcher || !status) throw new Error('Missing guide preview markup');
const thumbnails = new IndexedDbThumbnails(globalThis.indexedDB, `${key}-thumbnails`);
const service = await GuideService.open(
	new SpeciesRegistry(SPECIES),
	{
		async read() {
			const raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : undefined;
		},
		async write(document) {
			try {
				localStorage.setItem(key, JSON.stringify(document));
				return true;
			} catch {
				return false;
			}
		}
	},
	thumbnails
);
const bridge = new GuideMechanicsBridge(service);
/** Actual rendered frame from P19's original fixture. Never stores an external/stock image. */
async function capture() {
	const fixture = createMechanicsFixture(),
		renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	renderer.setSize(600, 400);
	const scene = new Scene();
	scene.background = new Color(0xbadbe0);
	scene.add(fixture.root, new AmbientLight(0xffffff, 2));
	const light = new DirectionalLight(0xffe2b0, 2);
	light.position.set(-30, 70, -20);
	scene.add(light);
	const camera = new PerspectiveCamera(60, 1.5, 0.1, 100);
	camera.position.set(32, 2.7, -3);
	camera.lookAt(32, 3, 10);
	try {
		fixture.update();
		renderer.render(scene, camera);
		new PhotoProjection(fixture.world).evaluate(fixture.photo, camera);
		fixture.photo.action();
		fixture.photo.action();
		await bridge.photoSaved(fixture.photo, { source: renderer.domElement, width: 600, height: 400 });
	} finally {
		fixture.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
	}
	if (status) status.textContent = 'Tucano e saíra registrados no seu caderno.';
}
if (!empty && service.book.count === 0) {
	await service.record(
		[
			'mico',
			'onca',
			'tucano',
			'capivara',
			'anta',
			'cateto',
			'cachorro-do-mato',
			'onca-parda',
			'caranguejo-uca',
			'jabuti-tinga',
			'saira',
			'sabia'
		],
		'mission'
	);
	await capture();
}
let app: ReturnType<typeof mount> | undefined;
function open(entry = query.get('entry') ?? '') {
	if (app) return;
	launcher?.focus();
	app = mount(GuidePanel, {
		target: target as HTMLElement,
		props: { service, initialEntry: entry, reducedMotion: query.has('reduced'), onclose: () => void close() }
	});
	flushSync();
}
async function close() {
	if (!app) return;
	const current = app;
	app = undefined;
	await unmount(current);
	launcher?.focus();
}
launcher.addEventListener('click', () => open());
document.querySelector('#capture')?.addEventListener('click', () => void capture());
Object.assign(window, {
	__guia: {
		service,
		open,
		close,
		capture,
		async thumbnailBytes(id: string) {
			return (await thumbnails.get(id))?.size ?? 0;
		},
		state() {
			return {
				count: service.book.count,
				total: service.book.total,
				issue: service.issue,
				open: !!app,
				discoveries: service.book.snapshot()
			};
		}
	}
});
status.textContent = 'Seu caderno está pronto.';
if (!query.has('closed')) open();
window.addEventListener(
	'pagehide',
	() => {
		void close();
		thumbnails.close();
	},
	{ once: true }
);
