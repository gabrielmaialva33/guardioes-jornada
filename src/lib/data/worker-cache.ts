export function cachePrefix(base: string): string {
	return `guardioes-${encodeURIComponent(base || 'root')}-`;
}
/** CacheStorage ordering is creation order. Retain the previous deployed build. */
export function obsoleteCaches(names: string[], prefix: string, current: string): string[] {
	const own = names.filter((name) => name.startsWith(prefix) && name !== current);
	return own.filter((name) => name !== own.at(-1));
}
export async function previousAsset(
	storage: CacheStorage,
	prefix: string,
	current: string,
	pathname: string
): Promise<Response | undefined> {
	for (const name of (await storage.keys())
		.filter((name) => name.startsWith(prefix) && name !== current)
		.reverse()) {
		const response = await (await storage.open(name)).match(pathname);
		if (response) return response;
	}
	return undefined;
}
