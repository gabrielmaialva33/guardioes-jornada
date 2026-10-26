/**
 * The game's sound: native WebAudio, six buses (master, music, ambience with
 * animals under it, sfx, ui), at most 16 voices, cheap equal-power spatial
 * audio, recorded files (Opus/AAC in src/assets/audio) and a procedural
 * placeholder for every sound that has no file or fails to decode.
 *
 * Wiring (owned by the scene code, see p6-audio-engine.md):
 * 1. `const audio = createGameAudio({ settings: saved, onSettingsChange: save })`
 *    at mount; `audio.preload('essential')` behind the loading screen, then
 *    `audio.preload('nature')` once the first frame is up (c-audio.md §3.7).
 * 2. Unlocking is automatic on the first tap or key; `audio.unlock()` may also
 *    be called from a "Tocar" button's handler.
 * 3. Per frame, after the camera moved: `audio.setListener(camera)`; when
 *    `animator.footstep` is set: `audio.footstep(surfaceUnderFeet, { foot })`.
 * 4. Events: `audio.play('jump')`, `audio.play('splash', position)`, …; beds:
 *    `const bed = audio.loop('forest-day')`, the river with `loop('river', p)`
 *    and `setPosition` to the nearest bank point, `loop('waterfall', p)` at the
 *    landmark, `loop('chainsaw', p)` during mission 2; animals:
 *    `audio.play('howler', treePosition)`.
 * 5. Dialogue, radio (`radio-call`), mission complete and badge:
 *    `const release = audio.duck(); … release()`.
 * 6. Unmount: `await audio.dispose()`.
 */
export {
	BUS_PARENT,
	BUSES,
	type Bus,
	type Category,
	CODEC_TYPES,
	type Codec,
	codecOrder,
	recordedFiles,
	SOUND_IDS,
	SOUNDS,
	type SoundBank,
	type SoundDef,
	type SoundFiles,
	type SoundId,
	type Spatial,
	STEP_SOUND,
	SURFACES,
	type Surface
} from './bank.ts';
export {
	type AudioSettings,
	type AudioState,
	createGameAudio,
	DEFAULT_SETTINGS,
	type DuckOptions,
	type FootstepOptions,
	type GameAudio,
	type GameAudioOptions,
	type ListenerSource,
	type LoopHandle,
	type LoopOptions,
	MAX_VOICES,
	type PlayOptions,
	type Position,
	type Voice
} from './engine.ts';
export { renderPlaceholder, SYNTH_RATE, SYNTH_VARIANTS } from './synth.ts';
