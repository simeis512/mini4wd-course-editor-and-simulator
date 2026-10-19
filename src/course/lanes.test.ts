import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getPart, laneLinks, laneOffset, portLaneOffsets, type PartDef } from './catalog';
import { jointLanes } from './course';
import { attach, partGeometry, pointOnFrame } from './geometry';
import { crossSection, halfWidth } from './mesh';

const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
const forward = (m: Matrix4) => new Vector3(0, 0, 1).transformDirection(m);

/** A test part; ids are unique so the geometry cache does not mix them up. */
function part(id: string, lanes: number[], ports: PartDef['ports'], extra: Partial<PartDef> = {}): PartDef {
  return {
    id,
    name: id,
    segments: [{ length: 300 }],
    ports,
    lanes,
    variants: [{ id: 'white', name: 'white', color: '#fff', material: 'current' }],
    defaultVariant: 0,
    confidence: 'inferred',
    ...extra,
  };
}

describe('crossSection', () => {
  it('spans all three lanes on a normal part', () => {
    const s = crossSection([0, 1, 2]);
    expect(s.fences).toEqual([-180, -60, 60, 180]);
    expect(s.left).toBe(-182.5);
    expect(s.right).toBe(182.5);
    expect(halfWidth(3)).toBe(182.5);
  });

  it('covers only the lanes a narrow part has', () => {
    expect(crossSection([2])).toEqual({ left: 57.5, right: 182.5, fences: [60, 180] });
    expect(crossSection([0, 1]).fences).toEqual([-180, -60, 60]);
  });
});

describe('port frames', () => {
  it('moves an end port to the middle of the lanes it carries', () => {
    const p = part('t-end-sub', [0, 1, 2], [
      { id: 'a', anchor: 'start', lanes: [0] },
      { id: 'b', anchor: 'end', lanes: [1, 2] },
    ]);
    const [start, end] = partGeometry(p).ports;
    // + right is − X in part coordinates.
    expect(pos(start).distanceTo(new Vector3(-laneOffset(0), 0, 0))).toBeLessThan(1e-9);
    expect(forward(start).z).toBeCloseTo(-1, 9);
    expect(pos(end).distanceTo(new Vector3(-60, 0, 300))).toBeLessThan(1e-9);
    expect(forward(end).z).toBeCloseTo(1, 9);
  });

  it('places a port at an explicit frame', () => {
    const p = part('t-pose', [0, 1, 2], [
      { id: 'a', anchor: 'start', lanes: [0, 1, 2] },
      { id: 'up', anchor: { pos: [-120, 50, 200], rot: [0, 10, 0] }, lanes: [2], kind: 'lc-upper' },
    ]);
    const up = partGeometry(p).ports[1];
    expect(pos(up).distanceTo(new Vector3(-120, 50, 200))).toBeLessThan(1e-9);
    expect(forward(up).y).toBeCloseTo(Math.sin((10 * Math.PI) / 180), 9);
  });

  it('lines up the lanes of narrow ports joined together', () => {
    const a = part('t-join-a', [0, 1, 2], [
      { id: 'a', anchor: 'start', lanes: [0, 1, 2] },
      { id: 'b', anchor: 'end', lanes: [1, 2] },
    ]);
    const b = part('t-join-b', [0, 1], [
      { id: 'a', anchor: 'start', lanes: [0, 1] },
      { id: 'b', anchor: 'end', lanes: [0, 1] },
    ]);
    const end = partGeometry(a).ports[1];
    const m = attach(end, partGeometry(b).ports[0]);
    // Lane 1 of a's end meets lane 0 of b's start, lane 2 meets lane 1.
    expect(jointLanes(a, 1, b, 0)).toEqual([
      [1, 0],
      [2, 1],
    ]);
    const lastA = partGeometry(a).samples.at(-1)!;
    const firstB = m.clone().multiply(partGeometry(b).samples[0]);
    for (const [la, lb] of jointLanes(a, 1, b, 0)) {
      const pa = pointOnFrame(lastA, laneOffset(la), 0);
      const pb = pointOnFrame(firstB, laneOffset(lb), 0);
      expect(pa.distanceTo(pb)).toBeLessThan(1e-9);
    }
  });
});

describe('lanes through parts and joints', () => {
  it('runs each lane straight through a two-ended part', () => {
    expect(laneLinks(getPart('straight'))).toEqual([
      { from: [0, 0], to: [1, 0] },
      { from: [0, 1], to: [1, 1] },
      { from: [0, 2], to: [1, 2] },
    ]);
  });

  it('uses the part’s own table when it has one', () => {
    const links = [{ from: [0, 2], to: [1, 0] }] satisfies PartDef['laneLinks'];
    const p = part('t-links', [0, 1, 2], [
      { id: 'a', anchor: 'start', lanes: [2] },
      { id: 'b', anchor: 'end', lanes: [0] },
    ], { laneLinks: links });
    expect(laneLinks(p)).toBe(links);
  });

  it('meets lane for lane between two normal parts', () => {
    const s = getPart('straight');
    expect(jointLanes(s, 1, s, 0)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('lists the lanes of a posed port left to right looking out of it', () => {
    expect(portLaneOffsets({ id: 'x', anchor: { pos: [0, 0, 0], rot: [0, 0, 0] }, lanes: [1, 2] })).toEqual([
      { lane: 1, right: -60 },
      { lane: 2, right: 60 },
    ]);
  });
});
