export interface BuildAsset {
	file: string;
	isEntry?: boolean;
	isDynamicEntry?: boolean;
	imports?: string[];
	dynamicImports?: string[];
	css?: string[];
	assets?: string[];
}

/** All route entry points, but only their static dependency graph. */
export function shellFiles(manifest: Record<string, BuildAsset>): string[] {
	const files = new Set<string>();
	const visited = new Set<string>();
	function visit(key: string) {
		if (visited.has(key)) return;
		visited.add(key);
		const entry = manifest[key];
		if (!entry) throw new Error(`Missing offline shell dependency: ${key}`);
		files.add(entry.file);
		for (const css of entry.css ?? []) files.add(css);
		for (const asset of entry.assets ?? []) {
			// Regular Latin faces are used above the fold; italic/other subsets stay lazy.
			if (!/\.woff2?$/.test(asset) || /-latin-wght-normal[.]/.test(asset)) files.add(asset);
		}
		for (const dependency of entry.imports ?? []) visit(dependency);
	}
	for (const [key, entry] of Object.entries(manifest)) if (entry.isEntry) visit(key);
	return [...files].sort();
}
