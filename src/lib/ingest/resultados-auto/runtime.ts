import { trasIngesta, type DepsTrasIngesta, type ResumenTrasIngesta } from '../tras-ingesta';
import { leerConfigResultadosAuto } from './config';
import type { ResumenResultadosAuto } from './ejecutar';

export const FUENTE_RESULTADOS_AUTO = 'resultados_auto';

/**
 * Tras una pasada que escribió algo (filas o eventos, aunque se cortase a medias): avisos de
 * resultados nuevos y caché. Una pasada que no escribió no tiene nada que avisar ni invalidar;
 * lo que quedase pendiente de otra pasada lo recoge el cron diario de avisos.
 */
export async function despuesDePasada(
  r: ResumenResultadosAuto, deps: DepsTrasIngesta = {},
): Promise<ResumenResultadosAuto & { tras?: ResumenTrasIngesta }> {
  if (r.filas <= 0 && r.eventos <= 0) return r;
  return { ...r, tras: await trasIngesta(FUENTE_RESULTADOS_AUTO, deps) };
}

/**
 * Entrada del cron. Apagada por defecto (`RESULTADOS_AUTO_ENABLED`): sin el interruptor no abre
 * la base ni pide nada a ninguna fuente. Nunca devuelve mensajes de excepción ni datos de la fuente.
 */
export async function runResultadosAuto(): Promise<ResumenResultadosAuto & { tras?: ResumenTrasIngesta }> {
  const config = leerConfigResultadosAuto();
  const vacio: ResumenResultadosAuto = {
    ok: true, status: 'deshabilitado', filas: 0, bytesLedger: 0, peticiones: 0, eventos: 0,
    unidades: { procesadas: 0, escritas: 0, sinCambios: 0, esperando: 0, revision: 0, errores: 0, descubiertas: 0 },
    ia: { llamadas: 0, neuronas: 0, aceptadas: 0 }, detalle: [],
  };
  if (!config.habilitado) return vacio;
  try {
    const [{ db }, { ejecutarResultadosAuto }, { presupuestoD1 }] = await Promise.all([
      import('@/db'), import('./ejecutar'), import('../backfill/capacidad-db'),
    ]);
    const clienteIa = async () => {
      const { crearClienteModelo, leerConfiguracionIa } = await import('@/lib/ai/extract');
      return crearClienteModelo(leerConfiguracionIa());
    };
    const ia = config.iaHabilitada ? await clienteIa() : null;
    const r = await ejecutarResultadosAuto({
      db, config, presupuestoBytes: presupuestoD1(), clienteIa: () => ia,
    });
    return await despuesDePasada(r, { db });
  } catch {
    return { ...vacio, ok: false, status: 'configuracion_o_db' };
  }
}
