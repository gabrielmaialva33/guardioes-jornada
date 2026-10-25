/**
 * Stable 32-bit checksum of a generated world: a murmur3-style walk over its
 * canonical content (numbers as their exact float bits, typed arrays element
 * by element, objects in key order). Two engines agree on it exactly when they
 * built the same map, which is what saves and the golden tests check.
 */
import { mix32 } from './random.ts';

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

	value(value: unknown, skip: string) {
		if (typeof value === 'number') this.number(value);
		else if (typeof value === 'string') {
			this.word(value.length);
			for (let k = 0; k < value.length; k++) this.word(value.charCodeAt(k));
		} else if (typeof value === 'boolean') this.word(value ? 1 : 2);
		else if (value instanceof Float32Array) {
			// Same-width views read the float bits on any endianness.
			const bits = new Uint32Array(value.buffer, value.byteOffset, value.length);
			this.word(bits.length);
			for (let k = 0; k < bits.length; k++) this.word(bits[k]);
		} else if (value instanceof Uint8Array || value instanceof Int16Array || value instanceof Int32Array) {
			this.word(value.length);
			for (let k = 0; k < value.length; k++) this.word(value[k]);
		} else if (Array.isArray(value)) {
			this.word(value.length);
			for (const item of value) this.value(item, skip);
		} else if (value !== null && typeof value === 'object') {
			for (const key of Object.keys(value)) {
				if (key === skip) continue;
				this.value(key, skip);
				this.value((value as Record<string, unknown>)[key], skip);
			}
		} else this.word(0);
	}
}

/** Checksum of any plain value, leaving out properties named `skip` (the stored checksum). */
export function checksumOf(value: unknown, skip = 'checksum'): number {
	const hasher = new Hasher();
	hasher.value(value, skip);
	return mix32(hasher.h ^ hasher.words);
}
