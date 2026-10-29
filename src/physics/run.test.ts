import { describe, expect, it } from 'vitest';
import { layoutCourse } from '../course/course';
import { basicOval, chain, rampJumpOval } from '../course/presets';
import { addStopper } from '../course/stoppers';
import { rideHeight } from './machine';
import { freeSpeed, STANDARD_MACHINE } from './machine-spec';
import { placeStart, placeTimer, removeTimer } from '../course/timing';
import { REVERSE_DISTANCE, Run, STALL_TIME } from './run';

const straights = (n: number) => layoutCourse(chain(Array(n).fill('straight')));

describe('Run (#27, spec simulator.md)', () => {
  it('sets the machine on the road in the left lane and speeds it up towards its top speed', async () => {
    const run = (await Run.create(straights(12)))!;
    const still = run.advance(0.2);
    expect(still.position.x).toBeCloseTo(120, 0);
    // The tyres give by under a millimetre.
    expect(Math.abs(still.position.y - rideHeight(STANDARD_MACHINE) * 1000)).toBeLessThan(1);
    const s = run.advance(1.2);
    expect(s.out).toBeNull();
    expect(s.speed).toBeGreaterThan(0.6 * freeSpeed(STANDARD_MACHINE));
    expect(s.speed).toBeLessThan(freeSpeed(STANDARD_MACHINE));
    // Straight along the lane, between its fences.
    expect(Math.abs(s.position.x - 120)).toBeLessThan(5);
    run.free();
  });

  it('runs off the open end and is out once it touches the floor (owner, 2026-10-24)', async () => {
    const run = (await Run.create(straights(2)))!;
    const s = run.advance(5);
    expect(s.out).toBe('floor');
    expect(s.distance).toBeGreaterThan(900);
    run.free();
  });

  it('laps the basic oval through every lane, over the lane change', async () => {
    const run = (await Run.create(layoutCourse(basicOval())))!;
    let s = run.advance(0);
    let high = 0;
    // Looked at often enough not to miss the short run over the bridge.
    while (s.time < 30 && s.laps < 3 && !s.out) {
      s = run.advance(0.01);
      high = Math.max(high, s.position.y);
    }
    expect(s.out).toBeNull();
    expect(s.laps).toBe(3);
    // Over the bridge once in three laps.
    expect(high).toBeGreaterThan(80);
    run.free();
  }, 30000);

  it('keeps its speed along the fences in every lane: the rollers do not catch', async () => {
    for (const lane of [0, 1, 2]) {
      const run = (await Run.create(layoutCourse(basicOval()), 1, lane))!;
      let s = run.advance(1);
      let slowest = Infinity;
      while (s.laps < 1 && !s.out && s.time < 10) {
        s = run.advance(0.01);
        slowest = Math.min(slowest, s.speed);
      }
      expect(s.laps).toBe(1);
      expect(slowest).toBeGreaterThan(0.6 * freeSpeed(STANDARD_MACHINE));
      run.free();
    }
  }, 30000);

  it('lands from a drop onto the road without falling through it (spec simulator.md 4)', async () => {
    const run = (await Run.create(straights(6)))!;
    const { body } = run.machine;
    const t = body.translation();
    // Half a metre up, already falling at 3 m/s.
    body.setTranslation({ x: t.x, y: 0.5, z: t.z + 0.2 }, true);
    body.setLinvel({ x: 0, y: -3, z: 1 }, true);
    const s = run.advance(1);
    expect(s.out).toBeNull();
    expect(s.position.y).toBeGreaterThan(5);
    expect(s.position.y).toBeLessThan(30);
    run.free();
  });

  it('calls a machine that cannot move out once it has stood still for a while', async () => {
    const weak = { ...STANDARD_MACHINE, motor: { ...STANDARD_MACHINE.motor, stallTorque: 0 } };
    const run = (await Run.create(straights(2), 1, 0, weak))!;
    expect(run.advance(STALL_TIME - 0.5).out).toBeNull();
    expect(run.advance(1).out).toBe('stopped');
    run.free();
  });

  it('counts laps at the start line and, with no timer, times each from the start (#28)', async () => {
    const run = (await Run.create(layoutCourse(removeTimer(placeStart(basicOval(), 0, 270)))))!;
    let s = run.advance(0);
    const passed: number[] = [];
    while (s.laps < 3 && !s.out && s.time < 20) {
      s = run.advance(0.01);
      if (s.laps > passed.length) passed.push(s.time);
    }
    expect(s.out).toBeNull();
    expect(s.lapTimes).toHaveLength(3);
    s.lapTimes.forEach((t, i) => expect(t).toBeCloseTo(passed[i] - (passed[i - 1] ?? 0), 1));
    run.free();
  }, 30000);

  it('times with the lap timer once round all three lanes, from the first pass under it (#28, #56)', async () => {
    const run = (await Run.create(layoutCourse(placeStart(basicOval(), 0, 270))))!;
    let s = run.advance(0);
    while (s.laps < 7 && !s.out && s.time < 30) s = run.advance(0.05);
    expect(s.out).toBeNull();
    // Under the timer every third lap: two passes in the first six laps give one time.
    expect(s.lapTimes.length).toBeGreaterThanOrEqual(1);
    expect(s.lapTimes.length).toBeLessThanOrEqual(2);
    expect(s.lapTimes[0]).toBeGreaterThan(2.5 * (s.time / s.laps));
    run.free();
  }, 30000);

  it('times every lane when the timer is set to', async () => {
    const course = placeTimer(placeStart(basicOval(), 0, 270), { everyLane: true });
    const run = (await Run.create(layoutCourse(course)))!;
    let s = run.advance(0);
    // In short steps: the timer is only a few hundredths of a second past the start line.
    while (s.laps < 3 && !s.out && s.time < 20) s = run.advance(0.005);
    // Timed from the first pass, just past the start: one fewer than the laps.
    expect(s.lapTimes).toHaveLength(2);
    run.free();
  }, 30000);

  it('calls a machine that runs the wrong way out', async () => {
    // Back over the start of the lanes, onto the end of the lap before.
    const run = (await Run.create(layoutCourse(placeStart(basicOval(), 0, 270))))!;
    run.machine.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
    let s = run.advance(0);
    while (!s.out && s.time < 3) s = run.advance(0.01);
    expect(s.out).toBe('reverse');
    expect(s.distance).toBeLessThan(-REVERSE_DISTANCE + 20);
    run.free();
  });

  it('tells a machine stopped upside down from one stopped any other way', async () => {
    const run = (await Run.create(straights(6)))!;
    const t = run.machine.body.translation();
    run.machine.body.setTranslation({ x: t.x, y: 0.03, z: t.z }, true);
    run.machine.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    expect(run.advance(STALL_TIME + 0.5).out).toBe('flipped');
    run.free();
  });

  it('flies off a jump ramp and lands on the road ahead without being called out (#28)', async () => {
    // The right lane runs up the ramp: in every lane in turn, so each takes the jump.
    const run = (await Run.create(layoutCourse(rampJumpOval()), 1, 2))!;
    let s = run.advance(0);
    while (s.laps < 3 && !s.out && s.time < 20) s = run.advance(0.05);
    expect(s.out).toBeNull();
    expect(s.laps).toBe(3);
    run.free();
  }, 30000);

  it('calls a machine that runs into a hose out', async () => {
    const c = addStopper(chain(Array(6).fill('straight')), { kind: 'hose', points: [[60, 600], [180, 600]], color: 0 });
    const run = (await Run.create(layoutCourse(c)))!;
    expect(run.advance(3).out).toBe('stopper');
    run.free();
  });

  it('runs past a timer on the foot of a bank approach (#110)', async () => {
    // The chassis nose dips to the road where the slope starts; the timer's tape there stops nothing.
    const layout = layoutCourse(placeStart(chain(['straight', 'bank-approach-20', 'straight', 'straight']), 1, 80));
    for (const lane of [0, 1, 2]) {
      const run = (await Run.create(layout, 1, lane))!;
      expect(run.advance(0.5).out).toBeNull();
      run.free();
    }
  });
});
