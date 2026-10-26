// 4. Slide dampers (スライドダンパー): the bumper slides sideways on the
// chassis against a spring, and the grease damps it. Can Rapier give the
// spring's push-back and the grease's damping, at the values we choose?
//
// A 10 g bumper on a prismatic joint to a fixed chassis, knocked sideways
// at 0.5 m/s (a roller hitting a fence corner). The spring and the viscous
// damping are the joint's motor (force based: N/m, N·s/m); dry friction,
// which one motor cannot add on top, is a second joint's motor along the
// same slide, held at speed 0 with at most the friction force.
import { describe, expect, it } from 'vitest';
import { lab, RAPIER } from './lab';

const M = 0.01;

async function knock(k: number, c: number, dry = 0) {
  const world = await lab(0);
  const chassis = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const bumper = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setLinvel(0.5, 0, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.01, 0.003, 0.005).setMass(M), bumper);
  const joint = world.createImpulseJoint(
    RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
    chassis, bumper, true,
  ) as RAPIER.PrismaticImpulseJoint;
  joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
  joint.configureMotorPosition(0, k, c);
  joint.setLimits(-0.004, 0.004);
  if (dry) {
    // Dry friction as a second joint along the same slide: a motor holding
    // the speed at 0 with no more than the friction force, so it sticks too.
    const rub = world.createImpulseJoint(
      RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
      chassis, bumper, true,
    ) as RAPIER.PrismaticImpulseJoint;
    rub.configureMotorModel(RAPIER.MotorModel.ForceBased);
    rub.configureMotorVelocity(0, 1e3);
    rub.setMotorMaxForce(dry);
  }
  const xs: number[] = [];
  for (let i = 0; i < 400; i++) {
    world.step();
    xs.push(bumper.translation().x * 1000);
  }
  world.free();
  const peaks: number[] = [];
  for (let i = 1; i < xs.length - 1; i++) if (xs[i] > xs[i - 1] && xs[i] >= xs[i + 1] && xs[i] > 0.01) peaks.push(i);
  return { xs, peaks };
}

describe('slide damper', () => {
  it('springs back at √(k/m) and dies away at the damping we set', async () => {
    const rows: string[] = [];
    const k = 200;
    for (const zeta of [0, 0.1, 0.3]) {
      const c = 2 * zeta * Math.sqrt(k * M);
      const { xs, peaks } = await knock(k, c);
      const period = peaks.length > 1 ? (peaks[peaks.length - 1] - peaks[0]) / (peaks.length - 1) : NaN;
      const theory = 2 * Math.PI * Math.sqrt(M / k) * 1000 / Math.sqrt(1 - zeta * zeta);
      // Damping ratio from the drop between the first two peaks.
      const delta = peaks.length > 1 ? Math.log(xs[peaks[0]] / xs[peaks[1]]) : NaN;
      const zetaSeen = delta / Math.sqrt(4 * Math.PI ** 2 + delta ** 2);
      rows.push(`k=${k} N/m ζ=${zeta}: first swing ${xs[peaks[0]].toFixed(2)} mm (theory ${((0.5 / Math.sqrt(k / M)) * 1000 * Math.exp(-zeta * Math.PI / 2)).toFixed(2)}), period ${period.toFixed(1)} ms (theory ${theory.toFixed(1)}), ζ seen ${zetaSeen.toFixed(3)}`);
      if (zeta > 0) expect(Math.abs(zetaSeen - zeta)).toBeLessThan(0.05);
      if (zeta === 0) expect(Math.abs(period - theory)).toBeLessThan(2);
    }
    const dry = await knock(k, 0, 0.1);
    const amps = dry.peaks.map((i) => dry.xs[i].toFixed(2));
    rows.push(`k=${k} N/m, dry friction 0.1 N (no grease): peaks ${amps.join(', ')} mm (dry friction takes the same ${((4 * 0.1) / k * 1000).toFixed(2)} mm off each swing, then sticks)`);
    console.log(rows.join('\n'));
  }, 60000);
});
