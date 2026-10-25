import * as v from 'valibot';
import { journeys } from '#lib/content/mata-atlantica.ts';
import type { Session } from '#lib/session.ts';

const integer = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const timestamp = v.pipe(integer, v.maxValue(8_640_000_000_000_000));
const id = v.pipe(v.string(), v.minLength(1));
const date = v.pipe(
	v.string(),
	v.isoDate(),
	v.check((value) => {
		const parsed = new Date(`${value}T12:00:00Z`);
		return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
	})
);
export const sessionSchema = v.strictObject({
	id: v.pipe(v.string(), v.uuid()),
	rev: v.optional(v.pipe(integer, v.minValue(1)), 1),
	ownerId: v.optional(v.nullable(v.pipe(v.string(), v.uuid())), null),
	journeyId: id,
	createdAt: timestamp,
	updatedAt: timestamp,
	participant: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40)), ''),
	myGroupId: v.optional(v.nullable(id), null),
	school: v.string(),
	className: v.string(),
	guide: v.string(),
	date,
	groups: v.array(v.strictObject({ id, name: id, color: v.string() })),
	step: integer,
	revealed: v.boolean(),
	scores: v.array(
		v.strictObject({
			id,
			at: timestamp,
			groupId: id,
			delta: v.pipe(v.number(), v.safeInteger()),
			stepId: v.nullable(id),
			item: v.optional(id)
		})
	),
	photos: v.array(id),
	oathAt: v.nullable(timestamp),
	certificateCode: v.pipe(v.string(), v.regex(/^[0-9A-HJKMNP-TV-Z]{8}$/))
});

export function decodeSession(
	raw: unknown
): { session: Session; reason?: never } | { session?: never; reason: string } {
	const result = v.safeParse(sessionSchema, raw);
	if (!result.success) return { reason: 'Dados da jornada inválidos. O original foi preservado.' };
	const session = result.output;
	const journey = journeys[session.journeyId];
	if (!journey) return { reason: 'Esta jornada precisa de uma versão mais nova do app.' };
	if (session.step > journey.steps.length)
		return { reason: 'Etapa da jornada incompatível com esta versão.' };
	if (new Set(session.groups.map((g) => g.id)).size !== session.groups.length)
		return { reason: 'Há grupos com identificadores repetidos.' };
	if (session.myGroupId !== null && !session.groups.some((group) => group.id === session.myGroupId))
		return { reason: 'O grupo escolhido não pertence a esta jornada.' };
	return { session };
}
