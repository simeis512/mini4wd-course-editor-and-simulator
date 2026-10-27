// F. Provisional values: how much does each one move the lap time? The
// standard machine round the basic oval for 3 laps with one value halved
// or doubled at a time.
import { describe, it } from 'vitest';
import { layoutCourse } from '../../src/course/course';
import { basicOval } from '../../src/course/presets';
import { STANDARD_MACHINE, type MachineSpec } from '../../src/physics/machine-spec';
import { Run } from '../../src/physics/run';

async function laps(spec: MachineSpec): Promise<string> {
  const run = (await Run.create(layoutCourse(basicOval()), 1, 0, spec))!;
  let s = run.advance(0);
  while (s.time < 15 && !s.out && s.laps < 3) s = run.advance(0.01);
  run.free();
  if (s.out) return `out (${s.out}) at ${s.time.toFixed(1)} s`;
  const t = s.lapTimes.slice(1);
  return `lap ${t.length ? (t.reduce((a, b) => a + b, 0) / t.length).toFixed(3) : '?'} s`;
}

describe('sensitivity', () => {
  it('lap time with each provisional value halved and doubled', async () => {
    const base = await laps(STANDARD_MACHINE);
    const rows = [`standard: ${base}`];
    const tweaks: [string, (k: number) => Partial<MachineSpec>][] = [
      ['grip', (k) => ({ grip: STANDARD_MACHINE.grip * k })],
      ['rollerFriction', (k) => ({ rollerFriction: STANDARD_MACHINE.rollerFriction * k })],
      ['rollerRestitution', (k) => ({ rollerRestitution: Math.min(1, STANDARD_MACHINE.rollerRestitution * k) })],
      ['efficiency', (k) => ({ efficiency: Math.min(1, STANDARD_MACHINE.efficiency * k) })],
      ['mass', (k) => ({ mass: STANDARD_MACHINE.mass * k })],
      ['stallTorque', (k) => ({ motor: { ...STANDARD_MACHINE.motor, stallTorque: STANDARD_MACHINE.motor.stallTorque * k } })],
    ];
    for (const [name, f] of tweaks) {
      const half = await laps({ ...STANDARD_MACHINE, ...f(0.5) });
      const twice = await laps({ ...STANDARD_MACHINE, ...f(2) });
      rows.push(`${name.padEnd(17)} ×0.5: ${half.padEnd(22)} ×2: ${twice}`);
    }
    console.log(rows.join('\n'));
  }, 300000);
});
