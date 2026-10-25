/**
 * Public surface of the story map ("Reserva da Iara", game/LEVEL.md): pure
 * TypeScript data, the same SurvivalWorld shape as the survival maps plus the
 * StoryLevel. Control points live in layout.ts.
 */
export { buildStoryWorld, insideTop, reachTargets } from './build.ts';
export * as layout from './layout.ts';
export { planSvg } from './plan-svg.ts';
export type * from './types.ts';
