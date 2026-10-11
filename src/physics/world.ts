import RAPIER from '@dimforge/rapier3d-compat';

/** Initialise Rapier's WASM module and create an empty world with Earth gravity. */
export async function createPhysicsWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  return new RAPIER.World({ x: 0, y: -9.81, z: 0 });
}
