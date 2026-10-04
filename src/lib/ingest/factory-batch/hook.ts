/**
 * Standalone, dependency-free Node hook copied verbatim into each private job.
 * Every failure must exit 2: other error exit codes are NONBLOCKING in Droid.
 * Exit 0 observes a permitted read; it never auto-approves permissions.
 */
export const HOOK_SOURCE = String.raw`import { lstat, realpath, open, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, isAbsolute, parse, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const hash = value => createHash('sha256').update(value).digest('hex');
const root = dirname(fileURLToPath(import.meta.url));
let request = null, policy = null, chunks = [], bytes = 0;
const digest = /^[a-f0-9]{64}$/;
async function checked(path, max) {
  if (!isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw Error('denied');
  let p = resolve(path);
  for (;;) {
    if ((await lstat(p)).isSymbolicLink()) throw Error('denied');
    if (p === parse(p).root) break;
    p = dirname(p);
  }
  if (await realpath(path) !== resolve(path)) throw Error('denied');
  const before = await lstat(path);
  if (!before.isFile() || before.size > max) throw Error('denied');
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.ino !== before.ino || info.dev !== before.dev || info.size !== before.size) throw Error('denied');
    const buffer = Buffer.alloc(before.size + 1);
    let n = 0;
    while (n < buffer.length) {
      const read = await handle.read(buffer, n, buffer.length - n, n);
      if (!read.bytesRead) break;
      n += read.bytesRead;
    }
    if (n !== before.size || (await handle.stat()).size !== before.size) throw Error('denied');
    return buffer.subarray(0, n);
  } finally { await handle.close(); }
}
async function audit(decision, inputSha256 = null) {
  const path = join(root, 'audit.jsonl');
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 262144 - 1024) throw Error('denied');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const requested = typeof request?.tool_input?.file_path === 'string' ? request.tool_input.file_path : '';
  const sessionId = typeof request?.session_id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.session_id) ? request.session_id : null;
  await appendFile(path, JSON.stringify({ version: 1, sessionId, tool: request?.tool_name === 'Read' ? 'Read' : 'other',
    decision, requestedPathSha256: hash(requested), inputSha256 }) + '\n', { mode: 0o600 });
}
async function main() {
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 65536) throw Error('denied');
    chunks.push(chunk);
  }
  request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  policy = JSON.parse((await checked(join(root, 'policy.json'), 65536)).toString('utf8'));
  if (!policy || policy.version !== 1 || !Array.isArray(policy.inputs) || !policy.inputs.length ||
    policy.inputs.length > 100 || request?.hook_event_name !== 'PreToolUse' || request?.tool_name !== 'Read' ||
    !request.tool_input || typeof request.tool_input !== 'object' || Array.isArray(request.tool_input) ||
    typeof request.tool_input.file_path !== 'string' || !request.session_id ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(request.session_id)) throw Error('denied');
  const keys = ['file_path', 'offset', 'limit', 'line_numbers', 'image_quality'];
  if (Object.keys(request.tool_input).some(k => !keys.includes(k))) throw Error('denied');
  for (const k of ['offset', 'limit']) {
    if (request.tool_input[k] !== undefined && (!Number.isSafeInteger(request.tool_input[k]) ||
      request.tool_input[k] < 1 || request.tool_input[k] > 10000)) throw Error('denied');
  }
  if (request.tool_input.line_numbers !== undefined && typeof request.tool_input.line_numbers !== 'boolean') throw Error('denied');
  if (request.tool_input.image_quality !== undefined &&
    !['default', 'high'].includes(request.tool_input.image_quality)) throw Error('denied');
  const requested = request.tool_input.file_path;
  if (!isAbsolute(requested) || requested.split(/[\\/]/).includes('..')) throw Error('denied');
  const pin = policy.inputs.find(p => p.path === requested);
  if (!pin || !digest.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) ||
    pin.bytes < 1 || pin.bytes > 3145728 ||
    !/^inputs[\\/][a-f0-9]{64}\.(pdf|json|txt)$/.test(pin.file) ||
    pin.path !== join(root, pin.file)) throw Error('denied');
  const data = await checked(requested, pin.bytes);
  if (data.length !== pin.bytes || hash(data) !== pin.sha256) throw Error('denied');
  await audit('observed', pin.sha256);
}
try { await main(); process.exitCode = 0; }
catch {
  try { await audit('denied'); } catch {}
  process.stderr.write('factory_read_denied\n');
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse',
    permissionDecision: 'deny', permissionDecisionReason: 'factory_read_denied' } }) + '\n');
  process.exitCode = 2;
}
`;

export const SETTINGS = {
  model: 'gpt-6-sol', cloudSessionSync: false, hooksDisabled: false,
  enableDroidShield: true, ideAutoConnect: false,
  sessionDefaultSettings: { interactionMode: 'auto', autonomyLevel: 'off' },
};
/** Shell is used by the CLI hook subsystem, not by the extraction transport. */
export function quoteHookPath(path: string, platform = process.platform): string {
  if (!path || /[\r\n\0]/.test(path)) throw new Error('factory_hook_command_path_invalid');
  if (platform === 'win32') {
    // Safe for cmd and PowerShell native arguments. Reject expansion/metacharacters.
    if (/["%&|<>^`$!]/.test(path)) throw new Error('factory_hook_command_path_invalid');
    return `"${path}"`;
  }
  return `'${path.replaceAll("'", "'\\''")}'`;
}
export function hooksConfig(node: string, script: string) {
  return { PreToolUse: [{ matcher: '*', hooks: [{
    type: 'command', command: `${quoteHookPath(node)} ${quoteHookPath(script)}`, timeout: 15,
  }] }] };
}
