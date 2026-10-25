// A static app: every route is prerendered as an empty shell and rendered in
// the browser, where the data (IndexedDB) lives. Directory-style URLs work
// on any static host.
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';
