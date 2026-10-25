/** Let input and paint run between optional scene-initialization batches. */
export function yieldToMain(): Promise<void> {
	const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }).scheduler;
	if (scheduler?.yield) return scheduler.yield();
	return new Promise((resolve) => setTimeout(resolve, 0));
}
