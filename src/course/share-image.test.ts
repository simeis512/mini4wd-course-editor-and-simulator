import { describe, expect, it } from 'vitest';
import { layoutCourse } from './course';
import { checkLaps } from './laps';
import { basicOval } from './presets';
import { courseExtent, frameIn, shareFacts, shareLayout, SHARE_ASPECTS } from './share-image';

describe('shareLayout', () => {
  it.each(SHARE_ASPECTS.map((a) => a.id))('fills the %s picture with the course and the facts band, without overlap', (aspect) => {
    const { width, height, course, info } = shareLayout(aspect);
    expect(course.w * course.h + info.w * info.h).toBe(width * height);
    expect(course.x + course.w <= info.x || course.y + course.h <= info.y).toBe(true);
  });

  it('puts the facts on the right of a landscape picture and under a portrait one', () => {
    expect(shareLayout('landscape').info.x).toBeGreaterThan(0);
    expect(shareLayout('portrait').info.y).toBeGreaterThan(0);
  });
});

describe('frameIn', () => {
  it('is as large as fits, centred', () => {
    expect(frameIn(1000, 500, 1, 0)).toEqual({ x: 250, y: 0, w: 500, h: 500 });
    expect(frameIn(1000, 500, 4, 50)).toEqual({ x: 50, y: 137.5, w: 900, h: 225 });
  });
});

describe('courseExtent and shareFacts', () => {
  const layout = layoutCourse(basicOval());

  it('measures the basic oval, fences included: a U-turn across, two straights and two U-turns along', () => {
    const { x, z } = courseExtent(layout);
    expect(Math.min(x, z)).toBeCloseTo(1445, 0);
    expect(Math.max(x, z)).toBeCloseTo(3065, 0);
  });

  it('gives the full run of the basic oval as about 20 m', () => {
    const facts = shareFacts(checkLaps(layout), courseExtent(layout), layout.pieces.length);
    expect(facts[0]).toEqual({ label: '全長（3周）', value: '20.0 m' });
    expect(facts.map((f) => f.label)).toEqual(['全長（3周）', '大きさ', 'ピース']);
    expect(facts[2].value).toBe(`${layout.pieces.length} 個`);
  });

  it('leaves out the length when a lane is broken, and the size of an empty course', () => {
    expect(shareFacts(null, { x: 0, z: 0 }, 0)).toEqual([{ label: 'ピース', value: '0 個' }]);
  });
});
