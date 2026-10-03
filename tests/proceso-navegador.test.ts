import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { terminarNavegadorPropio } from './helpers/proceso-navegador';

function fixture() {
  const destroy = vi.fn();
  const estado: { pid: number | undefined; exitCode: number | null } = {
    pid: 12345, exitCode: null,
  };
  const proceso = {
    get pid() { return estado.pid; },
    get exitCode() { return estado.exitCode; },
    signalCode: null,
    stdio: [{ destroy }, null, { destroy }],
  } as unknown as ChildProcess;
  const deps = { terminarArbol: vi.fn(async (_pid: number) => {}), sigueVivo: vi.fn(() => true) };
  return { proceso, estado, destroy, deps };
}

describe('limpieza acotada del navegador aislado propio', () => {
  it('termina solo el PID recibido y libera sus pipes', async () => {
    const { proceso, destroy, deps } = fixture();
    await terminarNavegadorPropio(proceso, deps);
    expect(deps.terminarArbol).toHaveBeenCalledExactlyOnceWith(12345);
    expect(destroy).toHaveBeenCalledTimes(2);
    expect(deps.sigueVivo).not.toHaveBeenCalled();
  });

  it('acepta el error de taskkill si el sistema confirma que el PID ya no existe', async () => {
    const { proceso, destroy, deps } = fixture();
    deps.terminarArbol.mockRejectedValue(new Error('fallo sintético'));
    deps.sigueVivo.mockReturnValue(false);
    await terminarNavegadorPropio(proceso, deps);
    expect(deps.sigueVivo).toHaveBeenCalledExactlyOnceWith(12345);
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('no oculta un fallo con un navegador todavía vivo', async () => {
    const { proceso, destroy, deps } = fixture();
    deps.terminarArbol.mockRejectedValue(new Error('fallo sintético'));
    await expect(terminarNavegadorPropio(proceso, deps))
      .rejects.toThrow('owned_browser_tree_termination_failed');
    expect(destroy).not.toHaveBeenCalled();
  });

  it('no interpreta un fallo del sondeo como ausencia del proceso', async () => {
    const { proceso, destroy, deps } = fixture();
    deps.terminarArbol.mockRejectedValue(new Error('fallo sintético'));
    deps.sigueVivo.mockImplementation(() => { throw new Error('sondeo denegado'); });
    await expect(terminarNavegadorPropio(proceso, deps)).rejects.toThrow('sondeo denegado');
    expect(destroy).not.toHaveBeenCalled();
  });

  it('no vuelve a terminar un proceso cuya salida ya se ha observado', async () => {
    const { proceso, estado, destroy, deps } = fixture();
    estado.exitCode = 0;
    await terminarNavegadorPropio(proceso, deps);
    expect(deps.terminarArbol).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('acepta una salida observada entre taskkill y su callback', async () => {
    const { proceso, estado, destroy, deps } = fixture();
    deps.terminarArbol.mockImplementation(async () => {
      estado.exitCode = 1;
      throw new Error('fallo sintético');
    });
    await terminarNavegadorPropio(proceso, deps);
    expect(deps.sigueVivo).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 0, -1, Number.NaN])('rechaza el PID no válido %s sin ejecutar comandos', async (pid) => {
    const { proceso, estado, destroy, deps } = fixture();
    estado.pid = pid;
    await expect(terminarNavegadorPropio(proceso, deps)).rejects.toThrow('owned_browser_pid_invalid');
    expect(deps.terminarArbol).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});
