// E. Tyres as rays: what a single ray per tyre misses. The standard
// machine rolled slowly off a 20 mm step: a real tyre rolls round the edge
// (its axle drops along a circle as it passes), a ray holds the axle up
// until the tyre's middle is past the edge, then lets go.
import { Quaternion, Vector3 } from 'three';
import { describe, it } from 'vitest';
import { createMachine, driveMachine } from '../../src/physics/machine';
import { STANDARD_MACHINE } from '../../src/physics/machine-spec';
import { block, lab } from './lab';

describe('ray tyres', () => {
  it('a tyre over an edge: held up fully, then dropped', async () => {
    const world = await lab();
    // Upper road ends at z = 0; the lower one is 20 mm down.
    block(world, [0, -0.01, -0.5], [0.2, 0.01, 0.5]);
    block(world, [0, -0.03, 0.5], [0.2, 0.01, 0.5]);
    const spec = { ...STANDARD_MACHINE, motor: { ...STANDARD_MACHINE.motor, freeRpm: 400 } };
    const m = createMachine(world, spec, new Vector3(0, 0, -0.1), new Vector3(0, 0, 1));
    const r = spec.tyreRadius;
    const rows: string[] = [];
    let next = -0.004;
    for (let i = 0; i < 20000 && next <= r + 0.004; i++) {
      driveMachine(m, world.timestep);
      world.step();
      const q = m.body.rotation();
      const t = m.body.translation();
      const axle = new Vector3(0, spec.tyreRadius - (spec.clearance + spec.size[1] / 2), spec.wheelbase / 2)
        .applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w))
        .add(new Vector3(t.x, t.y, t.z));
      if (axle.z >= next) {
        const d = axle.z;
        const ideal = d <= 0 ? (r * 1000).toFixed(1) : d < r ? (Math.sqrt(r * r - d * d) * 1000).toFixed(1) : 'off the edge';
        rows.push(`front axle ${(d * 1000).toFixed(1).padStart(5)} mm past the edge: ${(axle.y * 1000).toFixed(1).padStart(5)} mm up (a round tyre on the edge: ${ideal})`);
        next += 0.002;
      }
    }
    world.free();
    console.log(rows.join('\n'));
  }, 60000);
});
