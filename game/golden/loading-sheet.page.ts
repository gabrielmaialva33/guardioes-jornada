/**
 * Page side of loading-sheet.ts: mounts the real LoadingScreen with a frozen
 * snapshot (or a live model) so each screenshot shows an exact state.
 */
import { flushSync, mount, unmount } from 'svelte';
import LoadingScreen from '../src/ui/loading/LoadingScreen.svelte';
import { LoadingProgress, type LoadingSnapshot } from '../src/ui/loading/loading.ts';

declare global {
	interface Window {
		showLoading(snapshot: Partial<LoadingSnapshot> | 'live', firstFact: number): void;
	}
}

let app: ReturnType<typeof mount> | undefined;
window.showLoading = (snapshot, firstFact) => {
	if (app) void unmount(app);
	let model: LoadingProgress;
	if (snapshot === 'live') {
		model = new LoadingProgress();
		const later = (ms: number) => new Promise((done) => setTimeout(done, ms));
		model.track('code', later(300), 1);
		model.track('placements', later(1500), 3);
		model.track('life', later(1200), 2);
		model.track('sound', later(800), 1);
		model.reserve('compile', 2);
		void later(1600).then(() => model.track('compile', later(500)).then(() => model.ready()));
	} else {
		const fixed: LoadingSnapshot = {
			phase: 'loading',
			fraction: 0,
			percent: 0,
			label: 'Abrindo a clareira',
			error: null,
			elapsed: 0,
			...snapshot
		};
		model = { update: () => fixed, retry() {} } as unknown as LoadingProgress;
	}
	app = mount(LoadingScreen, { target: document.body, props: { model, firstFact } });
	flushSync();
};
