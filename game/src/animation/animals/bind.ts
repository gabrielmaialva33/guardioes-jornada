/**
 * The three.js side of the animals: binding a loaded Cube Pets model and
 * writing an Animal's pose and placement onto it. Builds on ../rig.ts.
 */
import type { Object3D } from 'three';
import { applyToRig, bindRig, type RigBinding } from '../rig.ts';
import type { Animal } from './animal.ts';
import { HEAD, LIMB_BL, LIMB_BR, LIMB_FL, LIMB_FR, layoutOf, MODEL_RIGS } from './rigs.ts';
import { SPECIES, type SpeciesId } from './species.ts';

export interface AnimalRig {
	readonly binding: RigBinding;
	/** True when the model has its own `head` node (pass it to createAnimal as hasHead). */
	readonly hasHead: boolean;
	/** World units per model unit: the scale bindAnimal set on the placed object. */
	readonly scale: number;
}

/**
 * Binds a clone of monkey/tiger/koala/parrot.glb's scene for one species. Call
 * once per instance at load time (allocates). It also stretches the legs of
 * long-limbed species once (node scale y, never touched per frame): the
 * muriqui's arms and the sloth's forelimbs (species.ts limbScale).
 */
export function bindAnimal(model: Object3D, species: SpeciesId): AnimalRig {
	const params = SPECIES[species];
	const binding = bindRig(model, layoutOf(params.model), MODEL_RIGS[params.model]);
	if (params.model !== 'parrot') {
		const stretch = (slot: number, factor: number) => {
			const node = binding.nodes[slot];
			if (node && factor !== 1) node.scale.y = binding.restScales[slot].y * factor;
		};
		stretch(LIMB_FL, params.limbScale.front);
		stretch(LIMB_FR, params.limbScale.front);
		stretch(LIMB_BL, params.limbScale.hind);
		stretch(LIMB_BR, params.limbScale.hind);
	}
	return { binding, hasHead: binding.nodes[HEAD] !== null, scale: params.scale };
}

/**
 * Writes the animal's last update onto the scene: the placement on `object`
 * (the group that holds the model: position, yaw and the species scale) and
 * the pose on the bound nodes. No allocation.
 */
export function placeAnimal(animal: Animal, object: Object3D, rig: AnimalRig) {
	const motion = animal.motion;
	object.position.set(motion.x, motion.y, motion.z);
	object.rotation.set(0, motion.yaw, 0);
	object.scale.setScalar(rig.scale);
	applyToRig(animal.pose, rig.binding);
}
