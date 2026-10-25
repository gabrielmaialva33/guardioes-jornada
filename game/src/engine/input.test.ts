import { afterEach, expect, it, vi } from 'vitest';
import {
	attachInput,
	InputModel,
	type PointerSample,
	thumbstickVector,
	touchLayout,
	wheelNotches
} from './input.ts';

/** A landscape phone: stick zone x < 320, y > 133. */
function phone() {
	const model = new InputModel();
	model.resize(800, 400);
	return model;
}
const touch = (id: number, x: number, y: number, extra: Partial<PointerSample> = {}): PointerSample => ({
	id,
	kind: 'touch',
	x,
	y,
	...extra
});

it('lays out the Roblox touch zones for phones, portrait and tablets', () => {
	const landscape = touchLayout(800, 400);
	expect(landscape.bigScreen).toBe(false);
	const zone = landscape.stickZone;
	expect([zone.x, zone.width]).toEqual([0, 320]);
	expect(zone.y).toBeCloseTo(400 / 3, 9);
	expect(zone.y + zone.height).toBeCloseTo(400, 9);
	expect(landscape.jumpButton).toEqual({ x: 705, y: 310, width: 70, height: 70 });
	expect(touchLayout(400, 800).stickZone).toEqual({ x: 0, y: 480, width: 400, height: 320 });
	const tablet = touchLayout(1024, 768);
	expect(tablet).toMatchObject({ bigScreen: true, deadZone: 4, maxRadius: 40 });
	expect(tablet.jumpButton).toEqual({ x: 1024 - 170, y: 768 - 210, width: 120, height: 120 });
});

it('ignores the thumbstick dead zone and reaches full speed at the max radius', () => {
	expect(thumbstickVector(1.9, 0, 2, 20)).toEqual({ x: 0, y: 0 });
	expect(thumbstickVector(2, 0, 2, 20).x).toBeCloseTo(0.1, 12);
	expect(thumbstickVector(0, -10, 2, 20).y).toBeCloseTo(0.5, 12);
	const full = thumbstickVector(60, -80, 2, 20);
	expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 12);
	expect(full.x / full.y).toBeCloseTo(60 / 80, 12);
});

it('runs stick, look and jump at once with three fingers', () => {
	const model = phone();
	expect(model.pointerDown(touch(1, 100, 300))).toBe(true);
	expect(model.pointerDown(touch(2, 600, 150))).toBe(true);
	expect(model.pointerDown(touch(3, 740, 345, { target: 'jump' }))).toBe(true);
	model.pointerMove(touch(1, 100, 285)); // 15 px up: forward at 75%
	model.pointerMove(touch(2, 630, 140));
	const frame = model.sample(1 / 60);
	expect(frame.moveX).toBeCloseTo(0, 12);
	expect(frame.moveY).toBeCloseTo(0.75, 12);
	expect([frame.touchLookX, frame.touchLookY]).toEqual([30, -10]);
	expect(frame.jumpPressed).toBe(true);
	expect(frame.jumpHeld).toBe(true);
	expect(model.stick).toMatchObject({ active: true, originX: 100, originY: 300, y: 285 });

	// The look finger crossing the jump button keeps looking; only the jump finger jumps.
	model.pointerMove(touch(2, 740, 345));
	model.pointerUp(3);
	const next = model.sample(1 / 60);
	expect(next.jumpPressed).toBe(false);
	expect(next.jumpHeld).toBe(false);
	expect(next.touchLookX).toBe(110);
	expect(next.moveY).toBeCloseTo(0.75, 12);
});

it('gives a second finger in the stick zone to the camera', () => {
	const model = phone();
	model.pointerDown(touch(1, 100, 300));
	model.pointerDown(touch(2, 200, 300));
	model.pointerMove(touch(2, 210, 300));
	expect(model.sample(1 / 60).touchLookX).toBe(10);
});

it('pinches with two look fingers and resumes orbiting without a jump when one lifts', () => {
	const model = phone();
	model.pointerDown(touch(1, 500, 200));
	model.pointerDown(touch(2, 600, 200));
	model.pointerMove(touch(2, 650, 200));
	model.pointerMove(touch(1, 450, 200));
	let frame = model.sample(1 / 60);
	expect(frame.zoomDelta).toBeCloseTo(-100 * 0.04, 12);
	expect(frame.touchLookX).toBe(0);
	model.pointerUp(2);
	model.pointerMove(touch(1, 460, 205));
	frame = model.sample(1 / 60);
	expect([frame.touchLookX, frame.touchLookY]).toEqual([10, 5]);
	expect(frame.zoomDelta).toBe(0);
	// A new second finger starts a fresh pinch, measured from where it lands.
	model.pointerDown(touch(3, 760, 205));
	model.pointerMove(touch(3, 760, 205));
	expect(model.sample(1 / 60).zoomDelta).toBe(0);
});

it('ends roles on cancel, ignores strangers and releases everything on blur', () => {
	const model = phone();
	model.pointerDown(touch(1, 100, 300));
	model.pointerMove(touch(1, 100, 250));
	model.pointerUp(1); // pointercancel and lostpointercapture end the same way
	model.pointerUp(1);
	model.pointerMove(touch(1, 100, 200));
	model.pointerMove(touch(99, 0, 0));
	expect(model.sample(1 / 60).moveY).toBe(0);

	model.pointerDown(touch(4, 100, 300));
	model.pointerMove(touch(4, 140, 300));
	model.keyDown('KeyW');
	model.keyDown('Space');
	model.keyDown('ShiftLeft');
	model.releaseAll();
	model.pointerMove(touch(4, 180, 300));
	const frame = model.sample(1 / 60);
	expect([frame.moveX, frame.moveY, frame.jumpHeld]).toEqual([0, 0, false]);
	expect(model.stick.active).toBe(false);
	expect(frame.shiftLock).toBe(true);
});

