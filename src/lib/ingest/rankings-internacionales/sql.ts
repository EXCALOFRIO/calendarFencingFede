import { cargoFila, uuidDeClave } from '../ranking-skermo-historico';
import type { ListaInternacional } from './tipos';

/**
 * Sentencias de carga de una lista en `sport_ranking_publication` /
 * `sport_ranking_entry`, idempotentes y pensadas para ir dentro de un fichero
 * con cabecera de lease y contexto de capacidad (`componerChunk`).
 *
 * - Ids deterministas: volver a generar no cambia nada.
 * - Lista cerrada (temporada terminada): la cabecera sólo entra si no hay
 *   ninguna publicación de esa lista, de ningún día.
 * - Lista abierta (temporada en curso): entra si no hay una del mismo día; las
 *   lecturas toman la publicación más reciente.
 * - Las entradas sólo entran si la cabecera es la de esta carga.
 */

export type FilaSql = {
  ref: string;
  personId: string | null;
  nombre: string | null;
  pais: string | null;
  puesto: number | null;
  puntos: string | null;
};

export function lit(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('entero_esperado');
    return String(v);
  }
  if (/[\0\r\n;]/.test(v)) return `CAST(X'${Buffer.from(v, 'utf8').toString('hex')}' AS TEXT)`;
  return `'${v.replace(/'/g, "''")}'`;
}

export function idPublicacionInternacional(l: Pick<ListaInternacional, 'fuente' | 'temporada' | 'arma' | 'genero' | 'categoriaRaw' | 'publicadoEl'>): string {
  return uuidDeClave(['sport_ranking_publication', l.fuente, l.temporada, l.arma, l.genero, l.categoriaRaw, 'INDIVIDUAL', l.publicadoEl].join('|'));
}

const FILAS_POR_INSERT = 80;

export function sentenciasLista(
  l: ListaInternacional,
  filas: readonly FilaSql[],
  cerrada: boolean,
): { sentencias: string[]; cargo: number; id: string } {
  const id = idPublicacionInternacional(l);
  const mismaLista = `source=${lit(l.fuente)} AND season=${lit(l.temporada)} AND weapon=${lit(l.arma)} AND gender=${lit(l.genero)} AND category_raw=${lit(l.categoriaRaw)} AND format='INDIVIDUAL'`;
  const condicion = cerrada ? mismaLista : `${mismaLista} AND published_on=${lit(l.publicadoEl)}`;
  const cabecera = [id, l.fuente, l.temporada, l.arma, l.genero, l.categoria, l.categoriaRaw, 'INDIVIDUAL',
    l.publicadoEl, l.baseFecha, 1, l.url, l.total] as const;
  const sentencias = [
    `INSERT INTO sport_ranking_publication(id,source,season,weapon,gender,category,category_raw,format,published_on,date_basis,revision,source_url,published_total) ` +
      `SELECT ${cabecera.map(lit).join(',')} WHERE NOT EXISTS (SELECT 1 FROM sport_ranking_publication WHERE ${condicion})`,
  ];
  let cargo = cargoFila([...cabecera, Date.now()]);
  for (let i = 0; i < filas.length; i += FILAS_POR_INSERT) {
    const valores = filas.slice(i, i + FILAS_POR_INSERT).map((f) => {
      const fila = [uuidDeClave(`sport_ranking_entry|${id}|${f.ref}`), id, f.ref, f.personId, f.nombre, f.pais, f.puesto, f.puntos] as const;
      cargo += cargoFila(fila);
      return `(${fila.map(lit).join(',')})`;
    });
    sentencias.push(
      `INSERT INTO sport_ranking_entry(id,publication_id,source_ref,person_id,source_name,country_code,position,points) ` +
        `SELECT * FROM (VALUES ${valores.join(',')}) WHERE EXISTS (SELECT 1 FROM sport_ranking_publication WHERE id=${lit(id)}) ` +
        `ON CONFLICT(publication_id,source_ref) DO NOTHING`,
    );
  }
  return { sentencias, cargo, id };
}
