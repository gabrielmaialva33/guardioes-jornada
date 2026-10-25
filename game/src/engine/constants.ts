/**
 * The one source of truth for the Secret Trail scale. The avatar is H = 3 units
 * tall and Roblox's classic avatar is 5 studs, so 1 stud = 0.6 units; every
 * Roblox default below is written in studs and converted with STUD.
 *
 * Sources, quoted per value:
 * - [PM] Roblox PlayerModule in Roblox-Client-Tracker a020070 (client v0.744,
 *   2026-10-21), as summarized in roblox-gameplay.md, "Conferência com o
 *   PlayerModule atual", and re-read in CameraInput.lua for the zoom speeds.
 * - [SP] Roblox StarterPlayer / Workspace defaults (create.roblox.com).
 * - [plano] plano.md v2 decisions. [POC] the owner's 3D proof of concept.
 * - [engine] choices of this engine, not taken from Roblox.
 */

const DEG = Math.PI / 180;

/** Avatar height in world units. */
export const AVATAR_HEIGHT = 3;
/** Roblox's classic avatar is 5 studs tall [SP]. */
export const STUD = AVATAR_HEIGHT / 5;

// --- Character -------------------------------------------------------------

/** 9.6 u/s: CharacterWalkSpeed 16 studs/s [SP]. */
export const WALK_SPEED = 16 * STUD;
/** 117.72 u/s²: Workspace.Gravity 196.2 studs/s² [SP]. */
export const GRAVITY = 196.2 * STUD;
/** 4.32 u: CharacterJumpHeight 7.2 studs, 1.44 H [SP]. */
export const JUMP_HEIGHT = 7.2 * STUD;
/** ≈ 31.89 u/s: the impulse that reaches JUMP_HEIGHT, √(2gh). */
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
/** ≈ 0.542 s on flat ground, 2v/g. */
export const JUMP_AIRTIME = (2 * JUMP_SPEED) / GRAVITY;
/** Jump still allowed this long after walking off a ledge, once [plano] (viverse used 0.2 s). */
export const COYOTE_TIME = 0.08;
/** A jump pressed this long before landing fires on landing [plano]. */
export const JUMP_BUFFER = 0.1;
/** Capsule radius [POC] (Player.svelte RADIUS); the R6 torso is 2 studs = 1.2 u wide. */
export const CAPSULE_RADIUS = 0.5;
/** Capsule height: the whole avatar. */
export const CAPSULE_HEIGHT = AVATAR_HEIGHT;
/** Tallest ledge walked up without jumping [plano]. */
export const STEP_HEIGHT = 0.4;
/** Steepest walkable ground [engine]; Roblox defaults to 89°, roblox-gameplay.md suggests 45–60° for adventure. */
export const MAX_SLOPE = 50 * DEG;
/** Terminal fall speed [engine]: bounds collision substeps; reached after ~42 u of free fall. */
export const MAX_FALL_SPEED = 100;
/** Body turn rate toward the movement, for damp(rate, dt) [PM] (AutoRotate ≈ damp(18..22)). */
export const FACING_RATE = 20;
/** Respawn at the last checkpoint this long after falling out [plano] (0.2–0.3 s). */
export const RESPAWN_DELAY = 0.25;

// --- Fixed timestep --------------------------------------------------------

/** Physics tick rate [engine] (roblox-web-stack.md §8). */
export const PHYSICS_HZ = 60;
/** Ticks run per rendered frame at most; the rest is dropped [engine]. */
export const MAX_STEPS_PER_FRAME = 4;

// --- Camera ----------------------------------------------------------------

/** Orbit pivot above the feet: R6 root at 3 studs + HEAD_OFFSET (0, 1.5, 0) [PM]. */
export const CAMERA_FOCUS_HEIGHT = 4.5 * STUD;
/** 7.5 u: ZOOM_DEFAULT 12.5 studs, now the same in portrait [PM]. */
export const CAMERA_DEFAULT_DISTANCE = 12.5 * STUD;
/** CameraMinZoomDistance 0.5 studs, also ZoomController MIN_FOCUS_DIST [PM]. */
export const CAMERA_MIN_DISTANCE = 0.5 * STUD;
/**
 * 24 u. Roblox Studio templates allow 128 studs [PM], but on the entry phones the
 * far view would draw most of the forest; 40 studs keeps the 200-draw budget.
 */
