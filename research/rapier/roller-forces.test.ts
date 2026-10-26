// 7. Forces on the rollers in the curves: can the simulator read how hard
// the fences push each roller (and the road each tyre)?
//
// The real Run (src/physics/run.ts) on the basic oval. Each roller collider
// asks for Rapier's contact force events; Run's world.step() is wrapped to
// pass an event queue, and the events are read after every 1 ms step.
// (Reading the impulses straight off world.contactPair() gives 0 against the
// fence trimesh, so the events are the way in.) The ray-cast tyres report
// their loads themselves.
import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../../src/course/course';
import { basicOval } from '../../src/course/presets';
import { Run } from '../../src/physics/run';
import { mean, RAPIER } from './lab';

const NAMES = ['front left', 'front right', 'rear left', 'rear right'];

describe('roller forces', () => {
  it('reads each roller’s push from the fences and each tyre’s load, every step', async () => {
    const run = (await Run.create(layoutCourse(basicOval()), 1, 0))!;
    const { world, machine } = run;
    const queue = new RAPIER.EventQueue(true);
    const step = world.step.bind(world);
    (world as { step: () => void }).step = () => step(queue);
    const rollers = machine.colliders.slice(1);
    for (const c of rollers) {
      c.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      c.setContactForceEventThreshold(0);
    }
    const index = new Map(rollers.map((c, i) => [c.handle, i]));
    const samples: { speed: number; roller: number[]; tyre: number[] }[] = [];
    let s = run.advance(0);
    while (s.time < 6 && !s.out) {
      s = run.advance(0.001);
      const roller = [0, 0, 0, 0];
      queue.drainContactForceEvents((e) => {
        const i = index.get(e.collider1()) ?? index.get(e.collider2());
        if (i !== undefined) roller[i] += e.totalForceMagnitude();
      });
      const tyre = [0, 1, 2, 3].map((i) => machine.vehicle.wheelSuspensionForce(i) ?? 0);
      samples.push({ speed: s.speed, roller, tyre });
    }
    expect(s.out).toBeNull();
    const rows = NAMES.map((name, i) => {
      const fs = samples.map((x) => x.roller[i]);
      const on = fs.filter((f) => f > 0);
      return `${name.padEnd(11)} touching ${((100 * on.length) / fs.length).toFixed(0).padStart(3)}% of steps  mean while touching ${on.length ? mean(on).toFixed(2) : '-'} N  peak ${Math.max(...fs).toFixed(1)} N`;
    });
    // Smoothed over 50 ms, as a load cell would read it: the steady push through a curve vs the knocks of single steps.
    const sum = samples.map((x) => x.roller.reduce((a, b) => a + b, 0));
    const smooth: number[] = [];
    for (let i = 50; i < sum.length; i++) smooth.push(mean(sum.slice(i - 50, i)));
    const v = mean(samples.map((x) => x.speed));
    console.log(
      [
        ...rows,
        `all rollers, 50 ms average: highest ${Math.max(...smooth).toFixed(2)} N`,
        `mean speed ${v.toFixed(2)} m/s; m v²/R: R=0.3 m → ${((machine.spec.mass * v * v) / 0.3).toFixed(2)} N, R=0.5 m → ${((machine.spec.mass * v * v) / 0.5).toFixed(2)} N`,
        `tyre loads, first 0.2 s: ${[0, 1, 2, 3].map((i) => mean(samples.slice(0, 200).map((x) => x.tyre[i])).toFixed(3)).join(', ')} N (weight ${(machine.spec.mass * 9.81).toFixed(3)} N)`,
      ].join('\n'),
    );
    expect(Math.max(...smooth)).toBeGreaterThan(0.1);
    run.free();
  }, 60000);
});
