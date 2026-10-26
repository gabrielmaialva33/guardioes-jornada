import {
	Color,
	Mesh,
	MeshBasicMaterial,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	WebGLRenderer
} from 'three';
import { gradeColor, lookUniforms, patchLook } from '../src/render/look.ts';

const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }),
	scene = new Scene(),
	camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10),
	geometry = new PlaneGeometry(2, 2),
	material = new MeshBasicMaterial();
material.onBeforeCompile = patchLook;
scene.add(new Mesh(geometry, material));
camera.position.z = 1;
camera.lookAt(0, 0, 0);
renderer.setSize(4, 4);
const inputs = [
		[0, 0, 0],
		[0.18, 0.18, 0.18],
		[0.05, 0.25, 0.08],
		[0.03, 0.2, 0.45],
		[2, 1, 0.4],
		[8, 8, 8]
	],
	samples: unknown[] = [];
let maxError = 0;
try {
	for (const night of [false, true])
		for (const rgb of inputs) {
			lookUniforms.uLookNight.value = night ? 1 : 0;
			material.color.setRGB(rgb[0], rgb[1], rgb[2]);
			renderer.render(scene, camera);
			const gl = renderer.getContext(),
				pixels = new Uint8Array(64);
			gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			const expected = gradeColor(
				new Color(rgb[0], rgb[1], rgb[2]),
				new Color(),
				night
			).convertLinearToSRGB();
			const bytes = [expected.r, expected.g, expected.b].map((v) => Math.round(v * 255)),
				actual = Array.from(pixels.slice(20, 23));
			maxError = Math.max(maxError, ...bytes.map((v, i) => Math.abs(v - actual[i])));
			samples.push({ rgb, night, expected: bytes, actual });
		}
	document.body.dataset.result = JSON.stringify({ maxError, samples });
} finally {
	lookUniforms.uLookNight.value = 0;
	geometry.dispose();
	material.dispose();
	renderer.dispose();
	renderer.forceContextLoss();
}
