import { and, eq, gte, inArray, lte, notInArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { sportBout, sportCompetition, sportEdition, sportImportCoverage, sportResult } from '@/db/schema';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import type { DepsAsaltosComplemento, DepsComplemento } from './complementarios-persist';
import {
  estadoAsaltosPrimarios,
  type EstadoAsaltosPrimarios,
  type PruebaCanonica,
  type ResultadosPrimarios,
} from './conciliar-complementario';
import { escribirAsaltos, escribirCobertura, escribirResultados } from './fie-resultados-db';
import { clasificarSerie } from './series-complementarias';

/** Fuentes complementarias: nunca cuentan como «primarias» de una prueba. */
export const FUENTES_COMPLEMENTARIAS = ['engarde', 'fww'] as const;

export function crearDepsComplementoDb(db: Db): DepsComplemento & DepsAsaltosComplemento {
  return {
    esquema: esquemaDeportivo,
    upsertResultados: (competitionId, source, filas) => escribirResultados(db, source, competitionId, filas),
    upsertAsaltos: (competitionId, source, filas) => escribirAsaltos(db, source, competitionId, filas),
    upsertCobertura: (source, fila) => escribirCobertura(db, source, fila),
  };
}

export type CanonicaCargada = {
  competitionId: string;
  prueba: PruebaCanonica;
  primarios: ResultadosPrimarios;
  primariosAsaltos: { poules: EstadoAsaltosPrimarios; cuadro: EstadoAsaltosPrimarios };
};

/** Una prueba canónica concreta y lo que sus fuentes primarias ya guardaron; `null` si no existe o es complementaria. */
export async function cargarCanonicaPorIdDb(db: Db, competitionId: string): Promise<CanonicaCargada | null> {
  const [p] = await db
    .select({ fecha: sportCompetition.competitionDate, source: sportCompetition.source })
    .from(sportCompetition)
    .where(eq(sportCompetition.id, competitionId))
    .limit(1);
  if (!p?.fecha || (FUENTES_COMPLEMENTARIAS as readonly string[]).includes(p.source)) return null;
  const candidatas = await cargarCanonicasDb(db, { desde: p.fecha, hasta: p.fecha });
  return candidatas.find((c) => c.competitionId === competitionId) ?? null;
}

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

  const [filas, coberturas, asaltos] = await Promise.all([
    db
      .select({
        competitionId: sportResult.competitionId,
        source: sportResult.source,
        posicion: sportResult.position,
        pais: sportResult.sourceCountryCode,
        nombre: sportResult.sourceName,
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
        publishedTotal: sportImportCoverage.publishedTotal,
        cursor: sportImportCoverage.cursor,
      })
      .from(sportImportCoverage)
      .where(
        and(
          inArray(sportImportCoverage.competitionId, ids),
          inArray(sportImportCoverage.factKind, ['ranking', 'results', 'pools', 'tableau']),
          notInArray(sportImportCoverage.source, [...FUENTES_COMPLEMENTARIAS]),
        ),
      ),
    db
      .select({
        competitionId: sportBout.competitionId,
        fase: sportBout.phase,
        n: sql<number>`count(*)::int`,
      })
      .from(sportBout)
      .where(and(inArray(sportBout.competitionId, ids), notInArray(sportBout.source, [...FUENTES_COMPLEMENTARIAS])))
      .groupBy(sportBout.competitionId, sportBout.phase),
  ]);

  return pruebas.map((p) => {
    const suyas = filas.filter((f) => f.competitionId === p.id);
    const suyasCob = coberturas.filter((c) => c.competitionId === p.id);
    const estados = suyasCob.filter((c) => c.factKind === 'ranking' || c.factKind === 'results').map((c) => c.status);
    const asaltosDe = (fase: string, factKind: string) =>
      estadoAsaltosPrimarios(
        asaltos.filter((a) => a.competitionId === p.id && a.fase === fase).reduce((s, a) => s + a.n, 0),
        suyasCob.filter((c) => c.factKind === factKind),
      );
    let primarios: ResultadosPrimarios;
    if (suyas.length > 0) {
      primarios = {
        estado: 'publicados',
        completo: estados.includes('completo') && !estados.includes('parcial'),
        puestos: suyas.map((f) => ({ posicion: f.posicion, pais: f.pais, nombre: f.nombre })),
      };
    } else if (estados.includes('sin_resultados')) primarios = { estado: 'sin_resultados' };
    else if (estados.includes('error')) primarios = { estado: 'error' };
    else primarios = { estado: 'pendiente' };

    return {
      competitionId: p.id,
      primarios,
      primariosAsaltos: { poules: asaltosDe('POULE', 'pools'), cuadro: asaltosDe('TABLEAU', 'tableau') },
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
