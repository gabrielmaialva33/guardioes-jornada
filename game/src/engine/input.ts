/**
 * Game input in the Roblox mould: a dynamic thumbstick born where the thumb
 * lands in the left zone, one-finger look and two-finger pinch anywhere else,
 * HUD buttons as capture targets, the keyboard and the mouse (right-drag to
 * orbit, wheel to zoom, pointer lock in shift-lock). Every pointer keeps the role
 * it got on pointerdown, keyed by pointerId, so stick, look and jump work at the
 * same time and a look drag that slides over the jump button never jumps.
 *
 * InputModel is plain state with no DOM; attachInput feeds it from an element
 * and removes every listener on detach (nothing is registered on import).
 */
import {
	BIG_SCREEN_MIN_AXIS,
	JUMP_BUTTON,
	JUMP_BUTTON_BIG,
	KEY_ZOOM_SPEED,
	PINCH_ZOOM_SPEED,
	STICK_DEAD_ZONE,
	STICK_DEAD_ZONE_BIG,
	STICK_MAX_RADIUS,
	STICK_MAX_RADIUS_BIG,
	STICK_ZONE_LANDSCAPE,
	STICK_ZONE_PORTRAIT,
	WHEEL_PIXELS_PER_NOTCH,
	WHEEL_ZOOM_SPEED
} from './constants.ts';

export type ButtonRole = 'jump' | 'action' | 'shiftLock' | 'emote';
export type PointerKind = 'mouse' | 'touch' | 'pen';

/** A pointer event reduced to what the model needs. */
export interface PointerSample {
	id: number;
	kind: PointerKind;
	/** CSS px from the input element's top-left corner. */
	x: number;
	y: number;
	/** PointerEvent.button on pointerdown: 0 left, 2 right. */
	button?: number;
	/** HUD button under the pointer when it went down ([data-game-button]). */
	target?: ButtonRole | null;
}

