/**
 * LOCAL-ONLY Green Hell study mode: `http://localhost:5196/?debug&estudo=greenhell`
 * (`&look=raw|painted`). The owner's extraction stays in the git-ignored
 * `tmp/greenhell-port/` and reaches the page only through the dev middleware
 * (game/study-dev.ts). Report: ~/.cache/agents/2026-10-25-trilha-secreta/p14-estudo-greenhell.md.
 *
 * Shared API (P15 sound and P16 vegetation import it; keep it stable):
 * - `studyEnabled()`, `studyLook()`, `studyUrl(path)` (gate.ts);
 * - `stylizeModel(model, look)` (stylize.ts);
 * - `studyCatalog` and its typed parts (catalog.ts).
 *
 * Gate every use as `import.meta.env.DEV && studyEnabled()` so builds drop it.
 */
import type { StudyFauna, StudyFaunaHost } from './fauna.ts';
import { studyEnabled } from './gate.ts';

export {
	clipKey,
	STUDY_ANIMALS,
	STUDY_PLANTS,
	STUDY_SOUNDS,
	STUDY_TERRAIN,
	type StudyAnimal,
	type StudyClipRoles,
	type StudyFit,
	type StudyItem,
	type StudyPlant,
	type StudyPlantRole,
	type StudySoundGroup,
	type StudySoundRole,
	type StudyTerrainRole,
	type StudyTerrainTexture,
	studyAnimal,
	studyCatalog
} from './catalog.ts';
export type { StudyFauna, StudyFaunaDebug, StudyFaunaHost, StudyFrame } from './fauna.ts';
export { STUDY_PREFIX, type StudyLook, studyEnabled, studyLook, studyUrl } from './gate.ts';
export {
	PAINTED_MAX_SIZE,
	posterizePixels,
	type StylizedModel,
	type StylizeOptions,
	stylizeModel
} from './stylize.ts';

/**
 * The study entry the living world calls: null (and nothing loaded) unless this
 * is the dev server with `?estudo=greenhell`. Otherwise it returns the study
 * fauna at once; its models stream in through the dev middleware and join the
 * host's group when ready.
 */
export function startStudy(host: StudyFaunaHost, search?: string): StudyFauna | null {
	if (!import.meta.env.DEV) return null;
	if (!studyEnabled(search)) return null;
	return createStudyFauna(host);
}

/** Loaded lazily so the entry stays cheap; the fauna module pulls in GLTFLoader and SkeletonUtils. */
function createStudyFauna(host: StudyFaunaHost): StudyFauna {
	let fauna: StudyFauna | null = null;
	let disposed = false;
	const pending: StudyFauna = {
		update(frame) {
			fauna?.update(frame);
		},
		debug() {
			return fauna?.debug() ?? null;
		},
		dispose() {
			disposed = true;
			fauna?.dispose();
			fauna = null;
		}
	};
	void import('./fauna.ts')
		.then(({ StudyFaunaRuntime }) => {
			if (disposed) return;
			fauna = new StudyFaunaRuntime(host);
		})
		.catch((error: unknown) => console.warn('[estudo] study fauna failed to start', error));
	return pending;
}
