import { execFile, type ChildProcess } from 'node:child_process';

type ProcesoPropio = Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'stdio'>;
type Dependencias = {
  terminarArbol: (pid: number) => Promise<void>;
  sigueVivo: (pid: number) => boolean;
};

const dependencias: Dependencias = {
  terminarArbol: (pid) => new Promise<void>((resolve, reject) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true, timeout: 4_000,
    }, (error) => error ? reject(error) : resolve());
  }),
  sigueVivo: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  },
};

/** Only accepts the child launched by our isolated suite with a fresh profile. */
export async function terminarNavegadorPropio(
  proceso: ProcesoPropio,
  deps: Dependencias = dependencias,
): Promise<void> {
  const pid = proceso.pid;
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('owned_browser_pid_invalid');
  if (proceso.exitCode === null && proceso.signalCode === null) {
    try {
      await deps.terminarArbol(pid);
    } catch {
      // taskkill can fail after the OS already removed Chromium while Node
      // still waits for inherited pipes. Only a confirmed missing PID is OK.
      if (proceso.exitCode === null && proceso.signalCode === null && deps.sigueVivo(pid)) {
        throw new Error('owned_browser_tree_termination_failed');
      }
    }
  }
  for (const stream of proceso.stdio) stream?.destroy();
}

/** Temporary profile Playwright created for this owned browser, if any. */
export function perfilPropio(proceso: Pick<ChildProcess, 'spawnargs'>): string | null {
  const arg = proceso.spawnargs.find((a) => a.startsWith('--user-data-dir='));
  const dir = arg?.slice('--user-data-dir='.length).replace(/^"|"$/g, '');
  // Only a fresh Playwright temp profile identifies processes as ours.
  return dir && /playwright_chromiumdev_profile-/.test(dir) ? dir : null;
}

/**
 * Windows only: force-terminates processes whose command line carries our
 * unique temp profile. Chromium helpers can outlive the main process and keep
 * the profile locked; once the root PID is gone, `taskkill /T` no longer
 * reaches them. Returns the PIDs terminated.
 */
export function terminarRestosDelPerfil(perfil: string, ms = 10_000): Promise<number[]> {
  const filtro = perfil.replace(/'/g, "''");
  const script = `$p = '${filtro}'; Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='headless_shell.exe' OR Name='chrome-headless-shell.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($p) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: ms,
    }, (error, stdout) => error ? reject(error) : resolve(
      stdout.split(/\r?\n/).map((l) => Number(l.trim())).filter((n) => Number.isSafeInteger(n) && n > 0),
    ));
  });
}

/**
 * Resolves once the owned process has exited, either by its `exit` event or
 * by the OS no longer knowing the PID; rejects after `ms`. Polling covers the
 * case where the event loop is saturated and `exit` is delivered late.
 */
export function esperarSalidaPropia(
  proceso: ProcesoPropio & Pick<ChildProcess, 'once' | 'off'>,
  ms: number,
  deps: Pick<Dependencias, 'sigueVivo'> = dependencias,
): Promise<void> {
  const pid = proceso.pid;
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return Promise.reject(new Error('owned_browser_pid_invalid'));
  return new Promise<void>((resolve, reject) => {
    const salido = () => proceso.exitCode !== null || proceso.signalCode !== null || !deps.sigueVivo(pid);
    let sondeo: ReturnType<typeof setInterval> | undefined;
    let limite: ReturnType<typeof setTimeout> | undefined;
    const terminar = (error?: Error) => {
      clearInterval(sondeo);
      clearTimeout(limite);
      proceso.off('exit', alSalir);
      if (error) reject(error);
      else resolve();
    };
    const alSalir = () => terminar();
    try {
      if (salido()) return resolve();
    } catch (error) {
      return reject(error);
    }
    proceso.once('exit', alSalir);
    sondeo = setInterval(() => {
      try {
        if (salido()) terminar();
      } catch (error) {
        terminar(error as Error);
      }
    }, 200);
    limite = setTimeout(() => terminar(new Error('owned_browser_exit_timeout')), ms);
  });
}
