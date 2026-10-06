import { LIMITE_CATEGORIAS_ESTADISTICAS, LIMITE_TEMPORADAS_ESTADISTICAS } from './estadisticas-sql';
import { ordenTipo } from './estadisticas-tipo';
import type { Arma, EstadisticasDeportista, Genero, ResumenEstadistico } from './tipos';

export type FilaAgregadoEstadistico = {
  clase: 'total' | 'tipo' | 'categoria' | 'temporada';
  tipo: string | null;
  categoria: string | null;
  categoriaRaw: string | null;
  arma: Arma | null;
  genero: Genero | null;
  temporada: string | null;
  pruebas: number;
  clasificaciones: number;
  mejorPuesto: number | null;
  podios: number;
  victorias: number;
  /** Puestos 2, 3 y 1 a 8; opcionales para filas construidas antes de existir. */
  platas?: number;
  bronces?: number;
  finales?: number;
  sinPuesto: number;
  conflictos: number;
  sinFecha: number;
  desde: string | null;
  hasta: string | null;
};

function resumen(r?: FilaAgregadoEstadistico): ResumenEstadistico {
  return {
    pruebas: Number(r?.pruebas ?? 0),
    conPuesto: Number(r?.clasificaciones ?? 0),
    sinPuesto: Number(r?.sinPuesto ?? 0),
    mejorPuesto: r?.mejorPuesto == null ? null : Number(r.mejorPuesto),
    podios: Number(r?.podios ?? 0),
    victorias: Number(r?.victorias ?? 0),
    conflictos: Number(r?.conflictos ?? 0),
    sinFecha: Number(r?.sinFecha ?? 0),
    desde: r?.desde ?? null,
    hasta: r?.hasta ?? null,
  };
}

export function aDetalleEstadistico(rows: readonly FilaAgregadoEstadistico[]): EstadisticasDeportista {
  const categorias = rows.filter((r) => r.clase === 'categoria');
  const temporadas = rows.filter((r) => r.clase === 'temporada');
  return {
    resumen: resumen(rows.find((r) => r.clase === 'total')),
    porCategoria: categorias.slice(0, LIMITE_CATEGORIAS_ESTADISTICAS)
      .filter((r) => r.categoria !== null && r.arma !== null && r.genero !== null)
      .map((r) => ({
        ...resumen(r), tipo: r.tipo,
        categoria: { codigo: r.categoria!, raw: r.categoriaRaw },
        arma: r.arma!, genero: r.genero!,
      }))
      .sort((a, b) => ordenTipo(a.tipo) - ordenTipo(b.tipo) ||
        (a.tipo ?? '').localeCompare(b.tipo ?? '') ||
        a.categoria.codigo.localeCompare(b.categoria.codigo) ||
        (a.categoria.raw ?? '').localeCompare(b.categoria.raw ?? '') ||
        a.arma.localeCompare(b.arma) || a.genero.localeCompare(b.genero)),
    porTemporada: temporadas.slice(0, LIMITE_TEMPORADAS_ESTADISTICAS)
      .filter((r) => r.temporada !== null)
      .map((r) => ({ ...resumen(r), temporada: r.temporada! }))
      .sort((a, b) => a.temporada.localeCompare(b.temporada)),
    categoriasRecortadas: categorias.length > LIMITE_CATEGORIAS_ESTADISTICAS,
    temporadasRecortadas: temporadas.length > LIMITE_TEMPORADAS_ESTADISTICAS,
    alcance: 'historial_individual_importado',
  };
}

export type EjeDesglose = 'tipo' | 'categoria' | 'arma';

export type GrupoDesglose = ResumenEstadistico & {
  clave: string;
  tipo: string | null;
  categoria: { codigo: string; raw: string | null } | null;
  arma: Arma | null;
};

/**
 * Suma los grupos finos (tipo × categoría × arma × género) por un solo eje.
 * Cada prueba pertenece a un único grupo fino, así que la suma no duplica; el
 * mejor puesto es el mínimo de los grupos y sigue siendo `null` si ninguno lo tiene.
 */
export function agruparDesglose(
  detalle: EstadisticasDeportista,
  eje: EjeDesglose,
): GrupoDesglose[] {
  const grupos = new Map<string, GrupoDesglose>();
  for (const c of detalle.porCategoria) {
    // La categoría se agrupa por su código: «S», «SENIOR» y «ABS» son la misma.
    const clave = eje === 'tipo' ? `t:${c.tipo ?? ''}` : eje === 'categoria' ? `c:${c.categoria.codigo}` : `a:${c.arma}`;
    const previo = grupos.get(clave);
    if (!previo) {
      grupos.set(clave, {
        pruebas: c.pruebas, conPuesto: c.conPuesto, sinPuesto: c.sinPuesto, podios: c.podios,
        victorias: c.victorias, mejorPuesto: c.mejorPuesto, conflictos: c.conflictos,
        sinFecha: c.sinFecha, desde: c.desde, hasta: c.hasta,
        clave,
        tipo: eje === 'tipo' ? c.tipo : null,
        categoria: eje === 'categoria' ? { codigo: c.categoria.codigo, raw: null } : null,
        arma: eje === 'arma' ? c.arma : null,
      });
      continue;
    }
    previo.pruebas += c.pruebas;
    previo.conPuesto += c.conPuesto;
    previo.sinPuesto += c.sinPuesto;
    previo.podios += c.podios;
    previo.victorias += c.victorias;
    previo.conflictos += c.conflictos;
    previo.sinFecha += c.sinFecha;
    previo.mejorPuesto = previo.mejorPuesto === null ? c.mejorPuesto
      : c.mejorPuesto === null ? previo.mejorPuesto : Math.min(previo.mejorPuesto, c.mejorPuesto);
    previo.desde = [previo.desde, c.desde].filter(Boolean).sort()[0] ?? null;
    previo.hasta = [previo.hasta, c.hasta].filter(Boolean).sort().at(-1) ?? null;
  }
  return [...grupos.values()].sort((a, b) => b.pruebas - a.pruebas || a.clave.localeCompare(b.clave));
}

/** Barras de volumen, no curva de puestos entre categorías incomparables. */
export function segmentosCronologia(r: ResumenEstadistico, maximo: number) {
  const escala = maximo > 0 ? 240 / maximo : 0;
  return {
    conPuesto: Number((r.conPuesto * escala).toFixed(2)),
    sinPuesto: Number((r.sinPuesto * escala).toFixed(2)),
  };
}
