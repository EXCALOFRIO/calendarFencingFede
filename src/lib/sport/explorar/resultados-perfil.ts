import { LIMITE_PRUEBAS_AMBITO, type FilaPruebaAmbito } from './stats-ambito';
import { clasificarCompeticion, importanciaCompeticion, PUESTO_SIN_CLASIFICAR } from './tipo-competicion';
import type { Arma, Genero } from './tipos';
import type { ResultadoPerfil, ResultadosPerfil } from './tipos-perfil';
import type { AmbitoCompeticion } from './tipos-social';

/**
 * Resultados del perfil a partir de las filas por prueba de `sqlPruebasAmbito`
 * (las mismas que dan las cifras por ámbito), así lista, «mejores» y cifras
 * cuentan las mismas pruebas con la misma clasificación.
 */

export type AmbitoResultados = 'todo' | AmbitoCompeticion;

export const AMBITOS_RESULTADOS: readonly AmbitoResultados[] = ['todo', 'internacional', 'nacional'];

export function esAmbitoResultados(valor: string): valor is AmbitoResultados {
  return (AMBITOS_RESULTADOS as readonly string[]).includes(valor);
}

const n = (v: unknown) => (v == null ? 0 : Number(v));

function aResultado(f: FilaPruebaAmbito): ResultadoPerfil | null {
  // Una prueba con asaltos pero sin clasificación publicada no es un resultado.
  if (!f.resultadoId || !f.edicionId || !f.arma || !f.genero || !f.temporada) return null;
  const clasificacion = clasificarCompeticion({
    nombre: f.torneo, fuente: f.fuente, pais: f.pais,
    ambitoEvento: f.ambitoEvento, circuitoEvento: f.circuitoEvento, fuenteEvento: f.fuenteEvento,
  });
  const asaltos = n(f.asaltos);
  const puesto = f.puestoResultado == null ? null : Number(f.puestoResultado);
  const centinela = puesto !== null && puesto >= PUESTO_SIN_CLASIFICAR;
  const fiable = f.puesto == null ? null : Number(f.puesto);
  return {
    id: f.resultadoId,
    puesto: centinela ? null : puesto,
    puestoPublicado: centinela ? 'Sin puesto final' : f.puestoPublicado ?? null,
    puntosOficiales: f.puntos ?? null,
    fuente: f.fuenteResultado ?? f.fuente,
    enlace: f.enlace ?? null,
    torneo: { id: f.edicionId, nombre: f.torneo, ciudad: f.ciudad ?? null, pais: f.pais },
    tipoDocumentado: null,
    prueba: {
      id: f.pruebaResultado ?? f.edicionId,
      arma: f.arma as Arma,
      genero: f.genero as Genero,
      categoria: { codigo: f.categoria, raw: f.categoriaRaw ?? null },
      formato: 'INDIVIDUAL',
    },
    temporada: f.temporada,
    fecha: f.fecha ?? null,
    clasificacion,
    asaltos: asaltos > 0 ? { victorias: n(f.victorias), derrotas: n(f.derrotas) } : null,
    puestoFiable: fiable !== null && fiable < PUESTO_SIN_CLASIFICAR ? fiable : null,
  };
}

export function aResultadosPerfil(rows: readonly FilaPruebaAmbito[]): ResultadosPerfil {
  const conOrden = rows
    .slice(0, LIMITE_PRUEBAS_AMBITO)
    .map((f) => ({ r: aResultado(f), orden: f.fechaOrden ?? '0001-01-01' }))
    .filter((x): x is { r: ResultadoPerfil; orden: string } => x.r !== null);
  conOrden.sort((a, b) => (a.orden < b.orden ? 1 : a.orden > b.orden ? -1 : a.r.id.localeCompare(b.r.id)));
  const items = conOrden.map((x) => x.r);
  const porAmbito: Record<AmbitoCompeticion, number> = { internacional: 0, nacional: 0 };
  for (const r of items) porAmbito[r.clasificacion.ambito] += 1;
  return { items, porAmbito, truncado: rows.length > LIMITE_PRUEBAS_AMBITO };
}

export function filtrarPorAmbito(items: readonly ResultadoPerfil[], ambito: AmbitoResultados): ResultadoPerfil[] {
  return ambito === 'todo' ? [...items] : items.filter((r) => r.clasificacion.ambito === ambito);
}

/** Ámbitos con algún resultado; el selector sólo tiene sentido con los dos. */
export function ambitosConResultados(resultados: ResultadosPerfil): AmbitoCompeticion[] {
  return (['internacional', 'nacional'] as const).filter((a) => resultados.porAmbito[a] > 0);
}

/**
 * Mejores competiciones: primero las medallas, luego la importancia del tipo
 * de competición y después el puesto; a igualdad, la más reciente. Sólo
 * entran puestos consensuados entre fuentes.
 */
export function mejoresCompeticiones(items: readonly ResultadoPerfil[], cuantas = 6): ResultadoPerfil[] {
  return items
    .filter((r) => r.puestoFiable !== null && r.puestoFiable > 0)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const pa = a.r.puestoFiable!, pb = b.r.puestoFiable!;
      const medallaA = pa <= 3 ? 0 : 1, medallaB = pb <= 3 ? 0 : 1;
      return medallaA - medallaB
        || importanciaCompeticion(a.r.clasificacion.tipo) - importanciaCompeticion(b.r.clasificacion.tipo)
        || pa - pb
        || a.i - b.i;
    })
    .slice(0, cuantas)
    .map((x) => x.r);
}

/** Paso de «Ver más» del historial completo. */
export const PASO_HISTORIAL = 20;

/** Cuántos resultados del historial completo enseñar según el `ver` de la URL. */
export function cuantosVer(ver: number, total: number): number {
  const pedido = Number.isFinite(ver) && ver > 0 ? Math.ceil(ver / PASO_HISTORIAL) * PASO_HISTORIAL : PASO_HISTORIAL;
  return Math.min(pedido, total);
}
