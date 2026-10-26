import {
	Color,
	Group,
	InstancedMesh,
	Matrix4,
	type PerspectiveCamera,
	PlaneGeometry,
	ShaderMaterial
} from 'three';
import type { StoryLevel } from '../level/types.ts';
import { windUniforms } from '../life/wind.ts';
import { LOOK_GLSL, lookUniforms } from '../render/look.ts';
import { lighting } from '../render/stylized.ts';

/** One texture-free spray/foam batch. The falling-water mesh and its collider stay authored. */
export function createWaterfallFoam(level: StoryLevel) {
	const object = new Group(),
		geometry = new PlaneGeometry(1, 1);
	const material = new ShaderMaterial({
		uniforms: {
			uMotion: windUniforms.uWindStrength,
			uTime: lighting.uVisualTime,
			uFoam: { value: new Color('#d6eee4') },
			...lookUniforms
		},
		vertexShader: `varying vec2 vUv;varying float vLife;uniform float uTime,uMotion;void main(){vUv=uv;
float id=float(gl_InstanceID);float age=fract(uTime*.24*uMotion+id*.6180339);vLife=age;
vec4 center=instanceMatrix*vec4(0.,0.,0.,1.);center.y+=age*1.9;center.x+=sin(id*3.1+uTime*.3*uMotion)*age*.28;
vec4 mv=modelViewMatrix*center;mv.xy+=position.xy*(.85+age*1.15);gl_Position=projectionMatrix*mv;}`,
		fragmentShader: `${LOOK_GLSL}
varying vec2 vUv;varying float vLife;uniform vec3 uFoam;void main(){vec2 p=vUv-.5;float edge=1.-smoothstep(.1,.5,length(p));float alpha=edge*(1.-vLife)*.38;if(alpha<.01)discard;gl_FragColor=vec4(lookGrade(uFoam),alpha);
#include <colorspace_fragment>
}`,
		transparent: true,
		depthWrite: false
	});
	const mesh = new InstancedMesh(geometry, material, 24),
		matrix = new Matrix4();
	const fall = level.landmarks.find((p) => p.kind === 'waterfall'),
		x = fall ? fall.x - 3 : 0,
		z = fall?.z ?? 0;
	for (let i = 0; i < 24; i++) {
		const angle = i * 2.39996,
			radius = (i % 5) * 0.32;
		matrix.makeTranslation(
			x + Math.cos(angle) * radius,
			fall ? fall.y - fall.height + 0.12 : 0,
			z + Math.sin(angle) * radius * 1.7
		);
		mesh.setMatrixAt(i, matrix);
	}
	mesh.count = fall ? 24 : 0;
	mesh.frustumCulled = false;
	mesh.userData.noShadow = true;
	mesh.name = 'waterfall-spray';
	object.add(mesh);
	let disposed = false;
	return {
		object,
		update(camera: PerspectiveCamera) {
			object.visible = !!fall && (camera.position.x - x) ** 2 + (camera.position.z - z) ** 2 < 10000;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			object.removeFromParent();
			object.clear();
			mesh.dispose();
			geometry.dispose();
			material.dispose();
		}
	};
}
