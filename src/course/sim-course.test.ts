import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { addAttachment } from './attachments';
import { layoutCourse } from './course';
import { markIntended, setShift } from './edit';
import { checkLaps } from './laps';
import { basicOval, chain } from './presets';
import { FALL_ZONE_ABOVE, FALL_ZONE_LENGTH, insideBox, laneSpot, laneStart, pointAlong, simCourse, START_IN, toTriMesh, type TriMesh } from './sim-course';
import { addStopper, newStopper } from './stoppers';
import { placeStart } from './timing';
import { buildPropMeshes } from './props-mesh';

/** The box round a trimesh's vertices. */
function bounds(mesh: TriMesh): Box3 {
  const box = new Box3();
  for (let i = 0; i < mesh.vertices.length; i += 3) box.expandByPoint(new Vector3(...mesh.vertices.subarray(i, i + 3)));
  return box;
}

const triangles = (mesh: TriMesh) => mesh.indices.length / 3;

describe('toTriMesh', () => {
  it('moves each geometry by its matrix and offsets its indices, indexed or not', () => {
    const indexed = new BufferGeometry();
    indexed.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
    indexed.setIndex([0, 2, 1]);
    const loose = new BufferGeometry();
    loose.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
    const mesh = toTriMesh([
      { geometry: indexed, matrix: new Matrix4() },
      { geometry: loose, matrix: new Matrix4().makeTranslation(0, 10, 0) },
    ]);
    expect([...mesh.indices]).toEqual([0, 2, 1, 3, 4, 5]);
    expect([...mesh.vertices.subarray(9, 12)]).toEqual([0, 10, 0]);
  });
});

describe('simCourse (spec 9, #26)', () => {
  it('gives a straight a road on top of y = 0 as wide as three lanes, four fences and a fall zone past each end', () => {
    const sim = simCourse(layoutCourse(chain(['straight'])));
    const road = bounds(sim.road);
    expect(road.max.y).toBeCloseTo(0, 6);
    expect(road.max.x - road.min.x).toBeCloseTo(365, 3);
    expect(road.max.z - road.min.z).toBeCloseTo(540, 3);
    const fences = bounds(sim.fences);
    expect(fences.max.y).toBeCloseTo(50, 3);
    expect(fences.max.x - fences.min.x).toBeCloseTo(365, 3);
    expect(sim.props.indices).toHaveLength(0);

    expect(sim.fallZones.map((z) => z.at)).toEqual([
      { piece: 0, port: 0 },
      { piece: 0, port: 1 },
    ]);
    const [, end] = sim.fallZones;
    expect(end.size).toEqual([365, FALL_ZONE_ABOVE, FALL_ZONE_LENGTH]);
    expect(end.intended).toBe(false);
    // Just past the end, not on the road.
    expect(insideBox(end, new Vector3(0, 20, 540 + 10))).toBe(true);
    expect(insideBox(end, new Vector3(0, 20, 540 - 10))).toBe(false);
    expect(insideBox(end, new Vector3(0, 20, 540 + FALL_ZONE_LENGTH + 10))).toBe(false);
    expect(insideBox(end, new Vector3(170, 20, 600))).toBe(true);
    expect(insideBox(end, new Vector3(190, 20, 600))).toBe(false);
  });

  it('marks a fall zone left open on purpose', () => {
    const c = markIntended(chain(['straight']), { piece: 0, port: 1 }, true);
    expect(simCourse(layoutCourse(c)).fallZones.map((z) => z.intended)).toEqual([false, true]);
  });

  it('reaches down to the floor past a raised end', () => {
    const layout = layoutCourse(chain(['slope']));
    const top = simCourse(layout).fallZones.find((z) => z.at.port === 1)!;
    const y = new Vector3().setFromMatrixPosition(layout.pieces[0].ports[1]).y;
    expect(y).toBeCloseTo(110, 3);
    const out = new Vector3(0, 0, 1).transformDirection(layout.pieces[0].ports[1]).multiplyScalar(50);
    const past = new Vector3().setFromMatrixPosition(layout.pieces[0].ports[1]).add(out);
    expect(insideBox(top, past.clone().setY(1))).toBe(true);
    expect(insideBox(top, past.clone().setY(y + FALL_ZONE_ABOVE - 1))).toBe(true);
    expect(insideBox(top, past.clone().setY(y + FALL_ZONE_ABOVE + 1))).toBe(false);
  });

  it('closes off the lanes that end at a shifted joint', () => {
    const c = setShift(chain(['straight', 'straight']), { piece: 0, port: 1 }, { piece: 1, port: 0 }, 1);
    const ends = simCourse(layoutCourse(c)).fallZones.filter((z) => z.lanes.length === 1);
    expect(ends.map((z) => [z.at, z.lanes])).toEqual([
      [{ piece: 0, port: 1 }, [0]],
      [{ piece: 1, port: 0 }, [2]],
    ]);
    // One lane and its fences wide, over the part's lane 0 (+ X, its left) past the first straight's end.
    expect(ends[0].size[0]).toBeCloseTo(125, 6);
    expect(insideBox(ends[0], new Vector3(120, 20, 560))).toBe(true);
    expect(insideBox(ends[0], new Vector3(0, 20, 560))).toBe(false);
  });

  it('leaves the basic oval with no fall zones and three lanes as long as the laps', () => {
    const layout = layoutCourse(basicOval());
    const sim = simCourse(layout);
    expect(sim.fallZones).toEqual([]);
    const laps = checkLaps(layout)!.laps;
    expect(sim.lanes.map((l) => [l.lane, l.next])).toEqual(laps.map((l) => [l.lane, l.next]));
    sim.lanes.forEach((l, i) => {
      expect(l.length).toBeCloseTo(laps[i].length, 3);
      expect(l.distances).toHaveLength(l.points.length);
    });
    // The road reaches up to the lane change's bridge.
    expect(bounds(sim.road).max.y).toBeGreaterThan(90);
  });

  it('puts washboards on the road and the timer and stoppers in the props, but not the start stickers', () => {
    let c = chain(['straight']);
    const plain = simCourse(layoutCourse(c));
    c = addAttachment(c, 'washboard-5', 0, 1);
    expect(triangles(simCourse(layoutCourse(c)).road)).toBeGreaterThan(triangles(plain.road));
    c = placeStart(c, 0, 100);
    const timed = layoutCourse(c);
    const props = triangles(simCourse(timed).props);
    // The timer's blocks, 12 triangles each, and nothing for the stickers.
    expect(props).toBe(12 * buildPropMeshes(timed).find((g) => g.name === 'timer')!.children.length);
    c = addStopper(c, newStopper('hose', -600, 270));
    const hosed = simCourse(layoutCourse(c));
    expect(triangles(hosed.props)).toBeGreaterThan(props);
    // The hose lies on the floor.
    expect(bounds(hosed.props).min.y).toBeCloseTo(0, 1);
  });
});

