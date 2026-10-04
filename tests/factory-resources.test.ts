import { describe, expect, it } from 'vitest';
import { resourceConcurrency } from '../src/lib/ingest/factory-batch/resources';
const GiB = 1024 ** 3;
describe('Factory resource admission, no model calls', () => {
  it('admits eight with headroom, lowers parallelism and never increases the requested count', () => {
    expect(resourceConcurrency(8, 12 * GiB, 9 * GiB)).toBe(8);
    expect(resourceConcurrency(8, 7 * GiB, 9 * GiB)).toBe(4);
    expect(resourceConcurrency(4, 12 * GiB, 9 * GiB)).toBe(4);
    expect(resourceConcurrency(8, 4.75 * GiB, 2 * GiB)).toBe(1);
  });
  it('fails closed on exhausted memory/disk and invalid measurements', () => {
    expect(() => resourceConcurrency(8, 4 * GiB, 9 * GiB)).toThrow('factory_resource_memory_pressure');
    expect(() => resourceConcurrency(8, 12 * GiB, GiB)).toThrow('factory_resource_disk_pressure');
    for (const values of [[9, 12 * GiB, 9 * GiB], [0, 12 * GiB, 9 * GiB],
      [8, NaN, 9 * GiB], [8, 12 * GiB, Infinity], [8, -1, 9 * GiB]]) {
      expect(() => resourceConcurrency(...values as [number, number, number])).toThrow('factory_resource_measurement_invalid');
    }
  });
});
