import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { GLOBAL_SPEC, getPart } from './catalog';
import { partGeometry, partStands, pointOnFrame, STAND_BEAM, STAND_DEPTH, STAND_LEG } from './geometry';
import { emptyCourse, layoutCourse, type Course } from './course';
import { addPiece, setPose } from './edit';
import { BRIDGE_HEIGHT } from './profile';
import { atLevel, pieceHeights, SUPPORT_MIN_GAP, SUPPORT_OVERHANG, SUPPORT_REACH, supports } from './height';
import { basicOval, chain } from './presets';

/** A lone straight with its start port `y` mm off the floor. */
const raised = (y: number, course: Course = emptyCourse()): Course => {
  const c = addPiece(course, 'straight', null);
  return setPose(c, c.pieces.length - 1, { pos: [0, y, 0], rot: [0, 0, 0] });
};

describe('piece heights', () => {
  it('reads the lowest and highest road of each piece', () => {
    const layout = layoutCourse(chain(['straight', 'slope', 'straight']));
    const [flat, slope, top] = pieceHeights(layout);
    expect(flat).toEqual([0, 0]);
    expect(slope[0]).toBeCloseTo(0);
    expect(slope[1]).toBeCloseTo(110);
    expect(top[0]).toBeCloseTo(110);
  });

  it('keeps pieces that reach the filter height', () => {
    expect(atLevel([0, 110], 100)).toBe(true);
    expect(atLevel([0, 0], 100)).toBe(false);
    expect(atLevel([100, 100], 100)).toBe(true);
    expect(atLevel([0, 0], 0)).toBe(true);
  });
});

