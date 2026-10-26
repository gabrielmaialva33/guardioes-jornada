/** Event-free, allocation-free bridge. Refill after readCharacter and before animator.update. */
import type { AvatarInput } from '../animation/avatar-animator.ts';
import type { Canoe } from './canoe.ts';
import type { Ladder } from './ladder.ts';
import type { ParkTraversal } from './traversal.ts';
import type { Zipline } from './zipline.ts';
export function readTraversal(
	input: AvatarInput,
	traversal: ParkTraversal,
	paddleSide: -1 | 1 = 1
): AvatarInput {
	input.climbing = input.hanging = input.rowing = input.sitting = false;
	input.ziplineSpeed = input.canoeStroke = input.canoeSpeed = input.ladderRungSpacing = 0;
	input.ladderDistance = undefined;
	input.paddleSide = paddleSide;
	const active = traversal.active;
	if (!active) return input;
	if (traversal.mode === 'ladder') {
		const ladder = active as Ladder;
		input.climbing = true;
		input.ladderRungSpacing = ladder.rungSpacing;
		input.ladderDistance = ladder.position.y - ladder.spec.base.y - ladder.rungOffset;
	} else if (traversal.mode === 'zipline') {
		input.hanging = true;
		input.ziplineSpeed = (active as Zipline).speed;
	} else if (traversal.mode === 'canoe') {
		const canoe = active as Canoe;
		input.rowing = input.sitting = true;
		input.canoeStroke = canoe.stroke;
		input.canoeSpeed = canoe.speed;
	}
	return input;
}
