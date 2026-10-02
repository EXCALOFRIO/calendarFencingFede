import {
  inventariarFie,
  inventariarSkermo,
  type DepsInventarioFie,
  type DepsInventarioSkermo,
  type FalloTecnicoInventario,
  type FederacionSkermo,
  type FilaCatalogo,
  type UnidadInventario,
} from '../sources/historico-indice';
import {
  cargarProgresoIndice,
  persistirUnidadDescubierta,
  type DepsPersistenciaDescubrimiento,
} from './descubrimiento-persist';
import { unidadesDesdeCatalogo } from './inventario-unidades';
import { clasificarFalloTecnico } from './orquestador';

/**
 * Descubrimiento del catálogo para el backfill: recorre los índices públicos de
 * la FIE y de Skermo con un tope de peticiones y devuelve las filas del
 * catálogo. Lo que el tope deja sin leer se cuenta como pendiente, no se da por
 * vacío.
 *
 * Con `persistencia` el progreso es durable: antes de pasar a la siguiente
 * temporada se guardan sus pruebas descubiertas (cobertura pendiente) y el
 * checkpoint del índice, y la ejecución siguiente retoma desde ahí en vez de
 * releer el mismo prefijo. Un fallo técnico (429, 5xx, red) detiene la
 * enumeración y sube con su `Retry-After`.
 */

export type DepsDescubrimiento = {
  fie: DepsInventarioFie;
  skermo: DepsInventarioSkermo;
  federaciones: () => FederacionSkermo[];
  persistencia?: DepsPersistenciaDescubrimiento;
};

export type ResultadoDescubrimiento = {
  catalogo: FilaCatalogo[];
  peticiones: number;
  /** Unidades de índice (temporada o federación) que no se llegaron a leer o fallaron. */
  pendientes: number;
  errores: string[];
  /** La enumeración se cortó por un fallo técnico: el progreso ya está guardado y hay que esperar antes de insistir. */
  tecnico?: FalloTecnicoInventario;
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
  const anotar = (r: {
    catalogo: FilaCatalogo[];
    peticiones: number;
    pendientes: { error: string | null }[];
    tecnico?: FalloTecnicoInventario;
  }) => {
    resultado.catalogo.push(...r.catalogo);
    resultado.peticiones += r.peticiones;
    resultado.pendientes += r.pendientes.length;
    for (const p of r.pendientes) if (p.error) resultado.errores.push(p.error);
    restantes = Math.max(0, restantes - r.peticiones);
    if (r.tecnico) resultado.tecnico = r.tecnico;
  };

  const previas: UnidadInventario[] = deps.persistencia ? await cargarProgresoIndice(deps.persistencia) : [];
  const persistencia = deps.persistencia;
  const comunes = {
    previas,
    clasificarFallo: clasificarFalloTecnico,
    alUnidad: persistencia
      ? (unidad: UnidadInventario, filas: readonly FilaCatalogo[]) =>
          // Un índice guardado como completo ha de dejar sembradas todas sus salidas: el filtro de fuentes
          // sólo decide qué se ejecuta, y una pasada posterior no vuelve a leer el índice para recuperarlas.
          persistirUnidadDescubierta(persistencia, unidad, unidadesDesdeCatalogo(filas))
      : undefined,
  };

  if (quiere('fie') && restantes > 0) {
    const anios = (filtro.temporadas ?? []).filter((t) => ANIO_FIE.test(t)).map(Number);
    // Pedir sólo temporadas de Skermo no debe gastar peticiones en la FIE.
    if (!filtro.temporadas?.length || anios.length > 0) {
      anotar(
        await inventariarFie(deps.fie, {
          ...comunes,
          maxPeticiones: restantes,
          temporadas: anios.length ? anios : undefined,
        }),
      );
    }
  }

  // Los PDF de resultados salen de los índices Skermo: pedir sólo `rfee_pdf` necesita esos índices padres.
  const quierePdf = quiere('rfee_pdf');
  const quiereSkermo = quiere('skermo_rfee') || quiere('skermo_regional') || quierePdf;
  // Tras un fallo técnico no se sigue enumerando: insistir contra la fuente que acaba de limitar sólo agrava el límite.
  if (quiereSkermo && restantes > 0 && !resultado.tecnico) {
    const etiquetas = (filtro.temporadas ?? []).filter((t) => !ANIO_FIE.test(t));
    if (!filtro.temporadas?.length || etiquetas.length > 0) {
      const federaciones = deps.federaciones().filter(
        (f) => quierePdf || (f.codigo === 'RFEE' ? quiere('skermo_rfee') : quiere('skermo_regional')),
      );
      anotar(
        await inventariarSkermo(deps.skermo, federaciones, {
          ...comunes,
          maxPeticiones: restantes,
          temporadas: etiquetas.length ? etiquetas : undefined,
        }),
      );
    }
  }
  return resultado;
}
