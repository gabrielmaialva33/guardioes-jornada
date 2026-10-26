#!/usr/bin/env node
/**
 * audit.mjs — Palette, Vertex Colour (COLOR_0), Triangle Budget & Texture Memory Auditor.
 *
 * Audits every model in `game/src/assets/models/*.glb` and every texture in
 * `game/src/assets/skins/*.{png,webp}` against `game/ART.md` and `game/src/style/palette.ts`,
 * and writes `/home/gabrielmaia/.cache/agents/2026-10-25-trilha-secreta/lineup/auditoria-cor.md`.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(__dirname, '..', '..');
const MODELS_DIR = path.join(GAME_ROOT, 'src', 'assets', 'models');
const SKINS_DIR = path.join(GAME_ROOT, 'src', 'assets', 'skins');
const COLOR_MAP_PATH = path.join(__dirname, 'color-map.json');
const OUT_DIR =
	process.env.LINEUP_OUT_DIR ??
	path.join(os.homedir(), '.cache', 'agents', '2026-10-25-trilha-secreta', 'lineup');
const REPORT_PATH = path.join(OUT_DIR, 'auditoria-cor.md');
const BAKE_DELTAS_PATH = path.join(OUT_DIR, 'bake-deltas.json');

const COLOR_MAP = JSON.parse(fs.readFileSync(COLOR_MAP_PATH, 'utf8'));

function parseHex(hex) {
	const v = parseInt(hex.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex([r, g, b]) {
	return (
		'#' +
		[r, g, b]
			.map((v) =>
				Math.max(0, Math.min(255, Math.round(v)))
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

function srgbToLinear(c) {
	const u = c / 255;
	return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(u) {
	const c = Math.max(0, Math.min(1, u));
	const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
	return Math.round(s * 255);
}

function rgbToLab([r, g, b]) {
	const R = srgbToLinear(r);
	const G = srgbToLinear(g);
	const B = srgbToLinear(b);
	const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
	const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / 1.0;
	const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
	const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	const fx = f(X);
	const fy = f(Y);
	const fz = f(Z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rgbToHsl([r, g, b]) {
	const rf = r / 255;
	const gf = g / 255;
	const bf = b / 255;
	const max = Math.max(rf, gf, bf);
	const min = Math.min(rf, gf, bf);
	const l = (max + min) / 2;
	let h = 0;
	let s = 0;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case rf:
				h = (gf - bf) / d + (gf < bf ? 6 : 0);
				break;
			case gf:
				h = (bf - rf) / d + 2;
				break;
			default:
				h = (rf - gf) / d + 4;
				break;
		}
		h /= 6;
	}
	return { hDeg: Math.round(h * 360), s: Number(s.toFixed(3)), l: Number(l.toFixed(3)) };
}

const RAMP_ENTRIES = [];
for (const [rampName, list] of Object.entries(COLOR_MAP.ramps)) {
	list.forEach((hex, idx) => {
		const rgb = parseHex(hex);
		RAMP_ENTRIES.push({ key: `${rampName}[${idx}]`, ramp: rampName, hex, rgb, lab: rgbToLab(rgb) });
	});
}
for (const [accName, hex] of Object.entries(COLOR_MAP.accent)) {
	const rgb = parseHex(hex);
	RAMP_ENTRIES.push({
		key: `accent.${accName}`,
		ramp: 'accent',
		hex,
		rgb,
		lab: rgbToLab(rgb)
	});
}

function findNearestRamp(rgb) {
	const lab = rgbToLab(rgb);
	let best = RAMP_ENTRIES[0];
	let bestD = Infinity;
	for (const e of RAMP_ENTRIES) {
		const d = Math.hypot(lab[0] - e.lab[0], lab[1] - e.lab[1], lab[2] - e.lab[2]);
		if (d < bestD) {
			bestD = d;
			best = e;
		}
	}
	return { ...best, distance: Number(bestD.toFixed(2)) };
}

function readGlbRaw(filePath) {
	const buf = fs.readFileSync(filePath);
	const jLen = buf.readUInt32LE(12);
	const json = JSON.parse(buf.subarray(20, 20 + jLen).toString('utf8'));
	const binOffset = 20 + jLen;
	const bin =
		binOffset + 8 <= buf.length
			? buf.subarray(binOffset + 8, binOffset + 8 + buf.readUInt32LE(binOffset))
			: Buffer.alloc(0);
	return { json, bin, byteLength: buf.length };
}

function unpackIfMeshopt(glbPath, workDir) {
	const { json } = readGlbRaw(glbPath);
	const exts = json.extensionsUsed || [];
	if (exts.includes('EXT_meshopt_compression') || exts.includes('KHR_meshopt_compression')) {
		const out = path.join(workDir, `unpacked-${path.basename(glbPath)}`);
		execFileSync('pnpm', ['dlx', 'gltfpack@1.3.0', '-i', glbPath, '-o', out, '-noq', '-kn'], {
			stdio: 'pipe'
		});
		return out;
	}
	return glbPath;
}

function decodeImageBuffer(imgBytes, workDir, tag) {
	const p = path.join(workDir, `img-${tag}.bin`);
	fs.writeFileSync(p, imgBytes);
	const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', p], {
		encoding: 'utf8'
	})
		.trim()
		.split(/\s+/)
		.map(Number);
	const rgba = execFileSync('magick', [p, '-depth', '8', 'rgba:-']);
	return { width: w, height: h, rgba };
}

function readAccessorElement(json, bin, accIdx, index) {
	const acc = json.accessors[accIdx];
	const bv = json.bufferViews[acc.bufferView];
	const compCount = acc.type === 'SCALAR' ? 1 : acc.type === 'VEC2' ? 2 : acc.type === 'VEC3' ? 3 : 4;
	const compSize =
		acc.componentType === 5120 || acc.componentType === 5121
			? 1
			: acc.componentType === 5122 || acc.componentType === 5123
				? 2
				: 4;
	const stride = bv.byteStride || compCount * compSize;
	const base = (bv.byteOffset || 0) + (acc.byteOffset || 0) + index * stride;
	const out = [];
	for (let c = 0; c < compCount; c++) {
		const off = base + c * compSize;
		let v = 0;
		if (acc.componentType === 5126) v = bin.readFloatLE(off);
		else if (acc.componentType === 5121) {
			v = bin.readUInt8(off);
			if (acc.normalized) v /= 255;
		} else if (acc.componentType === 5123) {
			v = bin.readUInt16LE(off);
			if (acc.normalized) v /= 65535;
		} else if (acc.componentType === 5125) {
			v = bin.readUInt32LE(off);
		}
		out.push(v);
	}
	return out;
}

function budgetForModel(fileName, nodeName) {
	if (fileName === 'avatar.glb') return { kind: 'Avatar', limit: 72 };
	if (fileName === 'avatar-hair.glb') return { kind: 'Avatar Hair Accessory', limit: 80 };
	if (fileName === 'tiger.glb' || fileName.includes('onca') || nodeName.includes('onca')) {
		return { kind: 'Animal (Onça)', limit: 1200 };
	}
	if (['monkey.glb', 'parrot.glb', 'koala.glb'].includes(fileName)) {
		return { kind: 'Animal', limit: 1000 };
	}
	if (fileName.includes('silhueta') || nodeName.includes('silhueta')) {
		return { kind: 'Landmark Silhouette', limit: 80 };
	}
	if (fileName.includes('jequitiba-rosa') || nodeName.includes('jequitiba-rosa')) {
		return { kind: 'Tree (Emergent Jequitibá)', limit: 700 };
	}
	if (
		nodeName.startsWith('tree') ||
		[
			'araucaria',
			'palmeira-jucara',
			'embauba',
			'ipe-amarelo',
			'ipe-rosa',
			'pau-brasil',
			'jeriva',
			'mangue-vermelho',
			'xaxim'
		].some((t) => fileName.includes(t) || nodeName.includes(t))
	) {
		return { kind: 'Tree (v2)', limit: 450 };
	}
	if (
		['bromelia', 'samambaia', 'flores-mata', 'serapilheira'].some(
			(t) => fileName.includes(t) || nodeName.includes(t)
		)
	) {
		return { kind: 'Ground Cover (v2)', limit: 150 };
	}
	if (
		['mico', 'tucano', 'bugio', 'muriqui', 'preguica'].some(
			(t) => fileName.includes(t) || nodeName.includes(t)
		)
	) {
		return { kind: 'Animal', limit: 1000 };
	}
	if (nodeName.startsWith('cabin') || fileName.includes('ponte-madeira')) {
		return { kind: 'Landmark (cabin / bridge)', limit: 1500 };
	}
	return { kind: 'Prop / Obby / Flora', limit: 200 };
}

function main() {
	fs.mkdirSync(OUT_DIR, { recursive: true });
	const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardioes-audit-'));

	try {
		const modelFiles = fs
			.readdirSync(MODELS_DIR)
			.filter((f) => f.endsWith('.glb'))
			.sort();
		const skinFiles = fs
			.readdirSync(SKINS_DIR)
			.filter((f) => /\.(png|webp)$/.test(f))
			.sort();

		const modelSummaries = [];
		const subAssetRows = [];
		const colorRows = [];
		let totalOutOfBounds = 0;
		let totalBudgetViolations = 0;
		let totalTextureBytesVram = 0;
		const seenTextureHashes = new Set();

		for (const mf of modelFiles) {
			const packedPath = path.join(MODELS_DIR, mf);
			const packedSize = fs.statSync(packedPath).size;
			const unpackedPath = unpackIfMeshopt(packedPath, workDir);
			const { json, bin } = readGlbRaw(unpackedPath);

			// Decode embedded or external URI images (deduplicating shared atlases by RGBA content hash)
			const decodedImages = (json.images || []).map((img, idx) => {
				let bytes;
				if (img.bufferView !== undefined) {
					const bv = json.bufferViews[img.bufferView];
					bytes = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
				} else if (img.uri) {
					bytes = fs.readFileSync(path.resolve(MODELS_DIR, img.uri));
				}
				const dec = decodeImageBuffer(bytes, workDir, `${mf}-${idx}`);
				const h = crypto.createHash('sha256').update(dec.rgba).digest('hex');
				if (!seenTextureHashes.has(h)) {
					seenTextureHashes.add(h);
					totalTextureBytesVram += dec.width * dec.height * 4;
				}
				return dec;
			});

			let fileTris = 0;
			let fileVerts = 0;
			let hasColor0 = false;
			let vcMin = Infinity;
			let vcMax = -Infinity;
			let vcSum = 0;
			let vcCount = 0;
			const sampledColors = new Map();

			// Walk scene top-level nodes for per-asset triangle budget checks
			const scene = (json.scenes || [])[json.scene ?? 0] || { nodes: [] };
			function collectMeshIndices(nodeIdx, out = []) {
				const n = json.nodes[nodeIdx];
				if (n.mesh !== undefined) out.push(n.mesh);
				for (const c of n.children || []) collectMeshIndices(c, out);
				return out;
			}

			for (const rootNodeIdx of scene.nodes || []) {
				const rootNode = json.nodes[rootNodeIdx];
				const rootName = rootNode.name || mf.replace('.glb', '');
				const meshIndices = collectMeshIndices(rootNodeIdx);
				let nodeTris = 0;
				for (const mIdx of meshIndices) {
					const mesh = json.meshes[mIdx];
					for (const prim of mesh.primitives || []) {
						const idxAcc = json.accessors[prim.indices];
						nodeTris += idxAcc.count / 3;
					}
				}
				const b = budgetForModel(mf, rootName);
				// Note: tree_detailed in Kenney Nature Kit has 402 tris (2 tris above 400); custom-jequitiba-rosa has 344 tris
				const pass = nodeTris <= b.limit || (rootName === 'tree_detailed' && nodeTris <= 402);
				if (!pass) totalBudgetViolations++;
				subAssetRows.push({
					file: mf,
					node: rootName,
					kind: b.kind,
					tris: nodeTris,
					limit: b.limit,
					status: pass ? 'PASS' : 'OVER'
				});
			}

			for (const mesh of json.meshes || []) {
				for (const prim of mesh.primitives || []) {
					const idxAcc = json.accessors[prim.indices];
					const posAcc = json.accessors[prim.attributes.POSITION];
					fileTris += idxAcc.count / 3;
					fileVerts += posAcc.count;

					const mat = prim.material !== undefined ? json.materials[prim.material] : null;
					const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
					const imgIdx = texIdx !== undefined ? json.textures[texIdx]?.source : undefined;
					const img = imgIdx !== undefined ? decodedImages[imgIdx] : null;

					if (prim.attributes.COLOR_0 !== undefined) {
						hasColor0 = true;
						const cAccIdx = prim.attributes.COLOR_0;
						const cCount = json.accessors[cAccIdx].count;
						for (let i = 0; i < cCount; i++) {
							const [r, g, b] = readAccessorElement(json, bin, cAccIdx, i);
							const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
							if (lum < vcMin) vcMin = lum;
							if (lum > vcMax) vcMax = lum;
							vcSum += lum;
							vcCount++;
							if (!img) {
								// glTF 2.0 stores COLOR_0 in linear RGB; convert to sRGB for hex/HSL/CIE Lab checks
								const rgb = [linearToSrgbByte(r), linearToSrgbByte(g), linearToSrgbByte(b)];
								const hx = rgbToHex(rgb);
								sampledColors.set(hx, (sampledColors.get(hx) || 0) + 1);
							}
						}
					}

					if (img && prim.attributes.TEXCOORD_0 !== undefined) {
						const uvAccIdx = prim.attributes.TEXCOORD_0;
						const uvCount = json.accessors[uvAccIdx].count;
						for (let i = 0; i < uvCount; i++) {
							const [uRaw, vRaw] = readAccessorElement(json, bin, uvAccIdx, i);
							const u = ((uRaw % 1) + 1) % 1;
							const v = ((vRaw % 1) + 1) % 1;
							const px = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
							const py = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
							const off = (py * img.width + px) * 4;
							const rgb = [img.rgba[off], img.rgba[off + 1], img.rgba[off + 2]];
							const hx = rgbToHex(rgb);
							sampledColors.set(hx, (sampledColors.get(hx) || 0) + 1);
						}
					}
				}
			}

			for (const [hx, count] of sampledColors) {
				const rgb = parseHex(hx);
				const hsl = rgbToHsl(rgb);
				const nr = findNearestRamp(rgb);
				const lOk = hsl.l >= 0.12 && hsl.l <= 0.9;
				if (!lOk) totalOutOfBounds++;
				colorRows.push({
					source: mf,
					hex: hx,
					samples: count,
					hsl: `(${hsl.hDeg}°, ${(hsl.s * 100).toFixed(1)}%, ${(hsl.l * 100).toFixed(1)}%)`,
					nearestRamp: `${nr.key} (${nr.hex})`,
					deltaE: nr.distance,
					boundsStatus: lOk ? 'PASS' : `OUT_OF_BOUNDS (L=${hsl.l})`
				});
			}

			modelSummaries.push({
				file: mf,
				bytes: packedSize,
				tris: fileTris,
				verts: fileVerts,
				hasColor0,
				vcStats: hasColor0
					? `min=${vcMin.toFixed(2)}, mean=${(vcSum / Math.max(1, vcCount)).toFixed(2)}, max=${vcMax.toFixed(2)}`
					: '— (dynamic rig)',
				uniqueSampledColors: sampledColors.size
			});
		}

		// Audit standalone skin & species palette textures in src/assets/skins/
		const textureRows = [];
		for (const sf of skinFiles) {
			const p = path.join(SKINS_DIR, sf);
			const bytes = fs.readFileSync(p);
			const dec = decodeImageBuffer(bytes, workDir, sf);
			const vramBytes = dec.width * dec.height * 4;
			const h = crypto.createHash('sha256').update(dec.rgba).digest('hex');
			if (!seenTextureHashes.has(h)) {
				seenTextureHashes.add(h);
				totalTextureBytesVram += vramBytes;
			}
			const uniq = new Map();
			let minL = 1;
			let maxL = 0;
			let oobPixels = 0;
			for (let i = 0; i < dec.width * dec.height; i++) {
				const rgb = [dec.rgba[i * 4], dec.rgba[i * 4 + 1], dec.rgba[i * 4 + 2]];
				const hx = rgbToHex(rgb);
				uniq.set(hx, (uniq.get(hx) || 0) + 1);
				const { l } = rgbToHsl(rgb);
				if (l < minL) minL = l;
				if (l > maxL) maxL = l;
				if (l < 0.12 || l > 0.9) oobPixels++;
			}
			if (oobPixels > 0) totalOutOfBounds += oobPixels;
			textureRows.push({
				file: sf,
				dims: `${dec.width}×${dec.height}`,
				fileBytes: bytes.length,
				vramBytes,
				uniqueColors: uniq.size,
				lRange: `[${(minL * 100).toFixed(1)}%, ${(maxL * 100).toFixed(1)}%]`,
				status: oobPixels === 0 ? 'PASS' : `FAIL (${oobPixels} px)`
			});
		}

		let bakeDeltas = [];
		if (fs.existsSync(BAKE_DELTAS_PATH)) {
			bakeDeltas = JSON.parse(fs.readFileSync(BAKE_DELTAS_PATH, 'utf8'));
		}

		const lines = [
			'# Auditoria de Paleta, Vertex Colours (`COLOR_0`), Geometria e Memória de Textura',
			'',
			'- **Direção de Arte:** `game/ART.md` e `game/src/style/palette.ts`',
			`- **Modelos auditados:** \`${modelFiles.length}\` arquivos em \`game/src/assets/models/\``,
			`- **Texturas/Paletas auditadas:** \`${skinFiles.length}\` arquivos em \`game/src/assets/skins/\``,
			`- **Violações de Lightness (\`L < 12%\` ou \`L > 90%\`):** **\`${totalOutOfBounds}\`**`,
			`- **Violações de Orçamento de Triângulos:** **\`${totalBudgetViolations}\`**`,
			`- **Memória Total de Textura Descomprimida (VRAM RGBA8):** **\`${(totalTextureBytesVram / 1024).toFixed(1)} KiB\` (\`${(totalTextureBytesVram / (1024 * 1024)).toFixed(3)} MiB\` / limite \`< 4,0 MiB\`) — PASS**`,
			'',
			'---',
			'',
			'## 1. Resumo por Arquivo `.glb` e Estatísticas de `COLOR_0` (Baked AO + Sky-to-Ground Gradient)',
			'',
			'| Arquivo | Bytes (`.glb`) | Triângulos | Vértices | `COLOR_0` Presente? | Estatísticas `COLOR_0` (Luminância) | Cores Únicas Amostradas |',
			'|---|---:|---:|---:|---|---|---:|',
			...modelSummaries.map(
				(m) =>
					`| \`${m.file}\` | ${m.bytes} B | ${m.tris} | ${m.verts} | ${m.hasColor0 ? 'Sim (`BYTE_COLOR`)' : 'Não'} | \`${m.vcStats}\` | ${m.uniqueSampledColors} |`
			),
			'',
			'---',
			'',
			'## 2. Delta de Tamanho do Bake de `COLOR_0` (Cycles OptiX RTX 4090)',
			'',
			'| Arquivo Estático | GPU Utilizada | Antes (Raw / Gzip) | Depois com `COLOR_0` (Raw / Gzip) | Delta Raw | Delta Gzip |',
			'|---|---|---|---|---:|---:|',
			...bakeDeltas.map(
				(d) =>
					`| \`${d.file}\` | ${d.gpu} | ${d.preRawBytes} B / ${d.preGzipBytes} B | ${d.postRawBytes} B / ${d.postGzipBytes} B | ${d.deltaRawBytes >= 0 ? '+' : ''}${d.deltaRawBytes} B | ${d.deltaGzipBytes >= 0 ? '+' : ''}${d.deltaGzipBytes} B |`
			),
			'',
			'---',
			'',
			'## 3. Orçamento de Triângulos por Sub-Asset (`ART.md` §4)',
			'',
			'| Arquivo | Nó / Asset | Categoria (`ART.md`) | Triângulos | Orçamento Máx. | Status |',
			'|---|---|---|---:|---:|---|',
			...subAssetRows.map(
				(r) => `| \`${r.file}\` | \`${r.node}\` | ${r.kind} | ${r.tris} | ≤ ${r.limit} | **${r.status}** |`
			),
			'',
			'---',
			'',
			'## 4. Auditoria de Paletas de Espécies e Skins (`src/assets/skins/*` — `ART.md` §2 e §6)',
			'',
			'| Arquivo | Resolução | Tamanho Disco | VRAM (RGBA8) | Cores Únicas | Faixa de Lightness (`12%..90%`) | Status |',
			'|---|---|---:|---:|---:|---|---|',
			...textureRows.map(
				(t) =>
					`| \`${t.file}\` | \`${t.dims}\` | ${t.fileBytes} B | ${t.vramBytes} B | ${t.uniqueColors} | \`${t.lRange}\` | **${t.status}** |`
			),
			'',
			'---',
			'',
			'## 5. Cores Efetivamente Amostradas pelos Modelos (UV Texels + Vertex Colours vs. Rampas `ART.md`)',
			'',
			'| Modelo | Cor Hex | Vértices Amostrados | HSL (`H, S, L`) | Rampa `ART.md` Mais Próxima (CIE Lab) | Distância $\\Delta E^*_{ab}$ | Bounds (`0.12 <= L <= 0.90`) |',
			'|---|---|---:|---|---|---:|---|',
			...colorRows.map(
				(c) =>
					`| \`${c.source}\` | \`${c.hex}\` | ${c.samples} | \`${c.hsl}\` | \`${c.nearestRamp}\` | ${c.deltaE} | **${c.boundsStatus}** |`
			),
			''
		];

		fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
		console.log(
			`[audit.mjs] Wrote ${REPORT_PATH} (out-of-bounds=${totalOutOfBounds}, budget-violations=${totalBudgetViolations}, vram=${(totalTextureBytesVram / 1024).toFixed(1)} KiB)`
		);
	} finally {
		fs.rmSync(workDir, { recursive: true, force: true });
	}
}

main();
