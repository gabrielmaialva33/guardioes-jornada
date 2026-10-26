import type { StoryLevel } from '../level/types.ts';
/** Runtime view of authored Act 1 data. Never changes generator data or its checksum. */
export function withAct1(level: StoryLevel): StoryLevel {
	const a = level.act1;
	if (!a || level.missions.some((m) => m.id === 0)) return level;
	return {
		...level,
		missions: [
			...level.missions.map((m) =>
				m.id === 1 ? { ...m, requires: [...new Set([...m.requires, ...a.firstRequires])] } : m
			),
			...a.missions
		].sort((a, b) => a.id - b.id),
		triggers: [...level.triggers, ...a.triggers],
		obbies: [...level.obbies, a.grotto.obby, a.canopy.obby],
		collectibles: [...level.collectibles, a.grotto.leaf, a.canopy.leaf]
	};
}
