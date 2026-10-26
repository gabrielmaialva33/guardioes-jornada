import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The same scan as survival/determinism.test.ts over every world-gen source:
 * only operations ECMA-262 defines exactly (rules in survival/random.ts).
 * worker.ts is the one exception, for the clock of the timing it reports; it
 * may use `performance` and nothing else on the list.
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
const CLOCK = new Set(['worker.ts']);

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

describe('world-gen determinism', () => {
	it('scans every source', () => {
		expect(sources).toEqual(
			expect.arrayContaining([
				'biomes.ts',
				'checksum.ts',
				'chunk.ts',
				'client.ts',
				'constants.ts',
				'hash.ts',
				'host.ts',
				'macro.ts',
				'math.ts',
				'protocol.ts',
				'rivers.ts',
				'scatter.ts',
				'worker.ts'
			])
		);
	});

	it.each(sources.filter((name) => !CLOCK.has(name)))('%s uses only exact arithmetic', (name) => {
		expect(violations(readFileSync(`${dir}/${name}`, 'utf8'))).toEqual([]);
	});

	it('lets worker.ts read the clock and nothing else', () => {
		expect(violations(readFileSync(`${dir}/worker.ts`, 'utf8'))).toEqual(['\\bperformance\\b']);
	});

	it('keeps the generator free of three.js, the DOM and the level', () => {
		for (const name of sources.filter((n) => n !== 'client.ts' && n !== 'worker.ts')) {
			const code = readFileSync(`${dir}/${name}`, 'utf8');
			expect(code, name).not.toMatch(/from '(three|svelte)/);
			expect(code, name).not.toMatch(/from '\.\.\/(level|render|scene|engine|world-runtime)\//);
			expect(code, name).not.toMatch(/\b(document|window|localStorage)\b/);
		}
	});

	it('catches what it bans', () => {
		const sample = 'const a = Math.sin(t) + Math.floor(x) + y ** 2 + Math.random(); // Math.cos in a comment';
		expect(violations(sample)).toEqual(['Math.sin', 'Math.floor', 'Math.random', '\\*\\*']);
		expect(violations('/** Math.tan */ Math.sqrt(2) * Math.imul(3, 4)')).toEqual([]);
	});
});
