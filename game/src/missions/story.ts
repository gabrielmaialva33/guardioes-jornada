import type { StoryLevel } from '../level/types.ts';
import type { Point } from '../survival/types.ts';
import { withAct1 } from './act1.ts';
import { type Dialogue, TEXT } from './content.ts';

export interface StorySave extends Record<string, unknown> {
	version: 1;
	levelVersion: number;
	started: boolean;
	houseVisited: boolean;
	gatheredSeeds: string[];
	photographedBirds: string[];
	npcAccepted: string[];
	seedsDelivered: boolean;
	fruits: string[];
	planted: string[];
	collected: string[];
	marked: string[];
	reported: string[];
	nurseryTaken: boolean;
	loggerReported: boolean;
	crossed: boolean;
	summit: boolean;
	selected: number;
}
export interface StoryAction {
	id: string;
	label: string;
	point: Point;
	disabled?: boolean;
}
export type StoryGesture = 'pickup' | 'pet' | 'binoculars' | 'cheer';
export interface StoryOptions {
	value?: unknown;
	persist: (data: StorySave) => boolean;
	badge: () => void;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const record = (v: unknown): v is Record<string, unknown> =>
	v !== null && typeof v === 'object' && !Array.isArray(v);
export function decodeStorySave(level: StoryLevel, value: unknown): { data: StorySave; readOnly: boolean } {
	level = withAct1(level);
	const input = record(value) ? value : {};
	// The first story pack used a planting-cell id for this reward.
	const collected =
		Array.isArray(input.collected) && level.collectibles.some((c) => c.id === 'folha-missao-1')
			? input.collected.map((id) => (id === 'corredor-3' ? 'folha-missao-1' : id))
			: input.collected;
	const readOnly =
		(typeof input.levelVersion === 'number' && input.levelVersion > level.version) ||
		(input.version !== undefined && input.version !== 0 && input.version !== 1);
	const validIds = (value: unknown, ids: string[]) =>
		Array.isArray(value)
			? [...new Set(value.filter((v): v is string => typeof v === 'string' && ids.includes(v)))]
			: [];
	const fruits = validIds(
		input.fruits,
		level.collectibles.filter((c) => c.kind === 'jucara-fruit').map((c) => c.id)
	);
	const corridor = validIds(
		input.planted,
		level.planting.filter((p) => p.mission === 1).map((p) => p.id)
	).slice(0, fruits.length);
	const nurseryTaken = input.nurseryTaken === true;
	const marked = validIds(
		input.marked,
		level.triggers.filter((t) => t.kind === 'trap').map((t) => t.id)
	);
	return {
		readOnly,
		data: {
			...input,
			version: 1,
			levelVersion: level.version,
			started: input.started === true,
			houseVisited:
				input.houseVisited === true ||
				(input.houseVisited === undefined &&
					input.started === true &&
					(typeof input.levelVersion !== 'number' ||
						input.levelVersion < level.version ||
						fruits.length > 0 ||
						input.summit === true)),
			gatheredSeeds: validIds(input.gatheredSeeds, level.act1?.seeds.map((s) => s.id) ?? []),
			photographedBirds: validIds(input.photographedBirds, level.act1?.birds.map((s) => s.species) ?? []),
			npcAccepted: validIds(input.npcAccepted, ['ana', 'ze']),
			seedsDelivered: input.seedsDelivered === true,
			fruits,
			planted: [
				...corridor,
				...(nurseryTaken
					? validIds(
							input.planted,
							level.planting.filter((p) => p.mission === 4).map((p) => p.id)
						)
					: [])
			],
			collected: validIds(
				collected,
				level.collectibles.filter((c) => c.kind !== 'jucara-fruit').map((c) => c.id)
			),
			marked,
			reported: validIds(input.reported, marked),
			nurseryTaken,
			loggerReported: input.loggerReported === true,
			crossed: input.crossed === true,
			summit: input.summit === true,
			selected:
				typeof input.selected === 'number' &&
				Number.isInteger(input.selected) &&
				level.missions.some((m) => m.id === input.selected)
					? input.selected
					: 1
		}
	};
}
export class StoryGame {
	/** Transient renderer hooks; neither points nor gestures enter the per-device save. */
	onGesture: ((gesture: StoryGesture, point: Point | null) => void) | null = null;
	onMissionComplete: ((id: number) => void) | null = null;
	companion: Point | null = null;
	readonly level: StoryLevel;
	data: StorySave;
	readonly readOnlySave: boolean;
	position: Point;
	revision = 0;
	dialogue: Dialogue | null = null;
	notice = 'Fale com a Iara na base para começar.';
	saveError = false;
	readonly #persist: StoryOptions['persist'];
	readonly #badge: StoryOptions['badge'];
	#badgeSent = false;
	#danger = false;
	constructor(level: StoryLevel, options: StoryOptions) {
		this.level = level = withAct1(level);
		this.position = { ...level.spawn };
		const decoded = decodeStorySave(level, options.value);
		this.data = decoded.data;
		this.readOnlySave = decoded.readOnly;
		this.#persist = options.persist;
		this.#badge = options.badge;
		if (!this.available(this.data.selected) || this.completed(this.data.selected))
			this.data.selected = this.nextMission();
		if (this.finished) {
			this.dialogue = { id: 'victory', speaker: 'Iara', lines: TEXT.closing, finished: true };
			this.notice = TEXT.closing[0];
		} else if (this.data.started) this.notice = 'Seu progresso está guardado. Siga a seta para continuar.';
	}
	get seeds() {
		return (
			this.data.fruits.length -
			this.data.planted.filter((id) => this.level.planting.find((p) => p.id === id)?.mission === 1).length
		);
	}
	get seedlings() {
		return (
			(this.data.nurseryTaken ? 6 : 0) -
			this.data.planted.filter((id) => this.level.planting.find((p) => p.id === id)?.mission === 4).length
		);
	}
	get trash() {
		return this.data.collected.filter(
			(id) => this.level.collectibles.find((c) => c.id === id)?.kind === 'trash'
		).length;
	}
	get leaves() {
		return this.data.collected.filter(
			(id) => this.level.collectibles.find((c) => c.id === id)?.kind === 'gold-leaf'
		).length;
	}
	get finished() {
		return this.completed(6);
	}
	progress(id: number) {
		if (id === 0) return +this.data.houseVisited;
		if (id === 7) return this.data.gatheredSeeds.length;
		if (id === 8) return this.data.photographedBirds.length;
		if (id === 1 || id === 4)
			return this.data.planted.filter((key) => this.level.planting.find((p) => p.id === key)?.mission === id)
				.length;
		if (id === 2) return +this.data.loggerReported;
		if (id === 3) return +this.data.crossed;
		if (id === 5) return this.data.reported.length;
		if (id === 6) return +this.data.summit;
		return 0;
	}
	available(id: number): boolean {
		return (
			(id === 0 || id === 1 || this.data.started) &&
			!!this.level.missions.find((m) => m.id === id)?.requires.every((required) => this.completed(required))
		);
	}
	completed(id: number): boolean {
		const m = this.level.missions.find((m) => m.id === id);
		return (
			!!m &&
			this.data.started &&
			this.available(id) &&
			this.progress(id) >= m.count &&
			(id !== 7 || this.data.seedsDelivered) &&
			(id !== 8 || this.data.npcAccepted.includes('ze'))
		);
	}
	nextMission() {
		return this.level.missions.find((m) => this.available(m.id) && !this.completed(m.id))?.id ?? 6;
	}
	growthStage(id: string) {
		if (!this.data.planted.includes(id)) return 0;
		const mission = this.level.planting.find((p) => p.id === id)?.mission ?? 1;
		return this.progress(mission) < 3 ? 1 : this.completed(mission) ? 3 : 2;
	}
	select(id: number) {
		if (!this.available(id) || this.completed(id) || id === this.data.selected) return;
		this.change(() => {
			this.data.selected = id;
		});
	}
	#inside(id: string, feet: Point) {
		const t = this.level.triggers.find((t) => t.id === id);
		return !!t && distance(t, feet) <= t.radius && feet.y >= t.minY && feet.y <= t.maxY;
	}
	#near(point: Point, feet: Point, radius: number) {
		return distance(point, feet) <= radius && Math.abs(feet.y - point.y) <= 1.4;
	}
	context(feet: Point): StoryAction | null {
		if (this.#inside('madeireiro', feet))
			return { id: 'danger', label: 'Volte para trás da pedra', point: feet, disabled: true };
		const candidates: StoryAction[] = [];
		const offer = (id: string, label: string, point: Point, radius: number, disabled = false) => {
			if (this.#near(point, feet, radius)) candidates.push({ id, label, point, disabled });
		};
		const iara = this.level.landmarks.find((l) => l.kind === 'npc-iara');
		if (iara) offer('iara', 'Falar com Iara', iara, 3);
		for (const npc of this.level.act1?.npcs ?? []) offer(npc.id, `Falar com ${npc.name}`, npc, 3);
		const note = this.level.act1?.grotto.note;
		if (note) offer('grotto-note', 'Ler o bilhete da Iara', note, 2);
		if (this.#inside('mirante', feet) && Math.abs(feet.y - this.level.mirante.y) < 0.3)
			offer('binoculars', 'Observar a reserva', this.level.mirante, 4);
		if (!this.data.started) return candidates[0] ?? null;
		if (this.companion) offer('pet', 'Fazer carinho no mico', this.companion, 2);
		for (const c of this.level.collectibles) {
			if (c.kind === 'jucara-fruit' && this.available(1) && !this.data.fruits.includes(c.id))
				offer(c.id, 'Colher sementes de juçara', c, c.radius + 0.35);
			if (c.kind === 'trash' && !this.data.collected.includes(c.id))
				offer(c.id, 'Recolher resíduo', c, c.radius + 0.35);
			if (
				c.kind === 'gold-leaf' &&
				!this.data.collected.includes(c.id) &&
				(c.on !== '' ? this.available(3) : this.completed(c.mission))
			)
				offer(c.id, 'Recolher folha dourada', c, c.radius + 0.35);
		}
		for (const p of this.level.planting)
			if (this.available(p.mission) && !this.data.planted.includes(p.id))
				offer(
					p.id,
					p.mission === 1
						? this.seeds
							? 'Semear juçara'
							: 'Colha sementes primeiro'
						: this.seedlings
							? 'Plantar muda'
							: 'Pegue mudas no viveiro',
					p,
					1.55,
					p.mission === 1 ? this.seeds < 1 : this.seedlings < 1
				);
		if (this.available(7) && this.data.npcAccepted.includes('ana'))
			for (const seed of this.level.act1?.seeds ?? [])
				if (!this.data.gatheredSeeds.includes(seed.id))
					offer(seed.id, 'Guardar semente para Ana', seed, seed.radius + 0.5);
		const nursery = this.level.landmarks.find((l) => l.kind === 'viveiro');
		if (nursery && this.available(4) && !this.data.nurseryTaken)
			offer('nursery', 'Pegar seis mudas', nursery, 3.3);
		if (this.available(2) && !this.completed(2) && this.#inside('observacao', feet))
			candidates.push({ id: 'logger', label: 'Chamar Iara pelo rádio', point: feet });
		for (const trap of this.level.triggers.filter((t) => t.kind === 'trap'))
			if (this.available(5) && !this.data.reported.includes(trap.id)) {
				const near = this.#near(trap, feet, trap.radius + 0.35);
				if (near) {
					const unsafe = distance(trap, feet) < 1.2;
					offer(
						this.data.marked.includes(trap.id) ? 'inspector' : trap.id,
						unsafe
							? 'Afaste-se da armadilha'
							: this.data.marked.includes(trap.id)
								? 'Chamar a fiscalização'
								: 'Sinalizar sem tocar',
						trap,
						trap.radius + 0.35,
						unsafe
					);
				}
			}
		candidates.sort(
			(a, b) =>
				Number(!!a.disabled) - Number(!!b.disabled) || distance(a.point, feet) - distance(b.point, feet)
		);
		return candidates[0] ?? null;
	}
	act(feet: Point) {
		const action = this.context(feet);
		if (!action) return;
		if (action.disabled) {
			this.notice = action.id === 'danger' ? TEXT.loggerWarning : action.label;
			this.revision++;
			return;
		}
		if (action.id === 'grotto-note') {
			this.dialogue = {
				id: action.id,
				speaker: 'Bilhete da Iara',
				lines: [this.level.act1?.text.GRUTA_BILHETE ?? 'Você encontrou o bilhete da Iara.']
			};
			this.revision++;
			return;
		}
		const npc = this.level.act1?.npcs.find((n) => n.id === action.id);
		if (npc) {
			if (!this.available(npc.mission)) {
				this.dialogue = {
					id: npc.id,
					speaker: npc.name,
					lines: ['Conclua o corredor da juçara e volte para conversarmos.']
				};
				this.revision++;
				return;
			}
			this.change(() => {
				if (!this.data.npcAccepted.includes(npc.id)) this.data.npcAccepted.push(npc.id);
				if (npc.id === 'ana' && this.progress(7) >= (this.level.act1?.seeds.length ?? 6))
					this.data.seedsDelivered = true;
				const done =
					npc.id === 'ana'
						? this.data.seedsDelivered
						: this.progress(8) >= (this.level.act1?.birds.length ?? 3);
				const key =
					npc.id === 'ana' ? (done ? 'ANA_OBRIGADA' : 'ANA_INTRO') : done ? 'ZE_OBRIGADO' : 'ZE_INTRO';
				this.dialogue = {
					id: npc.id,
					speaker: npc.name,
					lines: [this.level.act1?.text[key] ?? 'Vamos observar a mata juntos.']
				};
			});
			return;
		}
		if (action.id === 'pet' || action.id === 'binoculars') {
			this.onGesture?.(action.id, action.id === 'pet' ? action.point : null);
			this.notice =
				action.id === 'pet'
					? 'Um carinho no seu companheiro de trilha.'
					: 'Olhe quanta vida a reserva abriga.';
			this.revision++;
			return;
		}
		if (action.id === 'iara') {
			if (this.finished) {
				this.dialogue = { id: 'victory', speaker: 'Iara', lines: TEXT.closing, finished: true };
				this.revision++;
				return;
			}
			this.dialogue = {
				id: 'iara',
				speaker: 'Iara',
				lines: this.data.started
					? ['Siga a seta para sua missão. Você pode escolher as missões disponíveis na lista.']
					: TEXT.intro,
				choices: this.data.started ? undefined : [{ id: 'start', label: 'Vamos começar' }]
			};
			this.revision++;
			return;
		}
		if (action.id === 'logger') {
			this.dialogue = {
				id: 'logger',
				speaker: 'Ponto de observação',
				lines: [TEXT.logger],
				choices: TEXT.loggerChoices
			};
			this.revision++;
			return;
		}
		const collectible = this.level.collectibles.find((c) => c.id === action.id);
		this.change(() => {
			const c = collectible;
			const seed = this.level.act1?.seeds.find((s) => s.id === action.id);
			if (seed) {
				this.data.gatheredSeeds.push(seed.id);
				this.notice = `Sementes guardadas para Ana: ${this.data.gatheredSeeds.length}/${this.level.act1?.seeds.length}.`;
				this.onGesture?.('pickup', seed);
			}
			const p = this.level.planting.find((p) => p.id === action.id);
			if (c) {
				if (c.kind === 'jucara-fruit') {
					this.data.fruits.push(c.id);
					this.notice =
						this.data.fruits.length === 1 ? TEXT.fruit : `Sementes de juçara: ${this.data.fruits.length}/5!`;
				} else {
					this.data.collected.push(c.id);
					this.notice =
						c.kind === 'trash'
							? 'Resíduo recolhido. Traga sempre seu lixo de volta!'
							: 'Folha dourada encontrada!';
				}
			} else if (p) {
				this.data.planted.push(p.id);
				this.notice = p.mission === 1 ? 'Juçara semeada no corredor.' : 'Muda plantada na clareira.';
			} else if (action.id === 'nursery') {
				this.data.nurseryTaken = true;
				this.notice = 'Seis mudas prontas. Leve-as para a clareira.';
			} else if (action.id === 'inspector') {
				this.data.reported = [...this.data.marked];
				this.notice = TEXT.trap;
			} else if (action.id.startsWith('armadilha-')) {
				this.data.marked.push(action.id);
				this.notice = 'Armadilha sinalizada. Chame a fiscalização pelo rádio, sem tocar nela.';
			}
		});
		if (collectible || action.id === 'nursery') this.onGesture?.('pickup', action.point);
	}
	choose(id: string, feet: Point) {
		if (id === 'start' && this.dialogue?.id === 'iara' && this.#inside('iara', feet)) {
			this.change(() => {
				this.data.started = true;
				this.dialogue = null;
				this.notice =
					this.level.act1?.text.CASA_INTRO ?? 'Colha sementes sob as palmeiras e semeie o corredor.';
			});
			return;
		}
		if (this.dialogue?.id !== 'logger') return;
		if (this.#inside('madeireiro', feet) || !this.#inside('observacao', feet)) {
			this.notice = TEXT.loggerWarning;
			this.dialogue = null;
			this.revision++;
			return;
		}
		if (id === 'report-logger') {
			this.change(() => {
				this.data.loggerReported = true;
				this.dialogue = { id: 'logger-reply', speaker: 'Iara pelo rádio', lines: [TEXT.loggerSafe] };
			});
		} else if (id === 'confront' || id === 'ignore') {
			this.dialogue = {
				id: 'logger',
				speaker: 'Ponto de observação',
				lines: [id === 'confront' ? TEXT.loggerUnsafe : TEXT.loggerIgnore],
				choices: TEXT.loggerChoices
			};
			this.revision++;
		}
	}
	closeDialogue() {
		this.dialogue = null;
		this.revision++;
	}
	visit(feet: Point, grounded: boolean) {
		this.position.x = feet.x;
		this.position.y = feet.y;
		this.position.z = feet.z;
		const danger = this.#inside('madeireiro', feet);
		if (danger && !this.#danger) {
			this.notice = TEXT.loggerWarning;
			this.revision++;
		}
		this.#danger = danger;
		if (!grounded || !this.data.started) return;
		if (this.level.act1 && !this.data.houseVisited && this.#inside('casa-na-arvore', feet))
			this.change(() => {
				this.data.houseVisited = true;
				this.dialogue = {
					id: 'treehouse',
					speaker: 'Iara pelo rádio',
					lines: [this.level.act1?.text.CASA_VISTA ?? 'Você chegou à casa da árvore.']
				};
			});
		const bank = this.level.checkpoints.find((c) => c.id === 'pedras-leste');
		if (
			!this.data.crossed &&
			this.available(3) &&
			bank &&
			feet.x >= bank.min.x &&
			feet.x <= bank.max.x &&
			feet.z >= bank.min.z &&
			feet.z <= bank.max.z &&
			feet.y >= bank.min.y &&
			feet.y <= bank.max.y
		)
			this.change(() => {
				this.data.crossed = true;
			});
		if (
			!this.data.summit &&
			this.available(6) &&
			this.#inside('mirante', feet) &&
			feet.y >= this.level.mirante.y - 0.15
		)
			this.change(() => {
				this.data.summit = true;
				this.onGesture?.('binoculars', null);
				this.dialogue = { id: 'victory', speaker: 'Iara', lines: TEXT.closing, finished: true };
			});
	}
	/** Accepted camera saves, never a player-provided mission counter. */
	recordPhotos(species: readonly string[]) {
		const valid = this.level.act1?.birds.map((b) => b.species) ?? [];
		const aliases: Record<string, string> = {
			'tucano-de-bico-verde': 'tucano',
			'saira-sete-cores': 'saira',
			'sabia-laranjeira': 'sabia'
		};
		const fresh = species
			.map((s) => aliases[s] ?? s)
			.filter((s) => valid.includes(s) && !this.data.photographedBirds.includes(s));
		if (!fresh.length) return;
		this.change(() => {
			for (const s of fresh)
				if (!this.data.photographedBirds.includes(s)) this.data.photographedBirds.push(s);
		});
	}
	repairBadge() {
		if (this.finished && !this.#badgeSent) {
			try {
				this.#badge();
				this.#badgeSent = true;
			} catch {
				this.notice = 'A jornada terminou, mas não foi possível guardar o emblema neste celular.';
				this.revision++;
			}
		}
	}
	restart() {
		const fresh = decodeStorySave(this.level, undefined).data;
		this.data = { ...this.data, ...fresh };
		this.dialogue = null;
		this.#badgeSent = false;
		this.notice = 'Fale com a Iara para começar uma nova jornada.';
		this.commit();
	}
	target(feet: Point): Point & { name: string } {
		const iara = this.level.landmarks.find((l) => l.kind === 'npc-iara');
		if (!this.data.started && iara) return { ...iara, name: 'Fale com Iara' };
		const id = this.data.selected;
		let points: (Point & { id?: string })[] = [];
		let name = this.level.missions.find((m) => m.id === id)?.name ?? 'Explore a reserva';
		if (id === 7) {
			points =
				!this.data.npcAccepted.includes('ana') || this.progress(7) >= (this.level.act1?.seeds.length ?? 6)
					? (this.level.act1?.npcs.filter((n) => n.id === 'ana') ?? [])
					: (this.level.act1?.seeds.filter((s) => !this.data.gatheredSeeds.includes(s.id)) ?? []);
			name = points[0]?.id === 'ana' ? 'Levar sementes para Ana' : 'Encontrar sementes para Ana';
		} else if (id === 8) {
			points = !this.data.npcAccepted.includes('ze')
				? (this.level.act1?.npcs.filter((n) => n.id === 'ze') ?? [])
				: (this.level.act1?.birds.filter((b) => !this.data.photographedBirds.includes(b.species)) ?? []);
		} else if (id === 1) {
			points = this.seeds
				? this.level.planting.filter((p) => p.mission === 1 && !this.data.planted.includes(p.id))
				: this.level.collectibles.filter(
						(c) => c.kind === 'jucara-fruit' && !this.data.fruits.includes(c.id)
					);
			name = this.seeds ? 'Semear juçara' : 'Colher sementes de juçara';
		} else if (id === 4) {
			points = this.data.nurseryTaken
				? this.level.planting.filter((p) => p.mission === 4 && !this.data.planted.includes(p.id))
				: this.level.landmarks.filter((l) => l.kind === 'viveiro');
			name = this.data.nurseryTaken ? 'Plantar na clareira' : 'Pegar mudas no viveiro';
		} else if (id === 5) {
			points = this.level.triggers.filter((t) => t.kind === 'trap' && !this.data.reported.includes(t.id));
			name = this.data.marked.some((t) => !this.data.reported.includes(t))
				? 'Chamar a fiscalização'
				: 'Sinalizar armadilhas';
		} else {
			const m = this.level.missions.find((m) => m.id === id);
			if (m) points = [m.target];
		}
		let nearest = points[0] ?? this.level.mirante;
		for (const p of points) if (distance(p, feet) < distance(nearest, feet)) nearest = p;
		if (id === 5) {
			const d = distance(nearest, feet) || 1;
			return {
				...nearest,
				x: nearest.x + ((feet.x - nearest.x) / d) * 2,
				z: nearest.z + ((feet.z - nearest.z) / d) * 2,
				name
			};
		}
		return { ...nearest, name };
	}
	private change(mutate: () => void) {
		const before = this.level.missions.filter((m) => this.completed(m.id)).map((m) => m.id);
		mutate();
		for (const m of this.level.missions)
			if (this.completed(m.id) && !before.includes(m.id)) {
				this.onGesture?.('cheer', null);
				this.onMissionComplete?.(m.id);
				this.notice = `Missão concluída: ${m.name}!`;
				if (m.id === 1)
					this.dialogue = { id: 'corridor', speaker: 'Corredor do mico-leão-dourado', lines: TEXT.corridor };
			}
		if (this.completed(this.data.selected) || !this.available(this.data.selected))
			this.data.selected = this.nextMission();
		this.commit();
		this.repairBadge();
	}
	private commit() {
		this.revision++;
		if (!this.readOnlySave) this.saveError = !this.#persist(this.data);
	}
}
