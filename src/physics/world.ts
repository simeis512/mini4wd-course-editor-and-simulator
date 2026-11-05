import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rapier's idea of how big things are, m. Its tolerances and its speed
 * limit scale with it. At 0.01 every body was held under 4 m/s, but real
 * machines run 8-17 m/s (#139); 0.05 lifts the limit to 20 m/s.
 */
const LENGTH_UNIT = 0.05;

/**
 * Rapier holds every body's speed under 400 × lengthUnit m/s (#139,
 * research/rapier/speed-cap.test.ts on branch test/125-rapier-phenomena).
 */
export const SPEED_CAP = 400 * LENGTH_UNIT;

/**
 * Rapier's allowed overlap and contact look-ahead, as fractions of the
 * length unit. Its defaults (about 0.005 and 0.02) would be 0.25 mm and
 * 1 mm at our length unit, as much as a fence is thick (5 mm) lets rollers
 * sink into fences and snag on contacts that are not there yet (#27).
 * A fifth of them keeps the 0.05 mm and 0.2 mm the simulator had at a
 * length unit of 0.01 (#139, plan B).
 */
export const ALLOWED_LINEAR_ERROR = 0.05e-3 / LENGTH_UNIT;
export const PREDICTION_DISTANCE = 0.2e-3 / LENGTH_UNIT;

/** Initialise Rapier's WASM module and create an empty world with Earth gravity. */
export async function createPhysicsWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.lengthUnit = LENGTH_UNIT;
  world.integrationParameters.normalizedAllowedLinearError = ALLOWED_LINEAR_ERROR;
  world.integrationParameters.normalizedPredictionDistance = PREDICTION_DISTANCE;
  return world;
}