describe('laneSpot', () => {
  const lane = { points: [new Vector3(0, 0, 0), new Vector3(0, 0, 100), new Vector3(100, 0, 100)], distances: [0, 100, 200] };

  it('measures along the lane to the nearest spot, and how far off it a point is', () => {
    expect(laneSpot(lane, new Vector3(5, 0, 40))).toEqual({ along: 40, off: 5, segment: 0 });
    const spot = laneSpot(lane, new Vector3(60, 0, 90));
    expect(spot.along).toBeCloseTo(160, 9);
    expect(spot.off).toBeCloseTo(10, 9);
    expect(spot.segment).toBe(1);
  });

  it('follows the basic oval lap after lap', () => {
    const sim = simCourse(layoutCourse(basicOval()));
    const l = sim.lanes[0];
    const mid = l.points[Math.floor(l.points.length / 2)];
    expect(laneSpot(l, mid.clone().add(new Vector3(0, 30, 0))).off).toBeCloseTo(30, 3);
  });
});

describe('laneStart (#27)', () => {
  it('sets off a little way into the lane, facing along it', () => {
    const layout = layoutCourse(chain(['straight', 'straight']));
    const lane = simCourse(layout).lanes[1];
    const s = laneStart(layout, lane);
    expect(s.along).toBe(START_IN);
    expect(s.position.distanceTo(new Vector3(0, 0, START_IN))).toBeLessThan(1e-6);
    expect(s.forward.z).toBeCloseTo(1, 6);
  });

  it('sets off across from the start line', () => {
    const layout = layoutCourse(placeStart(chain(['straight', 'straight']), 1, 100));
    const lane = simCourse(layout).lanes[0];
    const s = laneStart(layout, lane);
    expect(s.along).toBeCloseTo(640, 3);
    expect(s.position.z).toBeCloseTo(640, 3);
    // The left lane is + X.
    expect(s.position.x).toBeCloseTo(120, 3);
  });

  it('finds points along a lane', () => {
    const lane = { points: [new Vector3(0, 0, 0), new Vector3(0, 0, 100), new Vector3(100, 0, 100)], distances: [0, 100, 200] };
    expect(pointAlong(lane, 150).toArray()).toEqual([50, 0, 100]);
    expect(pointAlong(lane, 999).toArray()).toEqual([100, 0, 100]);
  });
});
