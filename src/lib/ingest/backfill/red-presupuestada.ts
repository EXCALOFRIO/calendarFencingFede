import type { DepsEngarde } from '../sources/engarde';
import type { DepsLecturaFie } from '../sources/fie-resultados';
import type { DepsInventarioFie, DepsInventarioSkermo } from '../sources/historico-indice';
import type { DepsLecturaSkermo } from '../sources/skermo-finales';
import type { DepsLecturaPdf } from '../sources/rfee-pdf/lectura';
import { conPresupuesto, type PresupuestoHttp } from './presupuesto-http';

/**
 * Red del backfill con el presupuesto del lote en cada punto de entrada.
 *
 * Las funciones `base` hacen una sola petición (sin reintentos internos: ver
 * `OpcionesRed`). Aquí cada llamada reserva antes de salir, de modo que un
 * `--max-peticiones 1` no puede convertirse en los 4 o 100 GET que un torneo,
 * una prueba paginada o un índice harían por dentro, y las esperas entre
 * lecturas se niegan si ya no caben en el tiempo del lote.
 */

export type BaseRedBackfill = {
  fetchJson: (url: string) => Promise<unknown>;
  skermoIndice: DepsInventarioSkermo['indice'];
  skermoTemporadas: DepsInventarioSkermo['temporadas'];
  skermoParsear: DepsInventarioSkermo['parsear'];
  skermoHtml: (url: string) => Promise<string>;
  engarde: DepsEngarde;
  bytesPdf: (url: string) => Promise<Uint8Array>;
};

export type RedBackfill = {
  fie: DepsLecturaFie;
  inventarioFie: DepsInventarioFie;
  inventarioSkermo: DepsInventarioSkermo;
  lecturaSkermo: DepsLecturaSkermo;
  engarde: DepsEngarde;
  pdf: DepsLecturaPdf;
};

export function crearRedPresupuestada(
  presupuesto: PresupuestoHttp,
  dormir: (ms: number) => Promise<void>,
  base: BaseRedBackfill,
): RedBackfill {
  const json = conPresupuesto(presupuesto, base.fetchJson);
  const esperar = (ms: number) => presupuesto.esperar(ms, dormir);
  return {
    fie: { fetchJson: json },
    inventarioFie: { json, esperar },
    inventarioSkermo: {
      indice: conPresupuesto(presupuesto, base.skermoIndice),
      temporadas: base.skermoTemporadas,
      parsear: base.skermoParsear,
      esperar,
    },
    lecturaSkermo: { html: conPresupuesto(presupuesto, base.skermoHtml) },
    engarde: {
      get: conPresupuesto(presupuesto, base.engarde.get),
      post: conPresupuesto(presupuesto, base.engarde.post),
      esperar,
    },
    pdf: { bytes: conPresupuesto(presupuesto, base.bytesPdf) },
  };
}
