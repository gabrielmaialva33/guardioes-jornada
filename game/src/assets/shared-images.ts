import foliageAtlas from './skins/foliage-atlas.png?url';

/**
 * Images shared by many GLBs stay out of the GLBs: each one points at the same file with
 * an external URI ('../skins/<file>'), so the pack carries one copy. A build hashes and
 * moves both the GLBs and the image, so that relative URI would 404; the loader maps the
 * file name to the URL Vite emitted instead (and that URL is in the pack manifest).
 */
const sharedImages: Record<string, string> = {
	'foliage-atlas.png': foliageAtlas
};

/** URL modifier for GLTFLoader: shared images by file name, every other URL unchanged. */
export function resolveSharedImage(url: string): string {
	const file = url.split(/[?#]/)[0].split('/').pop() ?? '';
	return sharedImages[file] ?? url;
}
