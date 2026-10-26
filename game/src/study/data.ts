/**
 * Runtime asset data of the LOCAL-ONLY Green Hell study mode. game/study-dev.ts
 * builds it on the dev server from `tmp/greenhell-port/` (conversion-manifest.json,
 * the GLB headers, the audio and terrain folders, and the P14 curation in
 * `study-cache/curation.json`) and serves it at `/__estudo/greenhell/catalog.json`.
 * Per-asset data (paths, sizes, tris, clips) lives only there, never in the repo.
 * DEV only, behind the study gate (gate.ts).
 */
import { studyUrl } from './gate.ts';

export type StudyFit = 'pick' | 'existing' | 'maybe' | 'out';

export interface StudyImage {
	name: string;
	width: number;
	height: number;
}

interface StudyCurated {
	/** P14's rating for the Mata Atlântica, when curated. */
	fit?: StudyFit;
	why?: string;
}

export interface StudyAssetAnimal extends StudyCurated {
	kind: 'animal';
	id: string;
	/** pt-BR name, when curated. */
	name?: string;
	path: string;
	bytes: number;
	tris: number;
	meshes: number;
	joints: number;
	textures: StudyImage[];
	/** Clip keys (clipKey of the glTF animation names), unique, in file order. */
	clips: string[];
}

export interface StudyAssetPlant extends StudyCurated {
	kind: 'plant';
	id: string;
	path: string;
	bytes: number;
	/** Every mesh in the file, its shadow-caster meshes included. */
	tris: number;
	meshes: number;
	/** Materials named `*_caster`: shadow-only meshes to hide. */
	casters: number;
	textures: StudyImage[];
	role?: string;
}

export interface StudySoundGroup extends StudyCurated {
	kind: 'sound';
	id: string;
	role: string;
	/** The animal id the calls belong to. */
	animal?: string;
	note: string;
	/** WebM/Opus paths; each has an `.m4a` twin with the same stem. */
	files: string[];
}

export interface StudyTerrainTexture {
	kind: 'terrain';
	id: string;
	path: string;
	bytes: number;
	width: number;
	height: number;
	role: 'albedo' | 'normal' | 'splatmap' | 'heightmap';
	/** The ground layer (stem without the id prefix and `_N`). */
	layer: string;
}

export interface StudyCatalog {
	generatedAt: string;
	/** conversion-manifest.json jobs it was built from. */
	jobs: number;
	animals: StudyAssetAnimal[];
	plants: StudyAssetPlant[];
	sounds: StudySoundGroup[];
	terrain: StudyTerrainTexture[];
}

/** The clip's own name from a glTF animation name: `Armature|…|clip|Base Layer` gives `clip`. */
export function clipKey(name: string): string {
	const parts = name.split('|');
	return parts.length >= 3 ? parts[parts.length - 2] : name;
}

let pending: Promise<StudyCatalog> | null = null;

/** Fetch the served catalog once per page (a failed fetch is retried on the next call). */
export function loadStudyCatalog(signal?: AbortSignal): Promise<StudyCatalog> {
	pending ??= (async () => {
		const response = await fetch(studyUrl('catalog.json'), { signal, cache: 'no-store' });
		if (!response.ok) throw new Error(`study catalog: ${response.status}`);
		const catalog = (await response.json()) as StudyCatalog;
		if (!Array.isArray(catalog.animals) || !Array.isArray(catalog.plants))
			throw new Error('study catalog: bad shape');
		return catalog;
	})();
	pending.catch(() => {
		pending = null;
	});
	return pending;
}
