import { MAX_THUMBNAIL_BYTES } from './thumbnails.ts';
export interface CaptureFrame {
	source: CanvasImageSource;
	width: number;
	height: number;
	/** CSS sky behind a transparent WebGL canvas, top and horizon colours. */
	background?: readonly [string, string];
}
export type ThumbnailEncoder = (frame: CaptureFrame) => Promise<Blob>;
/** Copies the frame synchronously before the first await, so the renderer may reuse its canvas immediately. */
export async function encodeThumbnail(frame: CaptureFrame): Promise<Blob> {
	if (
		!Number.isFinite(frame.width) ||
		!Number.isFinite(frame.height) ||
		frame.width <= 0 ||
		frame.height <= 0
	)
		throw new Error('Invalid photo dimensions');
	const scale = Math.min(1, 256 / frame.width, 256 / frame.height),
		canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(frame.width * scale));
	canvas.height = Math.max(1, Math.round(frame.height * scale));
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas unavailable');
	if (frame.background) {
		const sky = context.createLinearGradient(0, 0, 0, canvas.height * 0.65);
		sky.addColorStop(0, frame.background[0]);
		sky.addColorStop(1, frame.background[1]);
		context.fillStyle = sky;
		context.fillRect(0, 0, canvas.width, canvas.height);
	}
	context.drawImage(frame.source, 0, 0, canvas.width, canvas.height);
	const encode = (quality: number) =>
		new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error('Photo encoding failed'))),
				'image/jpeg',
				quality
			)
		);
	for (const quality of [0.82, 0.65, 0.45, 0.25]) {
		const blob = await encode(quality);
		if (blob.size <= MAX_THUMBNAIL_BYTES) return blob;
	}
	throw new Error('Photo exceeds thumbnail budget');
}
