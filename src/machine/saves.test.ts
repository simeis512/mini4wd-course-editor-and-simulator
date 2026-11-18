import { describe, expect, it } from 'vitest';
import { machineSaveName, sortMachines } from './saves';

describe('machine saves (#31)', () => {
  it('names a save after the machine, apart from the others', () => {
    expect(machineSaveName('  速い号 ', [])).toBe('速い号');
    expect(machineSaveName('速い号', ['速い号'])).toBe('速い号 (2)');
    expect(machineSaveName('', ['マイマシン'])).toBe('マイマシン (2)');
  });

  it('lists the newest first', () => {
    const a = { id: 'a', name: 'a', data: '', savedAt: 1 };
    const b = { id: 'b', name: 'b', data: '', savedAt: 2 };
    expect(sortMachines([a, b]).map((s) => s.id)).toEqual(['b', 'a']);
  });
});
