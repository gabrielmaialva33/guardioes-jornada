/**
 * The files the living world loads: the Cube Pets bases (the four originals and
 * the P23 species models of game/scripts/blender/models/bichos_mata.py), the
 * species attachments and the species palettes (game/src/assets, read-only
 * here). Vite turns each import into a URL; GLBs go through the injected loadGlb.
 */

import type { ModelId, SpeciesId } from '../animation/animals/index.ts';
import anta from '../assets/models/anta.glb?url';
import cachorroDoMato from '../assets/models/cachorro-do-mato.glb?url';
import capivara from '../assets/models/capivara.glb?url';
import caranguejo from '../assets/models/caranguejo.glb?url';
import cateto from '../assets/models/cateto.glb?url';
import colhereiro from '../assets/models/colhereiro.glb?url';
import bill from '../assets/models/custom-bico-tucano.glb?url';
import mane from '../assets/models/custom-juba-mico.glb?url';
import rosettes from '../assets/models/custom-rosetas-onca.glb?url';
import jabuti from '../assets/models/jabuti.glb?url';
import jacutinga from '../assets/models/jacutinga.glb?url';
import jaguatirica from '../assets/models/jaguatirica.glb?url';
import koala from '../assets/models/koala.glb?url';
import monkey from '../assets/models/monkey.glb?url';
import oncaParda from '../assets/models/onca-parda.glb?url';
import parrot from '../assets/models/parrot.glb?url';
import passaro from '../assets/models/passaro.glb?url';
import sapo from '../assets/models/sapo.glb?url';
import tapiti from '../assets/models/tapiti.glb?url';
import tatu from '../assets/models/tatu.glb?url';
import tiger from '../assets/models/tiger.glb?url';
import veado from '../assets/models/veado.glb?url';
import antaPalette from '../assets/skins/palette-anta.png?url';
import antaFilhotePalette from '../assets/skins/palette-anta-filhote.png?url';
import bugioPalette from '../assets/skins/palette-bugio-ruivo.png?url';
import cachorroPalette from '../assets/skins/palette-cachorro-do-mato.png?url';
import capivaraPalette from '../assets/skins/palette-capivara.png?url';
import caranguejoPalette from '../assets/skins/palette-caranguejo-uca.png?url';
import catetoPalette from '../assets/skins/palette-cateto.png?url';
import colhereiroPalette from '../assets/skins/palette-colhereiro.png?url';
import jabutiPalette from '../assets/skins/palette-jabuti-tinga.png?url';
import jacutingaPalette from '../assets/skins/palette-jacutinga.png?url';
import jaguatiricaPalette from '../assets/skins/palette-jaguatirica.png?url';
import micoPalette from '../assets/skins/palette-mico-leao-dourado.png?url';
import muriquiPalette from '../assets/skins/palette-muriqui.png?url';
import oncaPardaPalette from '../assets/skins/palette-onca-parda.png?url';
import oncaPalette from '../assets/skins/palette-onca-pintada.png?url';
import preguicaPalette from '../assets/skins/palette-preguica-de-coleira.png?url';
import sabiaPalette from '../assets/skins/palette-sabia-laranjeira.png?url';
import sairaPalette from '../assets/skins/palette-saira-sete-cores.png?url';
import sapoPalette from '../assets/skins/palette-sapo-cururu.png?url';
import tapitiPalette from '../assets/skins/palette-tapiti.png?url';
import tatuPalette from '../assets/skins/palette-tatu-galinha.png?url';
import tucanoPalette from '../assets/skins/palette-tucano-de-bico-verde.png?url';
import veadoPalette from '../assets/skins/palette-veado-mateiro.png?url';

export interface LifeAssetUrls {
	models: Record<ModelId, string>;
	/** Species attachment GLB, or null. */
	attachments: Record<SpeciesId, string | null>;
	palettes: Record<SpeciesId, string>;
}

export const LIFE_ASSETS: LifeAssetUrls = {
	models: {
		monkey,
		tiger,
		koala,
		parrot,
		capivara,
		anta,
		cateto,
		veado,
		'cachorro-do-mato': cachorroDoMato,
		'onca-parda': oncaParda,
		tapiti,
		jaguatirica,
		caranguejo,
		tatu,
		jabuti,
		sapo,
		passaro,
		jacutinga,
		colhereiro
	},
	// The P23 models carry their parts (the anta's trunk, the colhereiro's bill, the jaguatirica's
	// rosettes) in the model itself: no attachment.
	attachments: {
		'mico-leao-dourado': mane,
		'bugio-ruivo': null,
		muriqui: null,
		'onca-pintada': rosettes,
		'preguica-de-coleira': null,
		'tucano-de-bico-verde': bill,
		capivara: null,
		anta: null,
		'anta-filhote': null,
		cateto: null,
		'veado-mateiro': null,
		'cachorro-do-mato': null,
		'onca-parda': null,
		tapiti: null,
		jaguatirica: null,
		'caranguejo-uca': null,
		'tatu-galinha': null,
		'jabuti-tinga': null,
		'sapo-cururu': null,
		'saira-sete-cores': null,
		'sabia-laranjeira': null,
		jacutinga: null,
		colhereiro: null
	},
	palettes: {
		'mico-leao-dourado': micoPalette,
		'bugio-ruivo': bugioPalette,
		muriqui: muriquiPalette,
		'onca-pintada': oncaPalette,
		'preguica-de-coleira': preguicaPalette,
		'tucano-de-bico-verde': tucanoPalette,
		capivara: capivaraPalette,
		anta: antaPalette,
		'anta-filhote': antaFilhotePalette,
		cateto: catetoPalette,
		'veado-mateiro': veadoPalette,
		'cachorro-do-mato': cachorroPalette,
		'onca-parda': oncaPardaPalette,
		tapiti: tapitiPalette,
		jaguatirica: jaguatiricaPalette,
		'caranguejo-uca': caranguejoPalette,
		'tatu-galinha': tatuPalette,
		'jabuti-tinga': jabutiPalette,
		'sapo-cururu': sapoPalette,
		'saira-sete-cores': sairaPalette,
		'sabia-laranjeira': sabiaPalette,
		jacutinga: jacutingaPalette,
		colhereiro: colhereiroPalette
	}
};
