import type { StoryAction } from '../missions/story.ts';
export function actionControl(action: StoryAction | null | undefined) {
	if (!action || action.disabled) return null;
	const id = action.id;
	const kind =
		id === 'iara'
			? 'talk'
			: id === 'logger' || id === 'inspector'
				? 'radio'
				: id.startsWith('armadilha-')
					? 'mark'
					: id.startsWith('corredor-') || id.startsWith('clareira-')
						? 'plant'
						: 'take';
	const labels = { talk: 'Falar', radio: 'Rádio', mark: 'Marcar', plant: 'Plantar', take: 'Pegar' } as const;
	const icons = { talk: 'chat', radio: 'radio', mark: 'flag', plant: 'plant', take: 'take' } as const;
	return { kind, label: labels[kind], icon: icons[kind], accessibleName: action.label };
}
export interface ControlPreferences {
	version: 1;
	leftHanded: boolean;
	largeButtons: boolean;
	hintsSeen: string[];
}
export const DEFAULT_CONTROLS: ControlPreferences = {
	version: 1,
	leftHanded: false,
	largeButtons: false,
	hintsSeen: []
};
export function decodeControls(value: unknown): ControlPreferences | null {
	if (value === null || typeof value !== 'object' || !('version' in value) || value.version !== 1)
		return null;
	return {
		version: 1,
		leftHanded: 'leftHanded' in value && value.leftHanded === true,
		largeButtons: 'largeButtons' in value && value.largeButtons === true,
		hintsSeen:
			'hintsSeen' in value && Array.isArray(value.hintsSeen)
				? value.hintsSeen.filter((v): v is string => typeof v === 'string' && v.length < 50)
				: []
	};
}
/** Runs inside the trusted touch gesture, never during rendering or under reduced motion. */
export function touchHaptic() {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	try {
		navigator.vibrate?.(12);
	} catch {
		/* Some browsers block vibration by policy. */
	}
}
