import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rapier's idea of how big things are, m. Its tolerances scale with it
 * (1 mm of overlap and 2 mm of look-ahead at the default 1 m), which is as
 * much as a fence is thick (5 mm) and lets rollers sink into fences and
 * snag on contacts that are not there yet (#27).
 */
const LENGTH_UNIT = 0.01;

/** Initialise Rapier's WASM module and create an empty world with Earth gravity. */
export async function createPhysicsWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.lengthUnit = LENGTH_UNIT;
  return world;
}
