/** The life module remains zone-local; this adapter is the only coordinate boundary. */
import { Camera, Group } from 'three';
import { HowlEvent, type LifeBlobs, type LifeFrame, type LivingWorld } from '../../life/index.ts';

export function offsetLifeBindings(
	x: number,
	z: number,
	blobs?: LifeBlobs,
	onHowl?: (event: HowlEvent) => void
) {
	const event = new HowlEvent();
	return {
		blobs: blobs
			? {
					add: (kind: 'actor' | 'item') => blobs.add(kind),
					set: (id: number, px: number, y: number, pz: number, radius: number, height?: number) =>
						blobs.set(id, px + x, y, pz + z, radius, height),
					hide: (id: number) => blobs.hide(id),
					remove: (id: number) => blobs.remove(id)
				}
			: undefined,
		onHowl: onHowl
			? (local: HowlEvent) => {
					event.x = local.x + x;
					event.y = local.y;
					event.z = local.z + z;
					event.index = local.index;
					event.chorus = local.chorus;
					onHowl(event);
				}
			: undefined
	};
}

export function offsetLife(life: LivingWorld, x: number, z: number): LivingWorld {
	if (!x && !z) return life;
	const object3d = new Group();
	object3d.position.set(x, 0, z);
	object3d.add(life.object3d);
	const camera = new Camera();
	camera.matrixAutoUpdate = false;
	const player = { x: 0, y: 0, z: 0 },
		velocity = { x: 0, y: 0, z: 0 };
	const local: LifeFrame = {
		dt: 0,
		time: 0,
		camera,
		playerPosition: player,
		playerVelocity: velocity,
		reducedMotion: false
	};
	const actors = life.actors.map((actor) => ({
		get id() {
			return actor.id;
		},
		get active() {
			return actor.active;
		},
		get companion() {
			return actor.companion;
		},
		get eyeHeight() {
			return actor.eyeHeight;
		},
		position: {
			get x() {
				return actor.position.x + x;
			},
			get y() {
				return actor.position.y;
			},
			get z() {
				return actor.position.z + z;
			}
		}
	}));
	let disposed = false;
	return {
		object3d,
		actors,
		update(frame) {
			camera.matrix.copy(frame.camera.matrixWorld);
			camera.matrix.elements[12] -= x;
			camera.matrix.elements[14] -= z;
			camera.matrixWorld.copy(camera.matrix);
			camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
			camera.position.setFromMatrixPosition(camera.matrixWorld);
			camera.projectionMatrix.copy(frame.camera.projectionMatrix);
			camera.projectionMatrixInverse.copy(frame.camera.projectionMatrixInverse);
			player.x = frame.playerPosition.x - x;
			player.y = frame.playerPosition.y;
			player.z = frame.playerPosition.z - z;
			velocity.x = frame.playerVelocity.x;
			velocity.y = frame.playerVelocity.y;
			velocity.z = frame.playerVelocity.z;
			local.dt = frame.dt;
			local.time = frame.time;
			local.reducedMotion = frame.reducedMotion;
			local.light = frame.light;
			local.playerGrounded = frame.playerGrounded;
			local.playerJumped = frame.playerJumped;
			life.update(local);
		},
		onStory: (state) => life.onStory(state),
		setQuality: (quality) => life.setQuality(quality),
		howl: () => life.howl(),
		debug: () => life.debug(),
		dispose() {
			if (disposed) return;
			disposed = true;
			life.dispose();
			object3d.removeFromParent();
			object3d.clear();
		}
	};
}
