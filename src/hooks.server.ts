import type { Handle } from '@sveltejs/kit';
import { immutable } from '$app/manifest';
import { resolve } from '$app/paths';

/** CSR-only pages still need these font hints in the initial HTML, not after hydration. */
export const handle: Handle = async ({ event, resolve: respond }) =>
	respond(event, {
		transformPageChunk: ({ html }) => {
			const root = new URL(resolve('/'), event.url);
			const fonts = immutable.filter(({ path }) =>
				/(?:alegreya|atkinson-hyperlegible-next)-latin-wght-normal\.[^/]+\.woff2$/.test(path)
			);
			const links = fonts
				.map(
					({ path }) =>
						`<link rel="preload" href="${new URL(path, root).pathname}" as="font" type="font/woff2" crossorigin="anonymous">`
				)
				.join('');
			return html.replace('</head>', `${links}</head>`);
		}
	});