export const CAMERA_MAX_DISTANCE = 40 * STUD;
/** Zoom goals below 1 stud enter first person [PM] (FIRST_PERSON_DISTANCE_THRESHOLD). */
export const FIRST_PERSON_THRESHOLD = 1 * STUD;
/** First person keeps the camera 0.5 studs from the pivot [PM] (FIRST_PERSON_DISTANCE_MIN). */
export const FIRST_PERSON_DISTANCE = 0.5 * STUD;
/** Camera collision is skipped for zoom goals at or below 1 stud [PM] (ZoomController DIST_OPAQUE). */
export const CAMERA_OPAQUE_DISTANCE = 1 * STUD;
/** Hyperbolic zoom steps [PM] (BaseCamera ZOOM_SENSITIVITY_CURVATURE, per stud). */
export const ZOOM_CURVATURE = 0.5;
/** Critically damped zoom spring frequency in Hz [PM] (ZOOM_STIFFNESS). */
export const ZOOM_STIFFNESS = 4.5;
/** Avatar starts fading at 1.25 studs and is invisible at 0.5 [PM] (TransparencyController). */
export const FADE_START_DISTANCE = 1.25 * STUD;
export const FADE_END_DISTANCE = 0.5 * STUD;
/** Partial transparency changes at most this much per second [PM] (MAX_TWEEN_RATE). */
export const FADE_RATE = 2.8;
/** 1.05 u over the right shoulder in shift-lock [PM] (CAMERA_OFFSET_DEFAULT 1.75 studs). */
export const SHIFT_LOCK_OFFSET = 1.75 * STUD;
/** Pitch limits and the initial look-down angle [PM] (MIN_Y, MAX_Y, INITIAL_CAMERA_ANGLE). */
export const PITCH_MIN = -80 * DEG;
export const PITCH_MAX = 80 * DEG;
export const INITIAL_PITCH = -15 * DEG;
/** Vertical field of view: Roblox uses 70°, the POC 55°; to be decided on the device [plano]. */
export const CAMERA_FOV = 70;
/** Near plane [POC]; camera collision keeps it out of walls. */
export const CAMERA_NEAR = 0.1;

// --- Look and zoom input ---------------------------------------------------

/** Radians per CSS px [PM] (ROTATION_SPEED_MOUSE = (1, 0.77) · 0.5°). */
export const MOUSE_SENSITIVITY_X = 0.5 * DEG;
export const MOUSE_SENSITIVITY_Y = 0.77 * 0.5 * DEG;
/** Radians per CSS px [PM] (ROTATION_SPEED_TOUCH = (1, 0.66) · 1°). */
export const TOUCH_SENSITIVITY_X = 1 * DEG;
export const TOUCH_SENSITIVITY_Y = 0.66 * DEG;
/** Touch pitch slows away from the horizon down to 25% at ±90° [PM] (adjustTouchPitchSensitivity). */
export const TOUCH_PITCH_CURVE_POWER = 0.75;
export const TOUCH_PITCH_MIN_FRACTION = 0.25;
/** Zoom delta per CSS px of pinch diameter change [PM] (ZOOM_SPEED_TOUCH). */
export const PINCH_ZOOM_SPEED = 0.04;
/** Zoom delta per wheel notch [PM] (ZOOM_SPEED_MOUSE). */
export const WHEEL_ZOOM_SPEED = 1;
/** Zoom delta per second while I/O is held [PM]: ZOOM_SPEED_KEYS 0.1 per frame, at 60 Hz. */
export const KEY_ZOOM_SPEED = 0.1 * 60;
/** CSS px of wheel deltaY in one notch [engine] (Chromium reports 100). */
export const WHEEL_PIXELS_PER_NOTCH = 100;

// --- Touch layout (CSS px) -------------------------------------------------

/** Screens whose shorter side exceeds this get the big layout [PM] (minAxis > 500). */
export const BIG_SCREEN_MIN_AXIS = 500;
/** Dynamic thumbstick zone [PM]: landscape 40% × bottom 2/3, portrait 100% × bottom 40%. */
export const STICK_ZONE_LANDSCAPE = { width: 0.4, height: 2 / 3 };
export const STICK_ZONE_PORTRAIT = { width: 1, height: 0.4 };
/** Thumbstick dead zone [PM] (RADIUS_OF_DEAD_ZONE 2 px, 4 px on big screens). */
export const STICK_DEAD_ZONE = 2;
export const STICK_DEAD_ZONE_BIG = 4;
/** Full speed at this thumb travel [PM] (RADIUS_OF_MAX_SPEED 20 px, 40 px on big screens). */
export const STICK_MAX_RADIUS = 20;
export const STICK_MAX_RADIUS_BIG = 40;
/** Jump button size and inset from the bottom-right corner [PM] (TouchJump). */
export const JUMP_BUTTON = { size: 70, right: 25, bottom: 20 };
export const JUMP_BUTTON_BIG = { size: 120, right: 50, bottom: 90 };
