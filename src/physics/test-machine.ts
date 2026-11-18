import type { MachineSpec } from './machine-spec';

// The machine the run tests were first tuned with (#27), before machines
// came from setups (#32): kept so that tests of how a run is judged (laps,
// lanes, the wrong way) do not change with the standard setup's figures.

const ROLLER = { radius: 0.0065, height: 0.006 };
const ROLLER_X = 0.105 / 2 - ROLLER.radius;
const ROLLER_Y = 0.012;

export const TEST_MACHINE: MachineSpec = {
  mass: 0.13,
  size: [0.08, 0.02, 0.15],
  clearance: 0.003,
  tyreRadius: 0.013,
  tyreWidth: 0.011,
  wheelbase: 0.08,
  tread: 0.072,
  gearRatio: 4.2,
  efficiency: 0.7,
  motor: { freeRpm: 12000, stallTorque: 0.0035 },
  rollers: [
    { at: [ROLLER_X, ROLLER_Y, 0.075], ...ROLLER },
    { at: [-ROLLER_X, ROLLER_Y, 0.075], ...ROLLER },
    { at: [ROLLER_X, ROLLER_Y, -0.07], ...ROLLER },
    { at: [-ROLLER_X, ROLLER_Y, -0.07], ...ROLLER },
  ],
  grip: 1,
  rollerFriction: 0.01,
  rollerRestitution: 0.2,
};
