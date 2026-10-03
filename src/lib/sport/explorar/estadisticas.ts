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

/** Barras de volumen, no curva de puestos entre categorías incomparables. */
export function segmentosCronologia(r: ResumenEstadistico, maximo: number) {
  const escala = maximo > 0 ? 240 / maximo : 0;
  return {
    conPuesto: Number((r.conPuesto * escala).toFixed(2)),
    sinPuesto: Number((r.sinPuesto * escala).toFixed(2)),
  };
}
