// C. Same course, same machine: does Rapier give the very same numbers
// every time and everywhere? Runs the standard machine 3 s round the basic
// oval and prints its final state to the last bit. Used from Node (vitest)
// and from a browser page (determinism.html).
import { layoutCourse } from '../../src/course/course';
import { basicOval } from '../../src/course/presets';
import { Run } from '../../src/physics/run';

export async function fingerprint(seconds = 3): Promise<string> {
  const run = (await Run.create(layoutCourse(basicOval())))!;
  const s = run.advance(seconds);
  const t = run.machine.body.translation();
  const v = run.machine.body.linvel();
  const nums = [t.x, t.y, t.z, v.x, v.y, v.z, s.distance];
  run.free();
  // Float64 bits, so that the last digit counts.
  const bits = nums.map((n) => {
    const b = new DataView(new ArrayBuffer(8));
    b.setFloat64(0, n);
    return b.getBigUint64(0).toString(16);
  });
  return `${nums.map((n) => n.toFixed(9)).join(' ')} | ${bits.join(' ')}`;
}