describe('supports', () => {
  it('puts none under road on the floor', () => {
    expect(supports(layoutCourse(chain(['straight', 'wave', 'curve45'])))).toEqual([]);
  });

  it('spaces stands evenly under raised road, away from the joints', () => {
    const s = supports(layoutCourse(raised(100)));
    expect(s).toHaveLength(2);
    for (const st of s) {
      expect(st.left.y).toBeCloseTo(100 - GLOBAL_SPEC.roadThickness);
      expect(st.right.y).toBeCloseTo(100 - GLOBAL_SPEC.roadThickness);
      expect(Math.abs(st.along.z)).toBeCloseTo(1);
      // A little wider than the road.
      expect(st.left.distanceTo(st.right)).toBeCloseTo(3 * GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness + 2 * SUPPORT_OVERHANG);
    }
    const zs = s.map((st) => st.left.z).sort((a, b) => a - b);
    expect(zs[0]).toBeGreaterThan(50);
    expect(zs[1]).toBeLessThan(490);
  });

  it('leaves out stands that would barely clear the floor', () => {
    expect(supports(layoutCourse(raised(SUPPORT_MIN_GAP)))).toEqual([]);
  });

  it('only stands under the raised part of a slope', () => {
    const layout = layoutCourse(chain(['slope']));
    const s = supports(layout);
    expect(s.length).toBeGreaterThan(0);
    for (const st of s) expect(Math.max(st.left.y, st.right.y)).toBeGreaterThan(SUPPORT_MIN_GAP);
  });

  it('straddles road running underneath, its crossbar over the fences', () => {
    const below = addPiece(emptyCourse(), 'straight', null);
    const s = supports(layoutCourse(raised(150, below)));
    expect(s).toHaveLength(2);
    const roadHalf = (3 * GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness) / 2;
    for (const st of s) {
      // The legs stand outside the lower road.
      expect(Math.min(Math.abs(st.left.x), Math.abs(st.right.x)) - STAND_LEG).toBeGreaterThan(roadHalf);
      expect(st.left.distanceTo(st.right)).toBeLessThan(2 * (roadHalf + SUPPORT_REACH));
      expect(st.left.y - STAND_BEAM).toBeGreaterThan(GLOBAL_SPEC.fenceHeight);
    }
  });

  it('keeps the top of a stand under a sloping road across its whole depth', () => {
    const pitch = 10;
    const c = addPiece(emptyCourse(), 'straight', null);
    const layout = layoutCourse(setPose(c, 0, { pos: [0, 150, 0], rot: [0, pitch, 0] }));
    const s = supports(layout);
    expect(s.length).toBeGreaterThan(0);
    const t = Math.tan((pitch * Math.PI) / 180);
    for (const st of s) {
      // Road underside over the downhill edge of the stand.
      const h = st.left.z - STAND_DEPTH / 2;
      const underside = 150 + h * t - GLOBAL_SPEC.roadThickness / Math.cos((pitch * Math.PI) / 180);
      expect(st.left.y).toBeLessThanOrEqual(underside + 1e-6);
      expect(st.left.y).toBeGreaterThan(underside - 1);
    }
  });

  it('keeps the corners of a stand clear of road it crosses at an angle', () => {
    const below = addPiece(emptyCourse(), 'straight', null);
    const c = addPiece(below, 'straight', null);
    const layout = layoutCourse(setPose(c, 1, { pos: [0, 150, 0], rot: [20, 0, 0] }));
    const lower = layout.pieces[0];
    const s = supports(layout).filter((st) => st.piece === 1);
    expect(s.length).toBeGreaterThan(0);
    const roadHalf = (3 * GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness) / 2;
    for (const st of s) {
      // Every corner of both legs stands outside the lower road (x in its own frame).
      const across = st.right.clone().sub(st.left).setY(0).normalize();
      for (const [top, inward] of [[st.left, 1], [st.right, -1]] as const) {
        for (const w of [0, STAND_LEG]) {
          for (const d of [-STAND_DEPTH / 2, STAND_DEPTH / 2]) {
            const p = top.clone().add(across.clone().multiplyScalar(inward * w)).add(st.along.clone().multiplyScalar(d)).setY(0);
            const local = p.applyMatrix4(lower.matrix.clone().invert());
            const inside = Math.abs(local.x) < roadHalf && local.z > 0 && local.z < 540;
            expect(inside).toBe(false);
          }
        }
      }
    }
  });

  it('tucks a leg in under the road when there is no room outside', () => {
    // Two straights raised 110 crossing two on the floor at 45° (user's course, 2026-10-20).
    const course: Course = {
      v: 1,
      catalog: 1,
      pieces: [
        { part: 'straight', at: 'origin' },
        { part: 'straight', port: 0, to: [0, 1] },
        { part: 'straight', port: 0, free: null, pose: { pos: [158.2, 110, 158.2], rot: [-45, 0, 0] } },
        { part: 'straight', port: 0, to: [2, 1] },
      ],
    };
    const layout = layoutCourse(course);
    const s = supports(layout);
    for (const piece of [2, 3]) expect(s.filter((st) => st.piece === piece)).toHaveLength(2);
    // Some leg stands in under the raised road, so that stand is narrower than usual.
    const usual = 3 * GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness + 2 * SUPPORT_OVERHANG;
    expect(s.some((st) => st.left.distanceTo(st.right) < usual - 1)).toBe(true);
  });

  it('holds up a raised lane change without doubling stands, its own support riding on top', () => {
    // A lane change raised 110 over straights on the floor (user's course, 2026-10-20).
    const course: Course = {
      v: 1,
      catalog: 1,
      pieces: [
        { part: 'straight', at: 'origin' },
        { part: 'straight', port: 0, to: [0, 1] },
        { part: 'bridge-approach', port: 0, free: null, pose: { pos: [0, 110, -540], rot: [0, 0, 0] } },
        { part: 'lane-change-center', port: 0, to: [2, 1] },
        { part: 'bridge-approach', port: 1, to: [3, 1] },
        { part: 'straight', port: 0, to: [0, 0] },
      ],
    };
    const s = supports(layoutCourse(course));
    // The centre is held up under its lower lanes.
    expect(s.some((st) => st.piece === 3)).toBe(true);
    // No two stands overlap: a ramp and the lanes beside it share theirs.
    for (const [i, a] of s.entries()) {
      for (const b of s.slice(i + 1)) {
        const mid = (st: typeof a) => st.left.clone().add(st.right).multiplyScalar(0.5);
        const apart = Math.abs(mid(a).sub(mid(b)).dot(b.along));
        expect(apart >= STAND_DEPTH || mid(a).distanceTo(mid(b)) > a.left.distanceTo(a.right)).toBe(true);
      }
    }
  });

  it('leaves the road to span road below when the crossbar would not clear it', () => {
    const below = addPiece(emptyCourse(), 'straight', null);
    expect(supports(layoutCourse(raised(60, below)))).toEqual([]);
  });

  it('stands the ramps on the floor beside their lower lanes', () => {
    const layout = layoutCourse(basicOval());
    const s = supports(layout);
    const ramps = layout.pieces.flatMap((pc, i) => (pc.part.id === 'bridge-approach' ? [i] : []));
    for (const i of ramps) expect(s.some((st) => st.piece === i)).toBe(true);
    // No stand under the high middle of the bridge, where the lower lanes run.
    // The bridge gets no automatic stands: the set comes with its own (below).
    const centre = layout.pieces.findIndex((pc) => pc.part.id === 'lane-change-center');
    expect(s.filter((st) => st.piece === centre)).toEqual([]);
  });

  it('stands the lane change support square to the lower lanes, across their middle', () => {
    const part = getPart('lane-change-center');
    const [st] = partStands(part);
    // Under the bridge, clear of the lower lanes' fences.
    for (const y of [st.left.y, st.right.y]) {
      expect(y).toBeLessThan(BRIDGE_HEIGHT - GLOBAL_SPEC.roadThickness);
      expect(y).toBeGreaterThan(GLOBAL_SPEC.fenceHeight + 20);
    }
    // Square to the lower lanes, which swing sideways in the middle.
    const mid = partGeometry(part).samples;
    const f = mid[Math.round((mid.length - 1) / 2)];
    const forward = new Vector3(0, 0, 1).transformDirection(f);
    expect(Math.abs(st.right.clone().sub(st.left).normalize().dot(forward))).toBeLessThan(1e-6);
    expect(Math.abs(forward.x)).toBeGreaterThan(0.05);
    // Centred on the two lower lanes, a little wider than them and about a lane deep.
    const width = st.left.distanceTo(st.right);
    expect(width).toBeGreaterThan(2 * GLOBAL_SPEC.lanePitch + GLOBAL_SPEC.fenceThickness);
    expect(width).toBeLessThan(3 * GLOBAL_SPEC.lanePitch);
    expect(st.depth).toBe(GLOBAL_SPEC.lanePitch);
    const centre = st.left.clone().add(st.right).multiplyScalar(0.5);
    expect(centre.distanceTo(pointOnFrame(f, -GLOBAL_SPEC.lanePitch / 2, centre.y - f.elements[13]))).toBeLessThan(1e-6);
  });
});
