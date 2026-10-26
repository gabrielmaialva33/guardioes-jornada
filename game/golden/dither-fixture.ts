/** Dev-only GPU regression fixture; never part of the game build entry graph. */
import {
	AdditiveBlending,
	Box3,
	InstancedBufferAttribute,
	InstancedMesh,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	OrthographicCamera,
	PlaneGeometry,
	Scene,
	Vector3,
	WebGLRenderer,
	WebGLRenderTarget
} from 'three';
import { lighting, patchTreeVisibility } from '../src/render/stylized.ts';
import type { SurvivalWorld } from '../src/survival/types.ts';
import { createTreeImpostors } from '../src/world-runtime/tree-impostors.ts';

const renderer = new WebGLRenderer({ antialias: false }),
	target = new WebGLRenderTarget(4, 4),
	scene = new Scene(),
	camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
const geometry = new PlaneGeometry(2, 2);
geometry.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array([1]), 1));
const detailMaterial = new MeshBasicMaterial({
	color: '#ff0000',
	transparent: true,
	blending: AdditiveBlending,
	depthTest: false,
	depthWrite: false
});
detailMaterial.onBeforeCompile = (shader) => patchTreeVisibility(shader, -3);
lighting.uTreeRange.value = 48;
lighting.uGameEye.value.set(48, 0, 0);
const detail = new InstancedMesh(geometry, detailMaterial, 1);
detail.setMatrixAt(0, new Matrix4());
scene.add(detail);
const prototypeGeometry = new PlaneGeometry(1, 1),
	prototypeMaterial = new MeshLambertMaterial({ color: '#ffffff' }),
	prototype = new Mesh(prototypeGeometry, prototypeMaterial);
const trees: SurvivalWorld['trees'] = {
	count: 1,
	kinds: ['araucaria'],
	kind: new Uint8Array([0]),
	block: new Uint8Array([0]),
	x: new Float32Array([0]),
	y: new Float32Array([0]),
	z: new Float32Array([0]),
	scale: new Float32Array([1]),
	yawC: new Float32Array([1]),
	yawS: new Float32Array([0])
};
const impostors = createTreeImpostors(
	[
		{
			kind: 'fixture',
			model: prototype,
			bounds: new Box3(new Vector3(-0.5, -0.5, 0), new Vector3(0.5, 0.5, 0))
		}
	],
	trees,
	'low'
);
const material = impostors.object.material;
material.vertexShader = `varying vec2 vUv;varying float vTile,vDistance;varying vec3 vWorld;void main(){vUv=uv;vTile=0.;vDistance=48.;vWorld=vec3(0.);gl_Position=vec4(position.xy,0.,1.);}`;
// Only substitute the pigment/projection; the production fragment's mask and transition remain intact.
material.fragmentShader = material.fragmentShader.replace(
	'vec3 color=texel.rgb;',
	'vec3 color=vec3(0.,1.,0.);'
);
if (new URLSearchParams(location.search).has('negative'))
	material.fragmentShader = material.fragmentShader.replace('<=1.-threshold', '<threshold');
material.transparent = true;
material.blending = AdditiveBlending;
material.depthTest = material.depthWrite = false;
const far = new Mesh(geometry, material);
scene.add(far);
camera.position.z = 1;
camera.lookAt(0, 0, 0);
try {
	renderer.setSize(4, 4);
	renderer.setRenderTarget(target);
	renderer.setClearColor(0, 1);
	renderer.clear();
	renderer.render(scene, camera);
	const pixels = new Uint8Array(64);
	renderer.readRenderTargetPixels(target, 0, 0, 4, 4, pixels);
	let red = 0,
		green = 0,
		holes = 0,
		overlap = 0;
	for (let i = 0; i < pixels.length; i += 4) {
		const r = pixels[i] > 127,
			g = pixels[i + 1] > 127;
		if (r && g) overlap++;
		else if (r) red++;
		else if (g) green++;
		else holes++;
	}
	far.visible = false;
	lighting.uGameEye.value.set(0, 0, 0);
	const fade = geometry.getAttribute('instanceFade');
	fade.setX(0, 0);
	fade.needsUpdate = true;
	renderer.clear();
	renderer.render(scene, camera);
	renderer.readRenderTargetPixels(target, 0, 0, 4, 4, pixels);
	let canopyHidden = 0;
	for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 0) canopyHidden++;
	fade.setX(0, 1);
	fade.needsUpdate = true;
	renderer.clear();
	renderer.render(scene, camera);
	renderer.readRenderTargetPixels(target, 0, 0, 4, 4, pixels);
	let canopyRestored = 0;
	for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 127) canopyRestored++;
	document.body.dataset.result = JSON.stringify({ red, green, holes, overlap, canopyHidden, canopyRestored });
} finally {
	target.dispose();
	detail.dispose();
	detailMaterial.dispose();
	impostors.dispose();
	geometry.dispose();
	prototypeGeometry.dispose();
	prototypeMaterial.dispose();
	renderer.dispose();
	renderer.forceContextLoss();
}
