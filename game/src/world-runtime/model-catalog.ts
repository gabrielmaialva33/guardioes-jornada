import araucaria from '../assets/models/custom-araucaria.glb?url';
import bromelia from '../assets/models/custom-bromelia.glb?url';
import bromeliaRed from '../assets/models/custom-bromelia-centro-vermelho.glb?url';
import embauba from '../assets/models/custom-embauba.glb?url';
import xaxim from '../assets/models/custom-xaxim.glb?url';
export const TREE_MODELS: Record<string, string> = { araucaria, embauba, xaxim };
export const TREE_NODES: Record<string, string> = {
	'ipe-amarelo': 'tree-ipe-amarelo',
	'ipe-rosa': 'tree-ipe-rosa',
	'pau-brasil': 'tree-pau-brasil',
	jequitiba: 'tree-jequitiba-rosa',
	jeriva: 'tree-jeriva',
	jucara: 'tree-palmeira-jucara',
	'mangue-vermelho': 'tree-mangue-vermelho'
};
const files = import.meta.glob<string>(
	[
		'../assets/models/trees/*.glb',
		'../assets/models/decor/understorey-*.glb',
		'../assets/models/decor/rock-polyone-01.glb',
		'../assets/models/decor/rock-polyone-02.glb',
		'../assets/models/decor/rock-polyone-03.glb',
		'../assets/models/decor/rock-polyone-04.glb',
		'../assets/models/decor/rock-polyone-06.glb',
		'../assets/models/decor/rock-polyone-11.glb',
		'../assets/models/decor/rock-cliff-*.glb',
		'../assets/models/decor/rock-deadzik-1.glb',
		'../assets/models/decor/ground-*.glb'
	],
	{ eager: true, query: '?url', import: 'default' }
);
export const MODEL_FILES: Record<string, string> = Object.fromEntries(
	Object.entries(files).map(([p, url]) => [p.split('/').pop()?.replace('.glb', ''), url])
);
MODEL_FILES.bromelia = bromelia;
MODEL_FILES['bromelia-red'] = bromeliaRed;
export function coverScale(kind: string) {
	return kind.includes('taioba')
		? 0.75
		: kind.includes('heliconia')
			? 0.6
			: kind.includes('monstera')
				? 0.65
				: kind.includes('palm-a')
					? 0.5
					: kind.includes('sand-foliage')
						? 0.7
						: kind.includes('bush')
							? 0.8
							: 1;
}
