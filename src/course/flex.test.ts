import { Float32BufferAttribute, Mesh, Quaternion, Vector3, type Group, type Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { getPart } from './catalog';
import { courseFromBytes, courseToBytes } from './codec';
import { layoutCourse, type Course } from './course';
import { flipPiece, jointBend, setBend, setTwist } from './edit';
import { BEND_LIMIT, pieceGeometry, Twist, TWIST_LIMIT } from './flex';
import { partGeometry, pointOnFrame } from './geometry';
import { supports } from './height';
import { splitJoint } from './joining';
import { buildCourseMeshes } from './mesh';
import { chain } from './presets';

const DEG = Math.PI / 180;
const pos = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
const right = (m: Matrix4) => new Vector3(-1, 0, 0).transformDirection(m);
/** Angle between two frames' orientations, deg. */
const turnBetween = (a: Matrix4, b: Matrix4) => new Quaternion().setFromRotationMatrix(a).angleTo(new Quaternion().setFromRotationMatrix(b)) / DEG;
const joint01 = [{ piece: 0, port: 1 }, { piece: 1, port: 0 }] as const;

describe('joint bend (spec 16.1)', () => {
  it('climbs from the joint with positive pitch', () => {
    const c = setBend(chain(['straight', 'straight']), ...joint01, { pitch: 2 });
    const end = layoutCourse(c).pieces[1].ports[1];
    expect(pos(end).y).toBeCloseTo(540 * Math.sin(2 * DEG), 6);
    expect(pos(end).z).toBeCloseTo(540 + 540 * Math.cos(2 * DEG), 6);
    // The joint itself stays where it was.
    expect(pos(layoutCourse(c).pieces[1].ports[0]).distanceTo(new Vector3(0, 0, 540))).toBeLessThan(1e-9);
  });

  it('turns left with positive yaw', () => {
    const c = setBend(chain(['straight', 'straight']), ...joint01, { yaw: 2 });
    expect(pos(layoutCourse(c).pieces[1].ports[1]).x).toBeGreaterThan(0);
  });

  it('keeps the joined pieces joined', () => {
    const layout = layoutCourse(setBend(chain(['straight', 'curve45', 'straight']), ...joint01, { pitch: 3 }));
    expect(layout.joints).toHaveLength(2);
    expect(layout.open).toHaveLength(2);
  });

  it('reads and clears a bend, rounded to 0.01° (#86)', () => {
    let c = setBend(chain(['straight', 'straight']), ...joint01, { pitch: 1.234 });
    expect(jointBend(c, ...joint01)).toEqual({ pitch: 1.23 });
    expect(jointBend(c, joint01[1], joint01[0])).toEqual({ pitch: 1.23 });
    c = setBend(c, ...joint01, { pitch: 0 });
    expect('bend' in c.pieces[1]).toBe(false);
  });

  it('only bends stored links', () => {
    const ring = chain(Array(8).fill('curve45'));
    // The last piece meets the first by loop closure.
    expect(setBend(ring, { piece: 7, port: 1 }, { piece: 0, port: 0 }, { pitch: 1 })).toBe(ring);
  });

  it('warns past the limit but still bends', () => {
    const at = layoutCourse(setBend(chain(['straight', 'straight']), ...joint01, { pitch: BEND_LIMIT }));
    expect(at.problems).toEqual([]);
    const past = layoutCourse(setBend(chain(['straight', 'straight']), ...joint01, { pitch: -(BEND_LIMIT + 0.1) }));
    expect(past.problems).toEqual([{ kind: 'bend-limit', piece: 1, port: 0 }]);
    expect(pos(past.pieces[1].ports[1]).y).toBeLessThan(0);
  });

  it('stays put when split', () => {
    const c = setBend(chain(['straight', 'straight']), ...joint01, { pitch: 2 });
    const before = layoutCourse(c).pieces[1].matrix;
    const after = layoutCourse(splitJoint(c, ...joint01)).pieces[1].matrix;
    after.elements.forEach((e, i) => expect(e).toBeCloseTo(before.elements[i], 6));
  });

  it('raises road onto supports', () => {
    // Up 3° and down again 4 pieces on: the middle stands off the floor.
    let c = chain(['straight', 'straight', 'straight', 'straight', 'straight']);
    c = setBend(c, ...joint01, { pitch: 3 });
    c = setBend(c, { piece: 3, port: 1 }, { piece: 4, port: 0 }, { pitch: -3 });
    const layout = layoutCourse(c);
    expect(pos(layout.pieces[4].ports[1]).y).toBeCloseTo(3 * 540 * Math.sin(3 * DEG), 6);
    expect(supports(layout).some((s) => s.piece === 2)).toBe(true);
  });
});

describe('piece twist (spec 16.2)', () => {
  it('lowers the right side at the far end, evenly along the piece', () => {
    const geo = pieceGeometry(getPart('straight'), 2);
    expect(right(geo.ports[1]).y).toBeCloseTo(-Math.sin(2 * DEG), 9);
    const n = geo.samples.length - 1;
    geo.samples.forEach((s, i) => expect(right(s).y).toBeCloseTo(-Math.sin(((2 * i) / n) * DEG), 9));
    // The near end and the centreline stay put.
    const plain = partGeometry(getPart('straight'));
    expect(turnBetween(geo.ports[0], plain.ports[0])).toBeLessThan(1e-6);
    geo.samples.forEach((s, i) => expect(pos(s).distanceTo(pos(plain.samples[i]))).toBeLessThan(1e-9));
  });

  it('keeps a curve on its path', () => {
    const plain = partGeometry(getPart('curve45'));
    const geo = pieceGeometry(getPart('curve45'), -3);
    expect(pos(geo.ports[1]).distanceTo(pos(plain.ports[1]))).toBeLessThan(1e-9);
    expect(right(geo.ports[1]).y).toBeCloseTo(Math.sin(3 * DEG), 9);
  });

  it('carries on into the next piece', () => {
    const c = setTwist(chain(['straight', 'straight']), 0, 2);
    const layout = layoutCourse(c);
    expect(right(layout.pieces[1].ports[1]).y).toBeCloseTo(-Math.sin(2 * DEG), 9);
    expect(layout.joints).toHaveLength(1);
  });

  it('turns every road and port of a lane change with the centreline beside it', () => {
    const plain = partGeometry(getPart('bridge-approach'));
    const geo = pieceGeometry(getPart('bridge-approach'), 2);
    // The upper port stands at the start of the bridge, part way along.
    expect(turnBetween(geo.ports[2], plain.ports[2])).toBeGreaterThan(0.1);
    expect(turnBetween(geo.ports[2], plain.ports[2])).toBeLessThan(2);
    expect(geo.tracks).toHaveLength(plain.tracks.length);
  });

  it('warns past the limit', () => {
    expect(layoutCourse(setTwist(chain(['straight']), 0, TWIST_LIMIT)).problems).toEqual([]);
    expect(layoutCourse(setTwist(chain(['straight']), 0, TWIST_LIMIT + 1)).problems).toEqual([{ kind: 'twist-limit', piece: 0, port: 0 }]);
  });

  it('keeps its twist when turned round', () => {
    const c = flipPiece(setTwist(chain(['straight', 'curve45']), 1, 1.5), 1);
    expect(c.pieces[1].twist).toBe(1.5);
    expect(flipPiece(setTwist(chain(['straight']), 0, 1), 0).pieces[0].twist).toBe(1);
  });

  it('deforms mesh vertices the same way as the swept road', () => {
    const geo = pieceGeometry(getPart('curve45'), 2.5);
    const t = new Twist(partGeometry(getPart('curve45')).samples, 2.5);
    const plainEnd = partGeometry(getPart('curve45')).samples.at(-1)!;
    // A fence top at the far end, 150 mm right of the centreline.
    const p = pointOnFrame(plainEnd, 150, 50);
    const attr = new Float32BufferAttribute([p.x, p.y, p.z], 3);
    t.deform(attr);
    const want = pointOnFrame(geo.samples.at(-1)!, 150, 50);
    expect(new Vector3(attr.getX(0), attr.getY(0), attr.getZ(0)).distanceTo(want)).toBeLessThan(1e-3);
  });

  it('builds twisted road meshes', () => {
    const [plain] = buildCourseMeshes(layoutCourse(chain(['straight'])));
    const [twisted] = buildCourseMeshes(layoutCourse(setTwist(chain(['straight']), 0, 3)));
    const geoOf = (g: Group) => (g.children[0] as Mesh).geometry;
    expect(geoOf(twisted)).not.toBe(geoOf(plain));
    expect(geoOf(twisted).getAttribute('position').count).toBe(geoOf(plain).getAttribute('position').count);
  });
});

describe('URL format 2 (spec 16.5)', () => {
  const bent = (): Course => setTwist(setBend(chain(['straight', 'curve45', 'straight']), ...joint01, { pitch: -1.5, yaw: 0.3 }), 2, 2.2);

  it('round-trips bends and twists', () => {
    const c = bent();
    expect(courseFromBytes(courseToBytes(c))).toEqual(c);
  });

  it('costs nothing when there are none', () => {
    const plain = chain(['straight', 'curve45', 'straight']);
    expect(courseToBytes(bent()).length).toBeGreaterThan(courseToBytes(plain).length);
    expect(courseFromBytes(courseToBytes(plain))).toEqual(plain);
  });
});
