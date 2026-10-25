import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Character } from './character.ts';
import { buildCollisionWorld, createGraybox } from './graybox.ts';
const level = createGraybox();
const world = buildCollisionWorld(level);
it('trace', () => {
	for (const [name, mark] of [['ramp', level.marks.walkableRamp], ['step', level.marks.stepLimit]] as const) {
		const c = new Character(world, { x: mark[0], y: mark[1], z: mark[2] });
		const rows: string[] = [];
		for (let t = 0; t < 70; t++) {
			c.step(1 / 60, { moveX: 0, moveZ: 1, jumpHeld: false, faceYaw: null });
			if (t % 3 === 0 || t > 14 && t < 25) rows.push(`${t} z=${c.position.z.toFixed(4)} y=${c.position.y.toFixed(4)} x=${c.position.x.toFixed(4)} g=${c.grounded} n=${c.groundNormal.toArray().map((v) => v.toFixed(3))}`);
		}
		writeFileSync('/home/gabrielmaia/.cache/agents/2026-10-25-trilha-secreta/debug/' + name + '.txt', rows.join('\n'));
	}
});
