import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The same scan as survival/determinism.test.ts, over the story map builder: exact arithmetic only. */
const ALLOWED_MATH = new Set(['imul', 'sqrt', 'abs', 'min', 'max']);
const BANNED = [
	/\*\*/,
	/\bDate\.now\b/,
	/\bnew Date\(\s*\)/,
	/\bperformance\b/,
	/\bIntl\b/,
	/\btoLocale\w*/,
	/\bcrypto\b/
];

function violations(source: string): string[] {
	const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	const found: string[] = [];
	for (const match of code.matchAll(/\bMath\s*\.\s*([A-Za-z_$][\w$]*)/g))
		if (!ALLOWED_MATH.has(match[1])) found.push(`Math.${match[1]}`);
	for (const pattern of BANNED) if (pattern.test(code)) found.push(pattern.source);
	return found;
}

const dir = fileURLToPath(new URL('.', import.meta.url));
const sources = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

describe('story map determinism', () => {
	it('scans every builder source', () => {
		expect(sources).toEqual(
			expect.arrayContaining(['build.ts', 'geometry.ts', 'layout.ts', 'reach.ts', 'types.ts'])
		);
	});

	it.each(sources)('%s uses only exact arithmetic', (name) => {
		expect(violations(readFileSync(`${dir}/${name}`, 'utf8'))).toEqual([]);
	});

	it('catches what it bans', () => {
		expect(violations('Math.random() + Math.cos(1) + Math.PI + 2 ** 3')).toEqual([
			'Math.random',
			'Math.cos',
			'Math.PI',
			'\\*\\*'
		]);
	});
});
