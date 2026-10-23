import { Matrix4 } from 'three';
import { basicOval, chain } from './presets';
import { layoutCourse, type Course, type PieceRec } from './course';
import { deletePiece, moveGroup } from './edit';
import { footprint } from './edit';
import { joinPart } from './add';

/** Deterministic performance fixtures (#87); dimensions are fixture choices, not part specifications. */
function oval(extra: number, slopes: boolean): Course {
  const course = chain([]);
  let far = 1;
  const append = (part: string, port = 0) => {
    const i = course.pieces.length;
    course.pieces.push(i ? { part, port, to: [i - 1, far] } : { part, at: 'origin' });
    far = 1 - port;
  };
  for (let i = 0; i < 3 + extra; i++) {
    if (slopes && i === 1) append('slope');
    else if (slopes && i === extra) append('slope', 1);
    else append(i === 2 ? 'wave' : 'straight');
  }
  for (let i = 0; i < 4; i++) append('curve45');
  append('bridge-approach');
  append('lane-change-center');
  append('bridge-approach', 1);
  for (let i = 0; i < extra; i++) append(i === 2 ? 'wave' : 'straight');
  for (let i = 0; i < 4; i++) append('curve45');
  return course;
}

/** Append an independently placed island, preserving its connection graph. */
function island(target: Course, source: Course, transform: Matrix4): void {
  const placed = moveGroup(source, new Set(source.pieces.map((_, i) => i)), transform);
  const offset = target.pieces.length;
  target.pieces.push(...placed.pieces.map((rec): PieceRec => {
    if ('to' in rec) return { ...rec, to: [rec.to[0] + offset, rec.to[1]] };
    if ('free' in rec && rec.free) return { ...rec, free: [rec.free[0] + offset, rec.free[1]] };
    return rec;
  }));
}

export type BenchSize = 'S' | 'M' | 'L';

export function benchCourse(size: BenchSize): Course {
  if (size === 'S') return basicOval();
  const medium = oval(23, true);
  if (size === 'M') return medium;
  const large = structuredClone(medium);
  island(large, medium, new Matrix4().makeTranslation(0, 220, 0));
  island(large, medium, new Matrix4().makeTranslation(600, 440, 4000).multiply(new Matrix4().makeRotationY(Math.PI / 2)));
  island(large, oval(3, false), new Matrix4().makeTranslation(3000, 0, 1500));
  large.stoppers = [
    { kind: 'hose', color: 0, closed: true, points: [[-600, -500], [600, -500], [600, 2000], [-600, 2000]] },
    { kind: 'box', size: 0, x: 0, z: 3000, yaw: 25 },
    { kind: 'box', size: 2, x: 2200, z: 4000, yaw: 90 },
  ];
  return large;
}

/** Remove one straight, then measure adding that straight back to its original port (#87). */
export function benchAddition(size: BenchSize) {
  const course = deletePiece(benchCourse(size), 0);
  const at = layoutCourse(course).open.find((r) => r.piece === 0)!;
  const next = joinPart(course, 'straight', at)!.course;
  const box = footprint(layoutCourse(next).pieces[next.pieces.length - 1]);
  return { course, at, next, x: (box[0] + box[1]) / 2, z: (box[2] + box[3]) / 2 };
}
