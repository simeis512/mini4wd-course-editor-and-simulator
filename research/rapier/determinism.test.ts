import { describe, expect, it } from 'vitest';
import { fingerprint } from './determinism-run';

describe('determinism', () => {
  it('gives the same bits twice in one Node process', async () => {
    const a = await fingerprint();
    const b = await fingerprint();
    console.log(`node: ${a}`);
    expect(b).toBe(a);
  }, 60000);
});
