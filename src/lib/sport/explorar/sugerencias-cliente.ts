import { consultaSugerencias, MAX_SUGERENCIAS, MAX_SUGERENCIAS_SOCIAL } from './sugerencias-modelo';
import type { SugerenciaConResumen } from './tipos-busqueda';

export type EstadoSugerencias = { estado: 'reposo' | 'cargando' | 'ok' | 'error'; items: SugerenciaConResumen[] };

export type OpcionesSolicitante = {
  /** Cuántas sugerencias pedir (1-20); por defecto las ocho del desplegable. */
  limite?: number;
  /** Espera tras la última tecla antes de pedir, en ms (250 por defecto). */
  espera?: number;
};

/** Una instancia por campo: caché efímera, nunca compartida entre sesiones. */
export function crearSolicitanteSugerencias(
  recibir: (estado: EstadoSugerencias) => void,
  solicitar: typeof fetch = fetch,
  opciones: OpcionesSolicitante = {},
) {
  const limite = Math.max(1, Math.min(MAX_SUGERENCIAS_SOCIAL, Math.trunc(opciones.limite ?? MAX_SUGERENCIAS)));
  const parametroLimite = limite === MAX_SUGERENCIAS ? '' : `&limite=${limite}`;
  const espera = opciones.espera ?? 250;
  const cache = new Map<string, { hasta: number; items: SugerenciaConResumen[] }>();
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
          const response = await solicitar(`/api/explorar/sugerencias?q=${encodeURIComponent(q)}${parametroLimite}`, {
            signal: aborto.signal, cache: 'no-store', credentials: 'same-origin',
          });
          if (!response.ok) throw new Error('SUGERENCIAS_NO_DISPONIBLES');
          const datos = await response.json() as { estado?: string; items?: SugerenciaConResumen[] };
          if (datos.estado !== 'ok' || !Array.isArray(datos.items)) throw new Error('RESPUESTA_INVALIDA');
          if (turno !== version) return;
          const items = datos.items.slice(0, limite);
          cache.delete(q);
          cache.set(q, { items, hasta: Date.now() + 60_000 });
          while (cache.size > 32) cache.delete(cache.keys().next().value!);
          recibir({ estado: 'ok', items });
        } catch {
          if (turno === version) recibir({ estado: 'error', items: [] });
        }
      }, espera);
    },
  };
}

export function siguienteOpcion(tecla: string, actual: number, cantidad: number): number {
  if (!cantidad) return -1;
  if (tecla === 'ArrowDown') return (actual + 1) % cantidad;
  if (tecla === 'ArrowUp') return actual <= 0 ? cantidad - 1 : actual - 1;
  return actual;
}
