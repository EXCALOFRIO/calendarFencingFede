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
