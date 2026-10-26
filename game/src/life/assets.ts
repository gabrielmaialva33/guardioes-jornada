/**
 * The files the living world loads: the four Cube Pets bases, the species
 * attachments and the species palettes (game/src/assets, read-only here).
 * Vite turns each import into a URL; GLBs go through the injected loadGlb.
 */

import type { ModelId, SpeciesId } from '../animation/animals/index.ts';
import bill from '../assets/models/custom-bico-tucano.glb?url';
import mane from '../assets/models/custom-juba-mico.glb?url';
import rosettes from '../assets/models/custom-rosetas-onca.glb?url';
import koala from '../assets/models/koala.glb?url';
import monkey from '../assets/models/monkey.glb?url';
import parrot from '../assets/models/parrot.glb?url';
import tiger from '../assets/models/tiger.glb?url';
import bugioPalette from '../assets/skins/palette-bugio-ruivo.png?url';
import micoPalette from '../assets/skins/palette-mico-leao-dourado.png?url';
import muriquiPalette from '../assets/skins/palette-muriqui.png?url';
import oncaPalette from '../assets/skins/palette-onca-pintada.png?url';
import preguicaPalette from '../assets/skins/palette-preguica-de-coleira.png?url';
import tucanoPalette from '../assets/skins/palette-tucano-de-bico-verde.png?url';

export interface LifeAssetUrls {
	models: Record<ModelId, string>;
	/** Species attachment GLB, or null. */
	attachments: Record<SpeciesId, string | null>;
	palettes: Record<SpeciesId, string>;
}

export const LIFE_ASSETS: LifeAssetUrls = {
	models: { monkey, tiger, koala, parrot },
	attachments: {
		'mico-leao-dourado': mane,
		'bugio-ruivo': null,
		muriqui: null,
		'onca-pintada': rosettes,
		'preguica-de-coleira': null,
		'tucano-de-bico-verde': bill
	},
	palettes: {
		'mico-leao-dourado': micoPalette,
		'bugio-ruivo': bugioPalette,
		muriqui: muriquiPalette,
		'onca-pintada': oncaPalette,
		'preguica-de-coleira': preguicaPalette,
		'tucano-de-bico-verde': tucanoPalette
	}
};
