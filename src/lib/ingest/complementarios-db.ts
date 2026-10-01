import { and, eq, gte, inArray, lte, notInArray } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportCompetition, sportEdition, sportImportCoverage, sportResult } from '@/db/schema';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import type { DepsComplemento } from './complementarios-persist';
import type { PruebaCanonica, ResultadosPrimarios } from './conciliar-complementario';
import { escribirCobertura, escribirResultados } from './fie-resultados-db';
import { clasificarSerie } from './series-complementarias';

/** Fuentes complementarias: nunca cuentan como «primarias» de una prueba. */
export const FUENTES_COMPLEMENTARIAS = ['engarde', 'fww'] as const;

export function crearDepsComplementoDb(db: Db): DepsComplemento {
  return {
    esquema: esquemaDeportivo,
    upsertResultados: (competitionId, source, filas) => escribirResultados(db, source, competitionId, filas),
    upsertCobertura: (source, fila) => escribirCobertura(db, source, fila),
  };
}

export type CanonicaCargada = {
  competitionId: string;
  prueba: PruebaCanonica;
  primarios: ResultadosPrimarios;
};

/**
 * Pruebas ya guardadas por fuentes primarias entre dos fechas, con lo que esas
 * fuentes publican. Sólo lectura. Sin cobertura ni filas, la primaria queda
 * `pendiente` y el complemento espera: ausencia de datos no es «no publica».
 */
export async function cargarCanonicasDb(
  db: Db,
  rango: { desde: string; hasta: string },
): Promise<CanonicaCargada[]> {
  const pruebas = await db
    .select({
      id: sportCompetition.id,
      source: sportCompetition.source,
      season: sportCompetition.season,
      clave: sportCompetition.competitionKey,
      arma: sportCompetition.weapon,
      genero: sportCompetition.gender,
      categoria: sportCompetition.category,
      formato: sportCompetition.format,
      fecha: sportCompetition.competitionDate,
      edicion: sportEdition.name,
      ciudad: sportEdition.city,
    })
    .from(sportCompetition)
    .innerJoin(sportEdition, eq(sportEdition.id, sportCompetition.editionId))
    .where(
      and(
        gte(sportCompetition.competitionDate, rango.desde),
        lte(sportCompetition.competitionDate, rango.hasta),
        notInArray(sportCompetition.source, [...FUENTES_COMPLEMENTARIAS]),
      ),
    );
  if (pruebas.length === 0) return [];
  const ids = pruebas.map((p) => p.id);

  const [filas, coberturas] = await Promise.all([
    db
      .select({
        competitionId: sportResult.competitionId,
        source: sportResult.source,
        posicion: sportResult.position,
        pais: sportResult.sourceCountryCode,
      })
      .from(sportResult)
      .where(
        and(
          inArray(sportResult.competitionId, ids),
          notInArray(sportResult.source, [...FUENTES_COMPLEMENTARIAS]),
        ),
      ),
    db
      .select({
        competitionId: sportImportCoverage.competitionId,
        status: sportImportCoverage.status,
        factKind: sportImportCoverage.factKind,
      })
      .from(sportImportCoverage)
      .where(
        and(
          inArray(sportImportCoverage.competitionId, ids),
          inArray(sportImportCoverage.factKind, ['ranking', 'results']),
          notInArray(sportImportCoverage.source, [...FUENTES_COMPLEMENTARIAS]),
        ),
      ),
  ]);

  return pruebas.map((p) => {
    const suyas = filas.filter((f) => f.competitionId === p.id);
    const estados = coberturas.filter((c) => c.competitionId === p.id).map((c) => c.status);
    let primarios: ResultadosPrimarios;
    if (suyas.length > 0) {
      primarios = {
        estado: 'publicados',
        completo: estados.includes('completo') && !estados.includes('parcial'),
        puestos: suyas.map((f) => ({ posicion: f.posicion, pais: f.pais })),
      };
    } else if (estados.includes('sin_resultados')) primarios = { estado: 'sin_resultados' };
    else if (estados.includes('error')) primarios = { estado: 'error' };
    else primarios = { estado: 'pendiente' };

    return {
      competitionId: p.id,
      primarios,
      prueba: {
        fuente: p.source,
        season: p.season,
        clave: p.clave,
        serie: clasificarSerie({ nombre: p.edicion }),
        nombreEdicion: p.edicion,
        ciudad: p.ciudad,
        fecha: p.fecha,
        arma: p.arma,
        genero: p.genero,
        categoria: p.categoria,
        formato: p.formato,
      },
    };
  });
}
