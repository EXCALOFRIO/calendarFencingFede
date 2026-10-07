/** Contador efímero del navegador: no persiste datos ni sustituye la sesión del servidor. */
export const INTERVALO_AVISOS_MS = 60_000;
type Lectura = { numero: number; revision: number };
type Oyente = (numero: number) => void;
type Estado = {
  lectura: Lectura;
  consultado: number;
  oyentes: Set<Oyente>;
  pendiente: Promise<void> | null;
  abortar: AbortController | null;
};

export function crearContadorAvisos({
  obtener,
  ahora = Date.now,
}: {
  obtener: (signal: AbortSignal) => Promise<number | null>;
  ahora?: () => number;
}) {
  const cuentas = new Map<string, Estado>();
  const avisar = (e: Estado) => { for (const o of e.oyentes) o(e.lectura.numero); };
  const inicializar = (e: Estado, lectura: Lectura) => {
    // Una revalidación del layout debe actualizar también un número que vuelve a cero.
    if (lectura.revision <= e.lectura.revision) return;
    e.lectura = lectura;
    e.consultado = ahora();
    avisar(e);
  };
  return {
    suscribir(cuenta: string, lectura: Lectura, oyente: Oyente): () => void {
      // fetch usa la cookie actual: no puede alimentar listeners de otra cuenta
      // que el router conserve temporalmente durante un cambio de sesión.
      for (const [otra, anterior] of cuentas) {
        if (otra === cuenta) continue;
        anterior.abortar?.abort();
        cuentas.delete(otra);
      }
      let e = cuentas.get(cuenta);
      if (!e) {
        e = { lectura, consultado: ahora(), oyentes: new Set(), pendiente: null, abortar: null };
        cuentas.set(cuenta, e);
      } else inicializar(e, lectura);
      e.oyentes.add(oyente);
      oyente(e.lectura.numero);
      const estado = e;
      return () => {
        estado.oyentes.delete(oyente);
        if (estado.oyentes.size === 0 && cuentas.get(cuenta) === estado) {
          cuentas.delete(cuenta);
          estado.abortar?.abort();
        }
      };
    },
    lecturaServidor(cuenta: string, lectura: Lectura) {
      const e = cuentas.get(cuenta);
      if (e) inicializar(e, lectura);
    },
    async refrescar(forzar = false): Promise<void> {
      await Promise.all([...cuentas].map(async ([cuenta, e]) => {
        if (e.pendiente) return e.pendiente;
        if (!forzar && ahora() - e.consultado < INTERVALO_AVISOS_MS) return;
        const controlador = new AbortController();
        const revision = e.lectura.revision;
        e.abortar = controlador;
        e.pendiente = (async () => {
          try {
            const numero = await obtener(controlador.signal);
            if (controlador.signal.aborted || cuentas.get(cuenta) !== e || revision !== e.lectura.revision) return;
            if (typeof numero === 'number' && Number.isSafeInteger(numero) && numero >= 0) {
              e.lectura = { ...e.lectura, numero };
              avisar(e);
            }
          } catch {
            // Sin red se mantiene el último número, y puede reintentarse al volver.
          }
        })().finally(() => {
          e.consultado = ahora();
          e.pendiente = null;
          e.abortar = null;
        });
        return e.pendiente;
      }));
    },
  };
}
