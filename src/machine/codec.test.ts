import { describe, expect, it } from 'vitest';
import { decodeSetup, encodeSetup, machineValueOf, setupFromBytes, setupToBytes, setupToHash } from './codec';
import { standardSetup, type MachineSetup } from './setup';

const full: MachineSetup = {
  ...standardSetup(),
  name: 'テスト号',
  chassis: 'ma',
  motor: 'hyper-dash-pro',
  gearRatio: 3.7,
  battery: 'neo-champ',
  tyre: 'small-narrow',
  tyreKind: 'low-friction',
  measuredMass: 142.3,
  rollers: [
    { z: 72.5, y: 8, width: 104.5, diameter: 19, kind: 'plastic-bearing' },
    { z: -70, y: 23.5, width: 105, diameter: 13, kind: 'rubber-ring' },
  ],
  dampers: [
    { weight: 'heavy', x: 30, y: 12.5, z: -40, stroke: 4 },
    { weight: 'round', x: 0, y: 30, z: 60, stroke: 0 },
  ],
  brakes: [{ sponge: 'mild-blue', z: -75, width: 40, length: 10, gap: 1.5 }],
  weights: [{ mass: 2.4, x: -10, y: 5, z: 20 }],
};

describe('machine codec (#31)', () => {
  it('round-trips a full setup', async () => {
    expect(setupFromBytes(setupToBytes(full))).toEqual(full);
    expect(await decodeSetup(await encodeSetup(full))).toEqual(full);
  });

  it('round-trips the standard setup without a name', () => {
    const s = standardSetup();
    expect(setupFromBytes(setupToBytes(s))).toEqual(s);
  });

  it('is short enough for a QR code', async () => {
    expect((await encodeSetup(full)).length).toBeLessThan(200);
  });

  it('writes and finds the m value in a hash, apart from the course', async () => {
    const hash = await setupToHash(full);
    expect(hash.startsWith('#m=1.')).toBe(true);
    expect(machineValueOf(hash)).toBe(hash.slice(3));
    expect(machineValueOf('#c=9.abc')).toBeNull();
  });

  it('refuses other versions and broken data', async () => {
    await expect(decodeSetup('9.AAAA')).rejects.toThrow('版 9');
    await expect(decodeSetup('nope')).rejects.toThrow();
    expect(() => setupFromBytes(Uint8Array.from([0, 99]))).toThrow();
    expect(() => setupFromBytes(Uint8Array.from([...setupToBytes(full), 0]))).toThrow();
  });
});
