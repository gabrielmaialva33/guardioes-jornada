import type { Point } from '../survival/types.ts';
import type { StoryGame } from './story.ts';
export function storyView(game: StoryGame, feet: Point) {
	return {
		revision: game.revision,
		dialogue: game.dialogue,
		notice: game.notice,
		saveError: game.saveError,
		readOnlySave: game.readOnlySave,
		finished: game.finished,
		started: game.data.started,
		seeds: game.seeds,
		seedlings: game.seedlings,
		trash: game.trash,
		leaves: game.leaves,
		selected: game.data.selected,
		action: game.context(feet),
		missions: game.level.missions.map((m) => ({
			id: m.id,
			name: m.name,
			progress: game.progress(m.id),
			count: m.count,
			available: game.available(m.id),
			completed: game.completed(m.id)
		}))
	};
}
export type StoryView = ReturnType<typeof storyView>;
