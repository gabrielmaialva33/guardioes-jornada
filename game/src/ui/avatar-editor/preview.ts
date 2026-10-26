/**
 * Dev-only page for the avatar editor without the game's Root, served by the
 * game's Vite config:
 *
 *   pnpm game:dev
 *   http://localhost:5196/src/ui/avatar-editor/preview.html?tab=hair&skin=c&quality=low&reduced
 *
 * - `tab`: the tab it opens on (presets, skin, face, hair, clothes, skins);
 * - `skin`: start wearing that Kenney skin (a–r); `preset`: start as preset N (1–18);
 * - `quality`: force the tier (low, medium, high), else measured like the game;
 * - `reduced`: reduced motion on; `closed`: start with the editor closed.
 *
 * window.__avatarEditor drives it from Playwright: open/close cycles, the
 * stage's metrics and the dispose reports (GPU objects left after closing).
 * Nothing here ships: the game build's only input is src/main.ts.
 */
import '@fontsource-variable/alegreya/index.css';
import '@fontsource-variable/atkinson-hyperlegible-next/index.css';
import { flushSync, mount, unmount } from 'svelte';
import { AVATAR_PRESETS, DEFAULT_AVATAR } from '../../avatar/catalog.ts';
import type { AvatarProfile } from '../../data/local-save.ts';
import type { Quality } from '../../render/quality.ts';
import AvatarEditor from './AvatarEditor.svelte';
import { cloneProfile, EDITOR_TABS, selectPreset, setKenneySkin, type TabId } from './editor.ts';
import {
	type AvatarStage,
	type DisposeReport,
	releaseThumbnails,
	type StageMetrics,
	sessionThumbnails
} from './stage.ts';

export interface AvatarEditorPreview {
	/** Opens the editor; resolves with the metrics of its first preview frame. */
	open(tab?: TabId): Promise<StageMetrics>;
	/** Closes it (Cancelar); resolves with the dispose report. */
	close(): Promise<DisposeReport | null>;
	/** Live metrics of the open editor (thumbnail counts and costs). */
	metrics(): StageMetrics | null;
	/** Resolves once the visible tab has no thumbnail left to render. */
	thumbnailsSettled(timeoutMs?: number): Promise<StageMetrics | null>;
	isOpen(): boolean;
	releaseThumbnails(): void;
	readonly cachedThumbnails: number;
	readonly applied: AvatarProfile[];
	readonly opens: StageMetrics[];
	readonly disposals: DisposeReport[];
}

declare global {
	interface Window {
		__avatarEditor?: AvatarEditorPreview;
	}
}

const query = new URLSearchParams(location.search);
const host = document.querySelector<HTMLElement>('#game');
const launcher = document.querySelector<HTMLButtonElement>('#launcher');
if (!host || !launcher) throw new Error('avatar-editor-preview-markup');
const tabParam = query.get('tab');
const startTab: TabId = EDITOR_TABS.find((tab) => tab.id === tabParam)?.id ?? 'presets';
const qualityParam = query.get('quality');
const quality = (['low', 'medium', 'high'] as const).find((q) => q === qualityParam) as Quality | undefined;
const reducedMotion = query.has('reduced') ? true : undefined;

let profile: AvatarProfile = cloneProfile(DEFAULT_AVATAR);
const presetIndex = Number(query.get('preset'));
if (presetIndex >= 1 && presetIndex <= AVATAR_PRESETS.length)
	profile = selectPreset(profile, AVATAR_PRESETS[presetIndex - 1]);
const skin = query.get('skin');
if (skin && /^[a-r]$/.test(skin)) profile = setKenneySkin(profile, skin);

const applied: AvatarProfile[] = [];
const opens: StageMetrics[] = [];
const disposals: DisposeReport[] = [];
let app: ReturnType<typeof mount> | undefined;
let stage: AvatarStage | undefined;
let ready: ((metrics: StageMetrics) => void) | undefined;
let lastDispose: DisposeReport | null = null;

function open(tab: TabId = startTab): Promise<StageMetrics> {
	if (app) return Promise.reject(new Error('already-open'));
	const target = host as HTMLElement;
	launcher?.setAttribute('hidden', '');
	const firstFrame = new Promise<StageMetrics>((resolve) => {
		ready = resolve;
	});
	app = mount(AvatarEditor, {
		target,
		props: {
			profile,
			quality,
			reducedMotion,
			initialTab: tab,
			async onapply(value) {
				applied.push(value);
				profile = value;
				await close();
			},
			onclose: () => void close(),
			onready(metrics) {
				opens.push(metrics);
				ready?.(metrics);
			},
			ondispose(report) {
				lastDispose = report;
				disposals.push(report);
			},
			onstage(value) {
				stage = value;
			}
		}
	});
	flushSync();
	return firstFrame;
}

async function close(): Promise<DisposeReport | null> {
	if (!app) return null;
	const closing = app;
	app = undefined;
	lastDispose = null;
	await unmount(closing);
	launcher?.removeAttribute('hidden');
	launcher?.focus();
	return lastDispose;
}

async function thumbnailsSettled(timeoutMs = 15000): Promise<StageMetrics | null> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		const metrics = stage?.metrics();
		if (metrics && stage?.status === 'ready' && metrics.thumbnails.pending === 0) {
			// One more frame: a request may have just been replaced.
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const settled = stage?.metrics();
			if (settled && settled.thumbnails.pending === 0) return settled;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return stage?.metrics() ?? null;
}

launcher.addEventListener('click', () => void open());

window.__avatarEditor = {
	open,
	close,
	metrics: () => stage?.metrics() ?? null,
	thumbnailsSettled,
	isOpen: () => app !== undefined,
	releaseThumbnails,
	get cachedThumbnails() {
		return sessionThumbnails.size;
	},
	applied,
	opens,
	disposals
};

if (!query.has('closed')) void open();
else launcher.removeAttribute('hidden');
