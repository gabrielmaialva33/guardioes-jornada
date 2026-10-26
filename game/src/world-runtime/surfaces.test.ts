import { ShaderLib, UniformsUtils } from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { patchStylizedShader, type ShaderSource } from '../render/stylized.ts';
import { createSurfaces } from './surfaces.ts';

afterEach(() => vi.unstubAllGlobals());
function source(): ShaderSource {
	return {
		vertexShader: ShaderLib.lambert.vertexShader,
		fragmentShader: ShaderLib.lambert.fragmentShader,
		uniforms: UniformsUtils.clone(ShaderLib.lambert.uniforms)
	};
}
it('shares one bounded atlas across materials and disposes it once', async () => {
	const close = vi.fn(),
		pixels = new Uint8ClampedArray(128 * 128 * 4).fill(150);
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }));
	vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ close }));
	vi.stubGlobal('document', {
		createElement: () => ({
			getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: pixels }) })
		})
	});
	const surfaces = createSurfaces(),
		ground = source(),
		trail = source();
	patchStylizedShader(ground, { terrain: true });
	patchStylizedShader(trail);
	surfaces.patch(ground, 'ground');
	surfaces.patch(trail, 'trail');
	await surfaces.load(new AbortController().signal);
	const texture = ground.uniforms.uGroundAtlas.value;
	expect(texture).toBe(trail.uniforms.uGroundAtlas.value);
	expect(surfaces.textures).toEqual([texture]);
	expect(texture.image.width).toBe(128);
	expect(ground.uniforms.uGroundDetail.value).toBe(1);
	const dispose = vi.spyOn(texture, 'dispose');
	surfaces.dispose();
	surfaces.dispose();
	expect(dispose).toHaveBeenCalledOnce();
	expect(surfaces.textures).toEqual([]);
	expect(close).toHaveBeenCalledOnce();
});
it('closes late decoded data after disposal without resurrecting a texture', async () => {
	let finish: (image: { close: () => void }) => void = () => {};
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }));
	const decode = vi.fn(
		() =>
			new Promise<{ close: () => void }>((resolve) => {
				finish = resolve;
			})
	);
	vi.stubGlobal('createImageBitmap', decode);
	const surfaces = createSurfaces(),
		shader = source();
	surfaces.patch(shader, 'ground');
	const loading = surfaces.load(new AbortController().signal);
	await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
	surfaces.dispose();
	const close = vi.fn();
	finish({ close });
	await loading;
	expect(close).toHaveBeenCalledOnce();
	expect(shader.uniforms.uGroundAtlas.value).toBeNull();
});
