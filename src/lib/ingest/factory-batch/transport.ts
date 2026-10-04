import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { LIMITS } from './schemas';

export type Invocation = {
  executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; maxBytes: number; signal: AbortSignal;
};
export type TransportResult = { stdout: string; stderr: string; exitCode: number };
export type Transport = (invocation: Invocation) => Promise<TransportResult>;
/**
 * Allowlist, not a denylist: future DB/cloud/app credential names are removed too.
 * Existing Factory authentication is used through its normal home/login storage
 * or FACTORY_API_KEY; credentials are never inspected, copied to files or logged.
 */
export function childEnvironment(parent: Readonly<Partial<NodeJS.ProcessEnv>> = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
    'SYSTEMDRIVE', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
    'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
    'COMMONPROGRAMFILES', 'ALLUSERSPROFILE', 'LANG', 'LC_ALL', 'TERM',
    'FACTORY_API_KEY', 'FACTORY_API_BASE_URL', 'FACTORY_HOME_OVERRIDE']);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false',
  };
  for (const [key, value] of Object.entries(parent)) {
    if (allowed.has(key.toUpperCase()) && value !== undefined) env[key] = value;
  }
  return env;
}
export async function stopOwnTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('factory_child_pid_invalid');
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`,
        ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
      const timer = setTimeout(() => { child.kill(); reject(new Error('factory_tree_stop_failed')); }, 10000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('factory_tree_stop_failed')); });
      child.once('close', code => {
        clearTimeout(timer);
        // 128 means already exited; never fall back to name-based process killing.
        if (code !== 0 && code !== 128) reject(new Error('factory_tree_stop_failed')); else resolve();
      });
    });
  } else {
    try { process.kill(-pid, 'SIGKILL'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('factory_tree_stop_failed'); }
  }
}
export const spawnTransport: Transport = invocation => new Promise((resolve, reject) => {
  if (!isAbsolute(invocation.executable) || invocation.signal.aborted ||
    invocation.timeoutMs < 1 || invocation.timeoutMs > LIMITS.timeoutSeconds * 1000 ||
    invocation.maxBytes < 1 || invocation.maxBytes > LIMITS.outputBytes) {
    reject(new Error('factory_invocation_invalid')); return;
  }
  const child = spawn(invocation.executable, invocation.args, {
    cwd: invocation.cwd, env: invocation.env, shell: false, windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const failureOutput = (code: string) => Object.assign(new Error(code), {
    partialOutput: { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) },
  });
  let bytes = 0, stopping: Promise<void> | undefined, failed: string | undefined;
  let closed = false, drainDeadline: ReturnType<typeof setTimeout> | undefined;
  const stop = (code: string) => {
    if (closed || stopping) return;
    failed = code;
    if (child.pid) {
      // Handle rejection immediately; close drains both streams before completion.
      stopping = stopOwnTree(child.pid).catch(() => { failed = 'factory_tree_stop_failed'; });
    } else stopping = Promise.resolve();
    // A refused OS kill or inherited open pipe must not hang the coordinator.
    // No retry by image/name and no other process is targeted. Leave started
    // marker for operator reconciliation if stopping cannot be confirmed.
    drainDeadline = setTimeout(() => {
      if (closed) return;
      closed = true;
      clearTimeout(timeout); invocation.signal.removeEventListener('abort', abort);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      reject(failureOutput('factory_tree_drain_failed'));
    }, 12000);
  };
  const accept = (target: Buffer[], chunk: Buffer) => {
    if (failed) return;
    bytes += chunk.length;
    if (bytes > invocation.maxBytes) { stop('factory_output_limit'); return; }
    target.push(chunk);
  };
  child.stdout.on('data', chunk => accept(stdout, chunk));
  child.stderr.on('data', chunk => accept(stderr, chunk));
  const timeout = setTimeout(() => stop('factory_job_timeout'), invocation.timeoutMs);
  const abort = () => stop('factory_campaign_stopped');
  invocation.signal.addEventListener('abort', abort, { once: true });
  if (invocation.signal.aborted) abort();
  child.once('error', () => stop('factory_child_start_failed'));
  child.once('close', async code => {
    if (closed) return;
    closed = true; clearTimeout(timeout); invocation.signal.removeEventListener('abort', abort);
    clearTimeout(drainDeadline);
    await stopping;
    if (failed) { reject(failureOutput(failed)); return; }
    if (code === null) { reject(failureOutput('factory_child_exit_invalid')); return; }
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true });
      resolve({ stdout: decoder.decode(Buffer.concat(stdout)), stderr: decoder.decode(Buffer.concat(stderr)), exitCode: code });
    } catch { reject(failureOutput('factory_output_encoding_invalid')); }
  });
});
