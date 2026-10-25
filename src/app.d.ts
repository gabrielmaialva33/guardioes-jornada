// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface PageState {
			/** Onboarding stage on /new, kept in history so "back" steps through it. */
			stage?: 'calling' | 'name' | 'group';
			/** Name typed on /new, so a reload on the group stage still has it. */
			name?: string;
		}
	}
}

export {};
