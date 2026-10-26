import { type CaptureFrame, encodeThumbnail, type ThumbnailEncoder } from '../guia/capture.ts';
import type { GuideService } from '../guia/persistence.ts';
import type { CameraTrap } from './camera-trap.ts';
import type { PhotoCamera } from './photo.ts';
/** Event bridge, never a render-loop task. Pass the renderer canvas on the photo-save action. */
export class GuideMechanicsBridge {
	readonly #revisions = new WeakMap<PhotoCamera, number>();
	photoIssue = false;
	constructor(
		readonly guide: GuideService,
		readonly encode: ThumbnailEncoder = encodeThumbnail
	) {}
	async #thumbnail(frame?: CaptureFrame) {
		if (!frame) return undefined;
		try {
			const result = await this.encode(frame);
			this.photoIssue = false;
			return result;
		} catch {
			this.photoIssue = true;
			return undefined;
		}
	}
	async photoSaved(photo: PhotoCamera, frame?: CaptureFrame) {
		if (photo.revision < 1 || photo.revision <= (this.#revisions.get(photo) ?? 0) || photo.savedCount === 0)
			return false;
		const ids: string[] = [];
		for (let i = 0; i < photo.savedCount; i++) {
			const species = photo.saved[i]?.species;
			if (species && !ids.includes(species)) ids.push(species);
		}
		this.#revisions.set(photo, photo.revision);
		const thumbnail = await this.#thumbnail(frame);
		await this.guide.record(ids, 'photo', thumbnail);
		return true;
	}
	async collectTrap(trap: CameraTrap, frame?: CaptureFrame) {
		if (!this.guide.book.registry.find(trap.species) || !trap.collect()) return false;
		const thumbnail = await this.#thumbnail(frame);
		await this.guide.record([trap.species], 'trap', thumbnail);
		return true;
	}
}
