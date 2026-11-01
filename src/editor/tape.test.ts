import { describe, expect, it } from 'vitest';
import { TAPE_KINDS } from '../course/tape';
import { changedTape } from './tape';

describe('tape setting (#133)', () => {
  it('turns the floor and the walls on and off', () => {
    const floor = changedTape({}, 'floor', 'on', true)!;
    expect(floor.floor).toEqual({ kind: 'curing', ...{ width: TAPE_KINDS.curing.width, friction: TAPE_KINDS.curing.friction } });
    const both = changedTape(floor, 'wall', 'on', true)!;
    expect(both.wall?.dividers).toBe(false);
    expect(changedTape(both, 'floor', '', false)).toEqual({ wall: both.wall });
  });

  it('fills in width and friction when the kind is picked, and keeps typed values in range', () => {
    const t = changedTape({}, 'wall', '', true)!;
    expect(changedTape(t, 'wall-kind', 'cloth', true)!.wall).toMatchObject({ kind: 'cloth', friction: TAPE_KINDS.cloth.friction, dividers: false });
    expect(changedTape(t, 'wall-width', '500', true)!.wall!.width).toBe(100);
    expect(changedTape(t, 'wall-friction', '0.4444', true)!.wall!.friction).toBe(0.444);
    expect(changedTape(t, 'wall-dividers', 'on', true)!.wall!.dividers).toBe(true);
    expect(changedTape(t, 'wall-dividers', 'on', false)!.wall!.dividers).toBe(false);
    expect(changedTape(t, 'floor-width', '30', true)).toBeNull();
  });
});
