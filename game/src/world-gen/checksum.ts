/**
 * Stable 32-bit checksum of a chunk: survival/checksum.ts's murmur3-style
 * walk, over the chunk's fields in a fixed order, with byte arrays read four
 * bytes per word (assembled little-endian by hand, so endianness never
 * matters) and float arrays by their bits. survival's checksumOf takes one
 * word per byte and spent a fifth of a chunk's time on the biome weights.
 */
import { mix32 } from '../survival/random.ts';
import type { CollisionBlock, Placements } from '../survival/types.ts';
import type { WorldChunk } from './chunk.ts';

const scratch = new DataView(new ArrayBuffer(8));

class Hasher {
	h = 0x2545f491;
	words = 0;

	word(value: number) {
		let k = Math.imul(value | 0, 0xcc9e2d51);
		k = (k << 15) | (k >>> 17);
		k = Math.imul(k, 0x1b873593);
		let h = this.h ^ k;
		h = (h << 13) | (h >>> 19);
		this.h = (Math.imul(h, 5) + 0xe6546b64) | 0;
		this.words++;
	}

	number(value: number) {
		scratch.setFloat64(0, value, true);
		this.word(scratch.getUint32(0, true));
		this.word(scratch.getUint32(4, true));
	}

	bytes(a: Uint8Array) {
		this.word(a.length);
		const n = a.length & ~3;
		let k = 0;
		for (; k < n; k += 4) this.word(a[k] | (a[k + 1] << 8) | (a[k + 2] << 16) | (a[k + 3] << 24));
		let tail = 0;
		for (let s = 0; k < a.length; k++, s += 8) tail |= a[k] << s;
		this.word(tail);
	}

	floats(a: Float32Array) {
		// Same-width view: the float bits on any endianness.
		const bits = new Uint32Array(a.buffer, a.byteOffset, a.length);
		this.word(bits.length);
		for (let k = 0; k < bits.length; k++) this.word(bits[k]);
	}

	ints(a: Int32Array) {
		this.word(a.length);
		for (let k = 0; k < a.length; k++) this.word(a[k]);
	}

	placements(p: Placements<string>) {
		this.word(p.count);
		this.word(p.kinds.length);
		this.bytes(p.kind);
		this.bytes(p.block);
		for (const a of [p.x, p.y, p.z, p.scale, p.yawC, p.yawS]) this.floats(a);
	}

	collision(c: CollisionBlock) {
		for (const v of [c.index, c.bx, c.bz, c.x0, c.z0, c.minY, c.maxY]) this.number(v);
		for (const a of [c.heights, c.cylinders, c.boxes, c.decks]) this.floats(a);
	}
}

/**
 * Checksum of everything in a chunk but its `checksum` and its `apron`: the
 * apron repeats the neighbours' heights (borders.test.ts checks it bit for
 * bit), so it adds no generator path of its own.
 */
export function chunkChecksum(c: WorldChunk): number {
	const hasher = new Hasher();
	for (const v of [c.macroVersion, c.detailVersion, c.seed, c.cx, c.cz, c.x0, c.z0, c.size, c.grid])
		hasher.number(v);
	hasher.word(c.handMade ? 1 : 2);
	hasher.number(c.waterLevel);
	hasher.floats(c.heights);
	hasher.bytes(c.zones);
	hasher.bytes(c.flags);
	hasher.bytes(c.biome);
	hasher.bytes(c.biomeWeights);
	hasher.floats(c.rivers);
	hasher.ints(c.riverIds);
	hasher.bytes(c.riverFlags);
	hasher.placements(c.trees);
	hasher.placements(c.rocks);
	hasher.placements(c.decorations);
	hasher.collision(c.collision);
	return mix32(hasher.h ^ hasher.words);
}
