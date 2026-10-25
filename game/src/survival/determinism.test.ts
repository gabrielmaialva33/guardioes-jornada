import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The generator may only use operations ECMA-262 defines exactly (rules in
 * random.ts). Math.floor is exact too but was not measured by the research,
 * so it is banned with the rest; noise.ts has its own floor.
 */
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

describe('generator determinism', () => {
	it('scans every generator source', () => {
		expect(sources).toEqual(
			expect.arrayContaining([
				'generate.ts',
				'noise.ts',
				'poisson.ts',
				'random.ts',
				'terrain.ts',
				'checksum.ts'
			])
		);
	});

	it.each(sources)('%s uses only exact arithmetic', (name) => {
		expect(violations(readFileSync(`${dir}/${name}`, 'utf8'))).toEqual([]);
	});

	it('catches what it bans', () => {
		const sample = 'const a = Math.sin(t) + Math.floor(x) + y ** 2 + Math.random(); // Math.cos in a comment';
		expect(violations(sample)).toEqual(['Math.sin', 'Math.floor', 'Math.random', '\\*\\*']);
		expect(
			violations('Math.hypot(1, 2); Math.atan2(1, 2); Math.exp(1); Math.log(2); Math.pow(2, 3)')
		).toHaveLength(5);
		expect(violations('/** Math.tan */ Math.sqrt(2) * Math.imul(3, 4)')).toEqual([]);
	});
});
