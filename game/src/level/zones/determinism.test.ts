import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * survival/determinism.test.ts's scan over every zone source: only operations
 * ECMA-262 defines exactly (rules in survival/random.ts). Every builder file
 * but park.ts and reserva.ts must also stay free of three.js and the level
 * builder, so a Worker can build the zones.
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
const PURE = [
	'band.ts',
	'content.ts',
	'copa.ts',
	'copa-layout.ts',
	'copa-text.ts',
	'kit.ts',
	'manguezal.ts',
	'manguezal-layout.ts',
	'manguezal-text.ts',
	'praia.ts',
	'praia-layout.ts',
	'praia-text.ts',
	'river.ts',
	'skeleton.ts',
	'spec.ts',
	'vale.ts',
	'vale-layout.ts',
	'vale-text.ts',
	'zone.ts'
];

describe('zone determinism', () => {
	it('scans every source', () => {
		expect(sources).toEqual(expect.arrayContaining([...PURE, 'park.ts', 'reserva.ts', 'index.ts']));
	});

	it.each(sources)('%s uses only exact arithmetic', (name) => {
		expect(violations(readFileSync(`${dir}/${name}`, 'utf8'))).toEqual([]);
	});

	it.each(PURE)('%s stays Worker-safe: no three.js, DOM or level builder', (name) => {
		const code = readFileSync(`${dir}/${name}`, 'utf8');
		expect(code).not.toMatch(/from '(three|svelte)/);
		expect(code).not.toMatch(/from '\.\.\/(build|layout)\.ts'/);
		expect(code).not.toMatch(/from '\.\/(park|reserva)\.ts'/);
		expect(code).not.toMatch(/\b(document|window|localStorage)\b/);
	});
});
