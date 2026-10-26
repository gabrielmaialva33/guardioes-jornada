import { ShaderChunk } from 'three';
import type { ShaderSource } from './stylized.ts';

/** Keep the authored MASK=.5, but integrate its minified edge instead of a hard row of texels. */
export function patchLeafCoverage(shader: ShaderSource) {
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <normal_fragment_begin>',
		ShaderChunk.normal_fragment_begin.replace(
			'normal *= faceDirection;',
			'// Volume normals describe the whole crown, not a paper card: back-face inversion creates dark bands.'
		)
	);
	shader.fragmentShader = shader.fragmentShader.replace(
		'#include <alphatest_fragment>',
		ShaderChunk.alphatest_fragment.replace(
			'if ( diffuseColor.a < alphaTest ) discard;',
			`float leafWidth=max(fwidth(diffuseColor.a),.001);
		float leafCoverage=smoothstep(alphaTest-leafWidth*.5,alphaTest+leafWidth*.5,diffuseColor.a);
		float leafThreshold=fract(dot(floor(gl_FragCoord.xy),vec2(.75487766,.56984029)));
		if(leafCoverage<=leafThreshold)discard;`
		)
	);
}
