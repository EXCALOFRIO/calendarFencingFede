import { freemem } from 'node:os';
import { statfs } from 'node:fs/promises';
import { LIMITS } from './schemas';

const GiB = 1024 ** 3;
export const RESOURCE_LIMITS = {
  freeMemoryReserveBytes: 4 * GiB,
  estimatedWorkerBytes: 768 * 1024 ** 2,
  freeDiskReserveBytes: 2 * GiB,
} as const;

/** Admission estimates are conservative, not an OS memory/process sandbox. */
export function resourceConcurrency(requested: number, freeMemoryBytes: number, freeDiskBytes: number): number {
  if (!Number.isSafeInteger(requested) || requested < 1 || requested > LIMITS.concurrency ||
    !Number.isFinite(freeMemoryBytes) || freeMemoryBytes < 0 ||
    !Number.isFinite(freeDiskBytes) || freeDiskBytes < 0) throw new Error('factory_resource_measurement_invalid');
  if (freeDiskBytes < RESOURCE_LIMITS.freeDiskReserveBytes) throw new Error('factory_resource_disk_pressure');
  const slots = Math.floor((freeMemoryBytes - RESOURCE_LIMITS.freeMemoryReserveBytes) / RESOURCE_LIMITS.estimatedWorkerBytes);
  if (slots < 1) throw new Error('factory_resource_memory_pressure');
  return Math.min(requested, slots);
}
export async function admittedConcurrency(directory: string, requested: number): Promise<number> {
  const disk = await statfs(directory);
  return resourceConcurrency(requested, freemem(), Number(disk.bavail) * Number(disk.bsize));
}