/** Everything the game reads once per frame; edges and deltas cover the time since the last sample. */
export interface InputFrame {
	/** Movement intent relative to the camera: x right, y forward, length ≤ 1. */
	moveX: number;
	moveY: number;
	jumpHeld: boolean;
	/** Jump went down since the last frame, even if it was already released. */
	jumpPressed: boolean;
	actionHeld: boolean;
	actionPressed: boolean;
	emotePressed: boolean;
	/** Shift-lock mode (toggled by Shift or the lock button). */
	shiftLock: boolean;
	/** Orbit input in CSS px, split by source because the sensitivities differ. */
	mouseLookX: number;
	mouseLookY: number;
	touchLookX: number;
	touchLookY: number;
	/** Roblox zoom delta: positive zooms out. */
	zoomDelta: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Roblox's touch layout for a screen size, for hit-testing here and drawing the HUD. */
export interface TouchOptions {
	leftHanded?: boolean;
	largeButtons?: boolean;
	insets?: { left: number; right: number; top: number; bottom: number };
}
export interface TouchLayout {
	thumbstickSize: number;
	ringSize: number;
	outerRingSize: number;
	ghostX: number;
	ghostY: number;
	bigScreen: boolean;
	stickZone: Rect;
	jumpButton: Rect;
	deadZone: number;
	maxRadius: number;
}

/** The thumbstick for the HUD: where it was born and where the thumb is now. */
export interface ThumbstickView {
	active: boolean;
	originX: number;
	originY: number;
	x: number;
	y: number;
}

export function touchLayout(width: number, height: number, options: TouchOptions = {}): TouchLayout {
	const bigScreen = Math.min(width, height) > BIG_SCREEN_MIN_AXIS || options.largeButtons === true;
	const zone = width >= height ? STICK_ZONE_LANDSCAPE : STICK_ZONE_PORTRAIT;
	const jump = bigScreen ? JUMP_BUTTON_BIG : JUMP_BUTTON;
	const insets = options.insets ?? { left: 0, right: 0, top: 0, bottom: 0 },
		ring = bigScreen ? 40 : 20;
	return {
		bigScreen,
		thumbstickSize: bigScreen ? 90 : 45,
		ringSize: ring,
		outerRingSize: bigScreen ? 148 : 74,
		ghostX: options.leftHanded ? width - insets.right - ring * 3.3 : insets.left + ring * 3.3,
		ghostY: height - insets.bottom - ring * 2.8,
		stickZone: {
			x: options.leftHanded ? width * (1 - zone.width) : 0,
			y: height * (1 - zone.height),
			width: width * zone.width,
			height: height * zone.height
		},
		jumpButton: {
			x: options.leftHanded ? insets.left + jump.right : width - insets.right - jump.right - jump.size,
			y: height - insets.bottom - jump.bottom - jump.size,
			width: jump.size,
			height: jump.size
		},
		deadZone: bigScreen ? STICK_DEAD_ZONE_BIG : STICK_DEAD_ZONE,
		maxRadius: bigScreen ? STICK_MAX_RADIUS_BIG : STICK_MAX_RADIUS
	};
}

/**
 * Roblox DynamicThumbstick: nothing inside the dead zone, then speed grows with
 * the thumb's travel and is full at the max radius. Screen y grows downward;
 * the result's y is forward.
 */
export function thumbstickVector(dx: number, dy: number, deadZone: number, maxRadius: number) {
	const length = Math.hypot(dx, dy);
	if (!(length >= deadZone) || length === 0) return { x: 0, y: 0 };
	const scale = Math.min(1, length / maxRadius) / length;
	return { x: dx * scale, y: -dy * scale };
}

const MOVE_KEYS: Record<string, readonly [number, number]> = {
	KeyW: [0, 1],
	ArrowUp: [0, 1],
	KeyS: [0, -1],
	ArrowDown: [0, -1],
	KeyA: [-1, 0],
	ArrowLeft: [-1, 0],
	KeyD: [1, 0],
	ArrowRight: [1, 0]
};
const OTHER_KEYS = new Set(['Space', 'KeyE', 'KeyI', 'KeyO', 'ShiftLeft', 'ShiftRight']);

type Role = 'stick' | 'mouseLook' | 'touchLook' | ButtonRole;

interface Pointer {
	role: Role;
	x: number;
	y: number;
}

export class InputModel {
	/** Shift-lock mode; a mode, so it survives blur. */
	shiftLock = false;
	/** The mouse is captured with pointer lock: plain mouse moves orbit. */
	pointerLocked = false;
	readonly frame: InputFrame = {
		moveX: 0,
		moveY: 0,
		jumpHeld: false,
		jumpPressed: false,
		actionHeld: false,
		actionPressed: false,
		emotePressed: false,
		shiftLock: false,
		mouseLookX: 0,
		mouseLookY: 0,
		touchLookX: 0,
		touchLookY: 0,
		zoomDelta: 0
	};
	#layout = touchLayout(0, 0);
	#width = 0;
	#height = 0;
	#options: TouchOptions = {};
	readonly #pointers = new Map<number, Pointer>();
	/** Touch look pointers in arrival order: one orbits, the first two pinch. */
	readonly #looks: number[] = [];
	readonly #keys = new Set<string>();
	#stick: { id: number; originX: number; originY: number; x: number; y: number } | null = null;
	#pinch: number | null = null;
	#jumpPressed = false;
	#actionPressed = false;
	#emotePressed = false;
	#mouseX = 0;
	#mouseY = 0;
	#touchX = 0;
	#touchY = 0;
	#zoom = 0;

	get layout(): TouchLayout {
		return this.#layout;
	}

	get stick(): ThumbstickView {
		const stick = this.#stick;
		return stick
			? { active: true, originX: stick.originX, originY: stick.originY, x: stick.x, y: stick.y }
			: { active: false, originX: 0, originY: 0, x: 0, y: 0 };
	}

	resize(width: number, height: number) {
		this.#width = width;
		this.#height = height;
		this.#layout = touchLayout(width, height, this.#options);
	}

