import {
  inventariarFie,
  inventariarSkermo,
  type DepsInventarioFie,
  type DepsInventarioSkermo,
  type FederacionSkermo,
  type FilaCatalogo,
} from '../sources/historico-indice';

/**
 * Descubrimiento del catálogo para el backfill: recorre los índices públicos de
 * la FIE y de Skermo con un tope de peticiones y devuelve las filas del
 * catálogo. No escribe nada. Lo que el tope deja sin leer se cuenta como
 * pendiente, no se da por vacío.
 */

export type DepsDescubrimiento = {
  fie: DepsInventarioFie;
  skermo: DepsInventarioSkermo;
  federaciones: () => FederacionSkermo[];
};

export type ResultadoDescubrimiento = {
  catalogo: FilaCatalogo[];
  peticiones: number;
  /** Unidades de índice (temporada o federación) que no se llegaron a leer o fallaron. */
  pendientes: number;
  errores: string[];
};

const ANIO_FIE = /^\d{4}$/;

export async function descubrirCatalogo(
  deps: DepsDescubrimiento,
  filtro: { fuentes?: readonly string[]; temporadas?: readonly string[] },
  maxPeticiones: number,
): Promise<ResultadoDescubrimiento> {
  const quiere = (fuente: string) => !filtro.fuentes?.length || filtro.fuentes.includes(fuente);
  const resultado: ResultadoDescubrimiento = { catalogo: [], peticiones: 0, pendientes: 0, errores: [] };
  let restantes = Math.max(0, Math.floor(maxPeticiones));
  const anotar = (r: { catalogo: FilaCatalogo[]; peticiones: number; pendientes: { error: string | null }[] }) => {
    resultado.catalogo.push(...r.catalogo);
    resultado.peticiones += r.peticiones;
    resultado.pendientes += r.pendientes.length;
    for (const p of r.pendientes) if (p.error) resultado.errores.push(p.error);
    restantes = Math.max(0, restantes - r.peticiones);
  };

  if (quiere('fie') && restantes > 0) {
    const anios = (filtro.temporadas ?? []).filter((t) => ANIO_FIE.test(t)).map(Number);
    // Pedir sólo temporadas de Skermo no debe gastar peticiones en la FIE.
    if (!filtro.temporadas?.length || anios.length > 0) {
      anotar(await inventariarFie(deps.fie, { maxPeticiones: restantes, temporadas: anios.length ? anios : undefined }));
    }
  }

  const quiereSkermo = quiere('skermo_rfee') || quiere('skermo_regional');
  if (quiereSkermo && restantes > 0) {
    const etiquetas = (filtro.temporadas ?? []).filter((t) => !ANIO_FIE.test(t));
    if (!filtro.temporadas?.length || etiquetas.length > 0) {
      const federaciones = deps.federaciones().filter((f) =>
        f.codigo === 'RFEE' ? quiere('skermo_rfee') : quiere('skermo_regional'),
      );
      anotar(
        await inventariarSkermo(deps.skermo, federaciones, {
          maxPeticiones: restantes,
          temporadas: etiquetas.length ? etiquetas : undefined,
        }),
      );
    }
  }
  return resultado;
}
