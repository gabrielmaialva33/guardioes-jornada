import { CanvasTexture, NearestFilter, SRGBColorSpace } from 'three';
import type { AvatarProfile } from '../data/local-save.ts';
import { composePixels } from './atlas.ts';
import { AVATAR_ATLAS, KENNEY_SKINS } from './catalog.ts';
import { SkinUpdates } from './updates.ts';

/** One canvas/texture for this avatar's entire lifetime; never upload from the render loop. */
export function createAvatarTexture() {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 64;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('avatar-canvas-unavailable');
	context.imageSmoothingEnabled = false;
	const texture = new CanvasTexture(canvas);
	texture.flipY = false;
	texture.colorSpace = SRGBColorSpace;
	texture.minFilter = texture.magFilter = NearestFilter;
	texture.generateMipmaps = false;
	const updates = new SkinUpdates<ImageBitmap>(
		{
			classic(colors, face) {
				context.putImageData(new ImageData(composePixels(AVATAR_ATLAS, colors, face), 64, 64), 0, 0);
			},
			kenney(image) {
				context.clearRect(0, 0, 64, 64);
				context.drawImage(image, 0, 0, 64, 64);
			},
			commit() {
				texture.needsUpdate = true;
			}
		},
		async (id, signal) => {
			const url = KENNEY_SKINS[id];
			if (!url) throw new Error('kenney-skin-missing');
			const response = await fetch(url, { signal });
			if (!response.ok) throw new Error('skin-download');
			const image = await createImageBitmap(await response.blob(), {
				imageOrientation: 'none',
				premultiplyAlpha: 'none'
			});
			if (signal.aborted) {
				image.close();
				signal.throwIfAborted();
			}
			return image;
		}
	);
	return {
		texture,
		apply: (profile: AvatarProfile) => updates.apply(profile),
		dispose() {
			updates.dispose();
			texture.dispose();
		}
	};
}