it('maps the keyboard: WASD, arrows that strafe, Space, E, Shift and I/O', () => {
	const model = phone();
	expect(model.keyDown('KeyW')).toBe(true);
	expect(model.keyDown('ArrowLeft')).toBe(true);
	let frame = model.sample(1 / 60);
	expect(frame.moveX).toBeCloseTo(-Math.SQRT1_2, 12);
	expect(frame.moveY).toBeCloseTo(Math.SQRT1_2, 12);
	model.keyUp('KeyW');
	model.keyUp('ArrowLeft');

	model.keyDown('Space');
	model.keyDown('Space', true);
	model.keyDown('KeyE');
	frame = model.sample(1 / 60);
	expect(frame).toMatchObject({ jumpPressed: true, jumpHeld: true, actionPressed: true, actionHeld: true });
	model.keyDown('Space', true);
	expect(model.sample(1 / 60).jumpPressed).toBe(false);
	model.keyUp('Space');
	expect(model.sample(1 / 60).jumpHeld).toBe(false);

	model.keyDown('ShiftRight');
	expect(model.sample(1 / 60).shiftLock).toBe(true);
	model.keyDown('ShiftRight', true);
	expect(model.sample(1 / 60).shiftLock).toBe(true);

	model.keyDown('KeyO');
	expect(model.sample(0.5).zoomDelta).toBeCloseTo(3, 12);
	model.keyUp('KeyO');
	model.keyDown('KeyI');
	expect(model.sample(1 / 60).zoomDelta).toBeCloseTo(-0.1, 12);
	expect(model.keyDown('KeyQ')).toBe(false);
});

it('orbits the mouse only on right-drag, or freely while the pointer is locked', () => {
	const model = phone();
	expect(model.pointerDown({ id: 1, kind: 'mouse', x: 400, y: 200, button: 0 })).toBe(false);
	expect(model.pointerDown({ id: 2, kind: 'mouse', x: 400, y: 200, button: 2 })).toBe(true);
	model.pointerMove({ id: 2, kind: 'mouse', x: 420, y: 190 });
	let frame = model.sample(1 / 60);
	expect([frame.mouseLookX, frame.mouseLookY, frame.touchLookX]).toEqual([20, -10, 0]);
	model.setPointerLocked(true);
	model.lockedMouseMove(5, 3);
	model.pointerMove({ id: 2, kind: 'mouse', x: 440, y: 190 }); // not counted twice
	frame = model.sample(1 / 60);
	expect([frame.mouseLookX, frame.mouseLookY]).toEqual([5, 3]);
	model.wheel(wheelNotches({ deltaY: 200, deltaMode: 0 }));
	expect(model.sample(1 / 60).zoomDelta).toBe(2);
	expect(wheelNotches({ deltaY: -3, deltaMode: 1 })).toBe(-1);
});

it('toggles shift-lock and taps HUD buttons', () => {
	const model = phone();
	model.pointerDown(touch(1, 760, 60, { target: 'shiftLock' }));
	model.pointerDown(touch(2, 700, 60, { target: 'emote' }));
	model.tapButton('action');
	const frame = model.sample(1 / 60);
	expect(frame).toMatchObject({
		shiftLock: true,
		emotePressed: true,
		actionPressed: true,
		actionHeld: false
	});
});

afterEach(() => vi.unstubAllGlobals());

it('attaches without global side effects and detaches every listener', () => {
	const window = new EventTarget();
	const document = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null });
	vi.stubGlobal('window', window);
	vi.stubGlobal('document', document);
	const element = Object.assign(new EventTarget(), {
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
		setPointerCapture: vi.fn(),
		contains: () => true
	}) as unknown as HTMLElement;
	const fire = (target: EventTarget, type: string, fields: object) =>
		target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));
	const model = new InputModel();

	const detach = attachInput(element, model);
	fire(element, 'pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 100, clientY: 300, button: 0 });
	fire(element, 'pointermove', { pointerId: 7, pointerType: 'touch', clientX: 100, clientY: 280 });
	fire(window, 'keydown', { code: 'Space', repeat: false });
	expect(element.setPointerCapture).toHaveBeenCalledWith(7);
	let frame = model.sample(1 / 60);
	expect(frame.moveY).toBeCloseTo(1, 12);
	expect(frame.jumpPressed).toBe(true);

	fire(element, 'lostpointercapture', { pointerId: 7 });
	expect(model.sample(1 / 60).moveY).toBe(0);
	fire(window, 'blur', {});
	expect(model.sample(1 / 60).jumpHeld).toBe(false);

	detach();
	fire(element, 'pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 100, clientY: 300, button: 0 });
	fire(element, 'pointermove', { pointerId: 8, pointerType: 'touch', clientX: 100, clientY: 260 });
	fire(window, 'keydown', { code: 'KeyW', repeat: false });
	frame = model.sample(1 / 60);
	expect([frame.moveX, frame.moveY, frame.jumpPressed]).toEqual([0, 0, false]);
});