	configure(options: TouchOptions) {
		this.releaseAll();
		this.#options = { ...this.#options, ...options };
		this.resize(this.#width, this.#height);
	}
	/** Returns true when the pointer got a role (capture it and prevent the default). */
	pointerDown(sample: PointerSample): boolean {
		if (this.#pointers.has(sample.id)) return false;
		let role: Role;
		if (sample.target) {
			role = sample.target;
			this.#press(sample.target);
		} else if (sample.kind === 'mouse') {
			// Left click stays free for the world and the UI; right-drag orbits (Roblox).
			if (sample.button !== 2) return false;
			role = 'mouseLook';
		} else if (!this.#stick && inside(sample, this.#layout.stickZone)) {
			role = 'stick';
			this.#stick = { id: sample.id, originX: sample.x, originY: sample.y, x: sample.x, y: sample.y };
		} else {
			role = 'touchLook';
			this.#looks.push(sample.id);
		}
		this.#pointers.set(sample.id, { role, x: sample.x, y: sample.y });
		if (role === 'touchLook') this.#resetPinch();
		return true;
	}

	pointerMove(sample: PointerSample) {
		const pointer = this.#pointers.get(sample.id);
		if (!pointer) return;
		const dx = sample.x - pointer.x;
		const dy = sample.y - pointer.y;
		pointer.x = sample.x;
		pointer.y = sample.y;
		if (pointer.role === 'stick' && this.#stick) {
			this.#stick.x = sample.x;
			this.#stick.y = sample.y;
		} else if (pointer.role === 'mouseLook' && !this.pointerLocked) {
			this.#mouseX += dx;
			this.#mouseY += dy;
		} else if (pointer.role === 'touchLook') {
			if (this.#looks.length === 1) {
				this.#touchX += dx;
				this.#touchY += dy;
			} else if (this.#pinch !== null) {
				const diameter = this.#pinchDiameter();
				this.#zoom -= (diameter - this.#pinch) * PINCH_ZOOM_SPEED;
				this.#pinch = diameter;
			}
		}
	}

	/** pointerup, pointercancel and lostpointercapture all end the pointer's role. */
	pointerUp(id: number) {
		const pointer = this.#pointers.get(id);
		if (!pointer) return;
		this.#pointers.delete(id);
		if (pointer.role === 'stick') this.#stick = null;
		if (pointer.role === 'touchLook') {
			this.#looks.splice(this.#looks.indexOf(id), 1);
			this.#resetPinch();
		}
	}

	/** Raw mouse movement while the pointer is locked. */
	lockedMouseMove(dx: number, dy: number) {
		if (!this.pointerLocked) return;
		this.#mouseX += dx;
		this.#mouseY += dy;
	}

	setPointerLocked(locked: boolean) {
		this.pointerLocked = locked;
	}

	/** Returns true when the key belongs to the game (prevent its default, e.g. page scroll). */
	keyDown(code: string, repeat = false): boolean {
		if (!(code in MOVE_KEYS) && !OTHER_KEYS.has(code)) return false;
		this.#keys.add(code);
		if (repeat) return true;
		if (code === 'Space') this.#jumpPressed = true;
		else if (code === 'KeyE') this.#actionPressed = true;
		else if (code === 'ShiftLeft' || code === 'ShiftRight') this.shiftLock = !this.shiftLock;
		return true;
	}

	keyUp(code: string) {
		this.#keys.delete(code);
	}

	/** Wheel movement in notches (positive = toward the user = zoom out). */
	wheel(notches: number) {
		if (Number.isFinite(notches)) this.#zoom += notches * WHEEL_ZOOM_SPEED;
	}

	/** A HUD button activated without a pointer (keyboard, assistive tech). */
	tapButton(role: ButtonRole) {
		this.#press(role);
	}

	/** Lets go of everything held: blur, hidden page, modal, detach. Shift-lock stays. */
	releaseAll() {
		this.#pointers.clear();
		this.#looks.length = 0;
		this.#keys.clear();
		this.#stick = null;
		this.#pinch = null;
	}

	/** Reads and clears this frame's input; `dt` scales the held zoom keys. */
	sample(dt: number): InputFrame {
		const frame = this.frame;
		let x = 0;
		let y = 0;
		for (const code of this.#keys) {
			const direction = MOVE_KEYS[code];
			if (direction) {
				x += direction[0];
				y += direction[1];
			}
		}
		const stick = this.#stick;
		if (stick) {
			const vector = thumbstickVector(
				stick.x - stick.originX,
				stick.y - stick.originY,
				this.#layout.deadZone,
				this.#layout.maxRadius
			);
			x += vector.x;
			y += vector.y;
		}
		const length = Math.hypot(x, y);
		frame.moveX = length > 1 ? x / length : x;
		frame.moveY = length > 1 ? y / length : y;
		frame.jumpHeld = this.#keys.has('Space') || this.#holding('jump');
		frame.actionHeld = this.#keys.has('KeyE') || this.#holding('action');
		frame.jumpPressed = this.#jumpPressed;
		frame.actionPressed = this.#actionPressed;
		frame.emotePressed = this.#emotePressed;
		frame.shiftLock = this.shiftLock;
		frame.mouseLookX = this.#mouseX;
		frame.mouseLookY = this.#mouseY;
		frame.touchLookX = this.#touchX;
		frame.touchLookY = this.#touchY;
		const keyZoom = (this.#keys.has('KeyO') ? 1 : 0) - (this.#keys.has('KeyI') ? 1 : 0);
		frame.zoomDelta = this.#zoom + (Number.isFinite(dt) ? keyZoom * KEY_ZOOM_SPEED * dt : 0);
		this.#jumpPressed = this.#actionPressed = this.#emotePressed = false;
		this.#mouseX = this.#mouseY = this.#touchX = this.#touchY = this.#zoom = 0;
		return frame;
	}

	#press(role: ButtonRole) {
		if (role === 'jump') this.#jumpPressed = true;
		else if (role === 'action') this.#actionPressed = true;
		else if (role === 'emote') this.#emotePressed = true;
		else this.shiftLock = !this.shiftLock;
	}

	#holding(role: ButtonRole): boolean {
		for (const pointer of this.#pointers.values()) if (pointer.role === role) return true;
		return false;
	}

	#pinchDiameter(): number {
		const a = this.#pointers.get(this.#looks[0]);
		const b = this.#pointers.get(this.#looks[1]);
		return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
	}

	/** A finger joined or left: start measuring the pinch afresh so nothing jumps. */
	#resetPinch() {
		this.#pinch = this.#looks.length >= 2 ? this.#pinchDiameter() : null;
	}
}

function inside(point: { x: number; y: number }, rect: Rect): boolean {
	return (
		point.x >= rect.x &&
		point.x <= rect.x + rect.width &&
		point.y >= rect.y &&
		point.y <= rect.y + rect.height
	);
}

export interface AttachOptions {
	/** Whether the mouse should be captured with pointer lock; defaults to while shift-lock is on. */
	wantsPointerLock?: () => boolean;
}

/**
 * Wires an element (the game's wrapper: canvas plus HUD) to the model. Keys are
 * read from the window while attached, except in text fields or with Ctrl/Alt/Meta.
 * HUD buttons are marked with data-game-button="jump" | "action" | "shiftLock" | "emote".
 * The element should have touch-action: none and user-select: none.
 * Returns detach, which removes every listener and releases everything held.
 */
export function attachInput(
	element: HTMLElement,
	model: InputModel,
	options: AttachOptions = {}
): () => void {
	const controller = new AbortController();
	const signal = controller.signal;
	const wantsPointerLock = options.wantsPointerLock ?? (() => model.shiftLock);
	let rect = element.getBoundingClientRect();
	const measure = () => {
		rect = element.getBoundingClientRect();
		model.resize(rect.width, rect.height);
	};
	const sample = (event: PointerEvent): PointerSample => ({
		id: event.pointerId,
		kind: event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse',
		x: event.clientX - rect.left,
		y: event.clientY - rect.top,
		button: event.button,
		target: buttonRole(event.target, element)
	});
	// Pointer lock needs a user activation: only called from pointerdown and keydown.
	const syncPointerLock = () => {
		const locked = document.pointerLockElement === element;
		const wanted = wantsPointerLock();
		if (wanted && !locked) requestPointerLock(element);
		else if (!wanted && locked) document.exitPointerLock();
	};

	measure();
	element.addEventListener(
		'pointerdown',
		(event) => {
			measure();
			const claimed = model.pointerDown(sample(event));
			if (event.pointerType === 'mouse' || event.pointerType === '') syncPointerLock();
			if (!claimed) return;
			event.preventDefault();
			try {
				element.setPointerCapture(event.pointerId);
			} catch {
				// The pointer is already gone; pointerup will not come, so end it now.
				model.pointerUp(event.pointerId);
			}
		},
		{ signal }
	);
	element.addEventListener(
		'pointermove',
		(event) => {
			if (model.pointerLocked && event.pointerType === 'mouse')
				model.lockedMouseMove(event.movementX, event.movementY);
			else model.pointerMove(sample(event));
		},
		{ signal }
	);
	const end = (event: PointerEvent) => model.pointerUp(event.pointerId);
	element.addEventListener('pointerup', end, { signal });
	element.addEventListener('pointercancel', end, { signal });
	element.addEventListener('lostpointercapture', end, { signal });
	element.addEventListener(
		'wheel',
		(event) => {
			event.preventDefault();
			model.wheel(wheelNotches(event));
		},
		{ signal, passive: false }
	);
	element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
	window.addEventListener(
		'keydown',
		(event) => {
			if (event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return;
			if (model.keyDown(event.code, event.repeat)) event.preventDefault();
			if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') syncPointerLock();
		},
		{ signal }
	);
	window.addEventListener('keyup', (event) => model.keyUp(event.code), { signal });
	window.addEventListener('blur', () => model.releaseAll(), { signal });
	document.addEventListener(
		'visibilitychange',
		() => {
			if (document.hidden) model.releaseAll();
		},
		{ signal }
	);
	document.addEventListener(
		'pointerlockchange',
		() => model.setPointerLocked(document.pointerLockElement === element),
		{ signal }
	);
	const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
	observer?.observe(element);

	return () => {
		controller.abort();
		observer?.disconnect();
		if (document.pointerLockElement === element) document.exitPointerLock();
		model.setPointerLocked(false);
		model.releaseAll();
	};
}

function buttonRole(target: EventTarget | null, root: HTMLElement): ButtonRole | null {
	const button =
		typeof Element !== 'undefined' && target instanceof Element
			? target.closest<HTMLElement>('[data-game-button]')
			: null;
	if (!button || !root.contains(button)) return null;
	const role = button.dataset.gameButton;
	return role === 'jump' || role === 'action' || role === 'shiftLock' || role === 'emote' ? role : null;
}

function isTextField(target: EventTarget | null): boolean {
	return (
		typeof HTMLElement !== 'undefined' &&
		target instanceof HTMLElement &&
		(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
	);
}

/** Wheel deltaY in notches: pixels, lines (3 per notch) or pages. */
export function wheelNotches(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
	if (event.deltaMode === 1) return event.deltaY / 3;
	if (event.deltaMode === 2) return event.deltaY;
	return event.deltaY / WHEEL_PIXELS_PER_NOTCH;
}

/** Raw (unaccelerated) movement where supported; Firefox rejects the option, so retry without it. */
function requestPointerLock(element: HTMLElement) {
	const plain = () => {
		try {
			element.requestPointerLock()?.catch(() => {});
		} catch {
			// Not allowed right now (no activation, or just exited with Esc).
		}
	};
	try {
		const result = element.requestPointerLock({ unadjustedMovement: true });
		if (result) result.catch(plain);
	} catch {
		plain();
	}
}
