import { play, type Sound } from './sound.ts';
import { preferences } from './state/preferences.svelte.ts';

/** Tap feedback: a sound (if enabled in preferences) and an optional short buzz. */
export function feedback(sound: Sound, vibrateMs = 0) {
	if (preferences.sound) play(sound);
	if (vibrateMs) navigator.vibrate?.(vibrateMs);
}
