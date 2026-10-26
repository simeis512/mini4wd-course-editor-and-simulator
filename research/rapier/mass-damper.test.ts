// 2. Mass dampers (マスダンパー): does a weight that rattles on its shaft
// take the bounce out of a landing?
// 3. Ball-link mass damper (ボールリンクマスダンパー): does a weight on ball
// links (a closed loop of joints) hold together through hard landings?
//
// A 130 g box machine, rotation locked for #2, dropped 50 mm onto a floor
// that bounces (restitution 0.6, standing in for the tyres). Against the
// same machine with the dampers' 20 g bolted on.
import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { block, lab, RAPIER } from './lab';

const MASS = 0.13;
const DAMPER = 0.01;
const HALF = 0.01;

async function drop(damper: 'none' | 'rigid' | 'sliding', play = 0.0015) {
  const world = await lab();
  block(world, [0, -0.01, 0], [1, 0.01, 1], 0.5, 0.6);
  const y0 = 0.05 + HALF;
  const chassis = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, y0, 0).lockRotations().setCcdEnabled(true));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.04, HALF, 0.075).setMass(MASS + (damper === 'rigid' ? 2 * DAMPER : 0)).setRestitution(0.6),
    chassis,
  );
  if (damper === 'sliding') {
    for (const x of [-0.045, 0.045]) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y0, -0.06));
      world.createCollider(RAPIER.ColliderDesc.cylinder(0.003, 0.006).setMass(DAMPER), body);
      const joint = world.createImpulseJoint(
        RAPIER.JointData.prismatic({ x, y: 0, z: -0.06 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
        chassis, body, true,
      ) as RAPIER.PrismaticImpulseJoint;
      joint.setLimits(-play, play);
      joint.setContactsEnabled(false);
    }
  }
  const heights: number[] = [];
  for (let i = 0; i < 1500; i++) {
    world.step();
    heights.push((chassis.translation().y - HALF) * 1000);
  }
  world.free();
  // Peaks of the bounces after the first landing, mm.
  const peaks: number[] = [];
  let landed = false;
  for (let i = 1; i < heights.length - 1; i++) {
    if (heights[i] < 0.2) landed = true;
    if (landed && heights[i] > heights[i - 1] && heights[i] >= heights[i + 1] && heights[i] > 0.05) peaks.push(heights[i]);
  }
  const settled = heights.findIndex((h, i) => i > 50 && heights.slice(i).every((x) => x < 0.3));
  return { peaks, settled };
}

describe('mass dampers', () => {
  it('a weight with play on its shaft cuts the bounce after a landing', async () => {
    const rows: string[] = [];
    const out: Record<string, Awaited<ReturnType<typeof drop>>> = {};
    for (const d of ['none', 'rigid', 'sliding'] as const) {
      out[d] = await drop(d);
      rows.push(`${d.padEnd(8)} bounce peaks ${out[d].peaks.slice(0, 5).map((p) => p.toFixed(1)).join(', ')} mm  settled after ${out[d].settled} ms`);
    }
    for (const play of [0.0005, 0.003]) {
      const r = await drop('sliding', play);
      rows.push(`play ±${play * 1000}mm bounce peaks ${r.peaks.slice(0, 5).map((p) => p.toFixed(1)).join(', ')} mm  settled after ${r.settled} ms`);
    }
    console.log(rows.join('\n'));
    expect(out.sliding.peaks[0]).toBeLessThan(0.8 * out.rigid.peaks[0]);
  }, 60000);
});

/** Where a point fixed in a body is now, world. */
function at(body: RAPIER.RigidBody, local: [number, number, number]): Vector3 {
  const r = body.rotation();
  const t = body.translation();
  return new Vector3(...local).applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w)).add(new Vector3(t.x, t.y, t.z));
}

describe('ball-link mass damper', () => {
  it('a plate on two ball links and a rope stop holds together through tumbling drops', async () => {
    const rows: string[] = [];
    for (const kind of ['impulse', 'multibody'] as const) {
      const world = await lab();
      block(world, [0, -0.01, 0], [2, 0.01, 2], 0.5, 0.3);
      // Thrown up and spinning, as off a jump that goes wrong.
      const chassis = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.2, 0).setLinvel(0.5, 1, 3).setAngvel({ x: 20, y: 5, z: 15 }).setCcdEnabled(true),
      );
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.04, HALF, 0.075).setMass(MASS).setRestitution(0.3), chassis);
      // The plate behind the chassis, hung from two ball joints at its front corners, its back resting on a stop.
      const plate = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.2, -0.1).setCcdEnabled(true));
      world.createCollider(RAPIER.ColliderDesc.cuboid(0.035, 0.002, 0.02).setMass(0.02).setRestitution(0.1), plate);
      const links: { a: [number, number, number]; b: [number, number, number] }[] = [
        { a: [0.03, 0, -0.075], b: [0.03, 0, 0.025] },
        { a: [-0.03, 0, -0.075], b: [-0.03, 0, 0.025] },
      ];
      const v = (p: [number, number, number]) => ({ x: p[0], y: p[1], z: p[2] });
      for (const [i, l] of links.entries()) {
        const data = RAPIER.JointData.spherical(v(l.a), v(l.b));
        // A multibody is a tree: its second link closes a loop, so it stays an impulse joint.
        const j = kind === 'multibody' && i === 0 ? world.createMultibodyJoint(data, chassis, plate, true) : world.createImpulseJoint(data, chassis, plate, true);
        j.setContactsEnabled(false);
      }
      // How far the plate may swing down: a rope from above the hinge line to the plate's back (≈ 10° of swing).
      world.createImpulseJoint(RAPIER.JointData.rope(0.05, v([0, 0.01, -0.075]), v([0, 0, -0.02])), chassis, plate, true).setContactsEnabled(false);
      let worst = 0;
      let bad = false;
      let landings = 0;
      let windowWorst = 0;
      const trace: string[] = [];
      for (let i = 0; i < 5000; i++) {
        // Thrown again every second.
        if (i % 1000 === 999) {
          chassis.setLinvel({ x: 0.3, y: 2, z: 2 }, true);
          chassis.setAngvel({ x: -25, y: 10, z: 30 }, true);
          landings++;
        }
        world.step();
        let gap = 0;
        for (const l of links) gap = Math.max(gap, at(chassis, l.a).distanceTo(at(plate, l.b)));
        worst = Math.max(worst, gap);
        windowWorst = Math.max(windowWorst, gap);
        if (i % 100 === 99) { trace.push((windowWorst * 1000).toFixed(2)); windowWorst = 0; }
        const t = plate.translation();
        if (!Number.isFinite(t.x + t.y + t.z)) bad = true;
      }
      world.free();
      rows.push(`${kind.padEnd(9)} ${landings + 1} throws, 5 s: worst ball-joint gap ${(worst * 1000).toFixed(3)} mm, ${bad ? 'blew up' : 'stayed finite'}\n  worst gap per 0.1 s, mm: ${trace.join(' ')}`);
      expect(bad).toBe(false);
      expect(worst).toBeLessThan(0.002);
    }
    console.log(rows.join('\n'));
  }, 60000);
});
