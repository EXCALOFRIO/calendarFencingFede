import { consultaSugerencias, MAX_SUGERENCIAS, type SugerenciaPersona } from './sugerencias-modelo';

export type EstadoSugerencias = { estado: 'reposo' | 'cargando' | 'ok' | 'error'; items: SugerenciaPersona[] };

/** Una instancia por campo: caché efímera, nunca compartida entre sesiones. */
export function crearSolicitanteSugerencias(
  recibir: (estado: EstadoSugerencias) => void,
  solicitar: typeof fetch = fetch,
) {
  const cache = new Map<string, { hasta: number; items: SugerenciaPersona[] }>();
  let version = 0;
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  let aborto: AbortController | undefined;
  const cancelar = () => {
    version++;
    clearTimeout(temporizador);
    aborto?.abort();
  };
  return {
    cancelar,
    buscar(texto: string) {
      cancelar();
      const turno = version;
      const q = consultaSugerencias(texto);
      if (!q) { recibir({ estado: 'reposo', items: [] }); return; }
      const guardada = cache.get(q);
      if (guardada && guardada.hasta > Date.now()) {
        cache.delete(q);
        cache.set(q, guardada);
        recibir({ estado: 'ok', items: guardada.items });
        return;
      }
      recibir({ estado: 'cargando', items: [] });
      temporizador = setTimeout(async () => {
        aborto = new AbortController();
        try {
          const response = await solicitar(`/api/explorar/sugerencias?q=${encodeURIComponent(q)}`, {
            signal: aborto.signal, cache: 'no-store', credentials: 'same-origin',
          });
          if (!response.ok) throw new Error('SUGERENCIAS_NO_DISPONIBLES');
          const datos = await response.json() as { estado?: string; items?: SugerenciaPersona[] };
          if (datos.estado !== 'ok' || !Array.isArray(datos.items)) throw new Error('RESPUESTA_INVALIDA');
          if (turno !== version) return;
          const items = datos.items.slice(0, MAX_SUGERENCIAS);
          cache.delete(q);
          cache.set(q, { items, hasta: Date.now() + 60_000 });
          while (cache.size > 32) cache.delete(cache.keys().next().value!);
          recibir({ estado: 'ok', items });
        } catch {
          if (turno === version) recibir({ estado: 'error', items: [] });
        }
      }, 250);
    },
  };
}

export function siguienteOpcion(tecla: string, actual: number, cantidad: number): number {
  if (!cantidad) return -1;
  if (tecla === 'ArrowDown') return (actual + 1) % cantidad;
  if (tecla === 'ArrowUp') return actual <= 0 ? cantidad - 1 : actual - 1;
  return actual;
}
