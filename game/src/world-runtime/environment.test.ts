import { expect, it } from 'vitest';
import { createLocalSave } from '../data/local-save.ts';
import { buildStoryWorld } from '../level/build.ts';
import { createMapEnvironment } from './environment.ts';

it('resumes the old mirante checkpoint under its corrected id', () => {
	const { world, level } = buildStoryWorld();
	let text: string | null = null;
	const save = createLocalSave(
		{
			style: 'classic',
			kenneySkin: 'a',
			face: 'smile',
			colors: { skin: '#8d5a3b', hair: '#2b1d14', shirt: '#2d6a4f', pants: '#4f5c55', shoes: '#5e4330' }
		},
		{
			getItem: () => text,
			setItem: (_key, value) => {
				text = value;
			}
		}
	);
	save.setCheckpoint(`story:${world.generatorVersion}:${world.checksum}`, 'mirante');
	const map = createMapEnvironment(world, level, save);
	expect(map.checkpoint.id).toBe('mirante-topo');
	map.environment.collision.dispose();
});
