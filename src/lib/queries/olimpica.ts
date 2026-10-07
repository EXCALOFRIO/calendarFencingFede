import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { cache } from 'react';
import { db } from '@/db';
import { fieClasificacion as fieClasificacionTable } from '@/db/schema';
import { enLista as inArray } from '@/lib/sqlite';
import {
  anotarRankingOlimpico,
  calcularClasificacionesOlimpicas,
  type AnotacionesPrueba,
  type ArmaOlimpica,
  type EntradaPrueba,
  type FilaEquipoFie,
  type FilaIndividualFie,
  type GeneroOlimpico,
  type ResultadoPrueba,
} from '@/lib/ranking/olimpica';

/**
 * Lo que necesita el motor olímpico: los rankings FIE sénior (individual y
 * por selecciones) de las seis pruebas olímpicas, cada una de la temporada más
 * reciente que tenga los dos (ver `elegirTemporadasOlimpicas`).
 *
 * Se recalcula en cada lectura a partir de `fie_clasificacion`, así que la
 * proyección cambia sola cuando la ingestión FIE trae un ranking nuevo.
 *
 * Fecha del ranking de cada prueba: la lectura MÁS VIEJA de sus dos grupos
 * (individual y selecciones) en `fie_clasificacion_lectura`, porque la
 * proyección usa los dos. Si esa tabla aún no existe (migración 0009 sin
 * aplicar) o no tiene el grupo, se usa el último `updated_at` de sus filas, que
 * es la fecha del último cambio y no la de lectura.
 */

const ARMAS: readonly ArmaOlimpica[] = ['FLORETE', 'ESPADA', 'SABLE'];
const GENEROS: readonly GeneroOlimpico[] = ['M', 'F'];
const CATEGORIA_SENIOR = 'S';

const clavePrueba = (arma: string, genero: string) => `${arma}|${genero}`;

/** `temporada|arma|género` → lectura más vieja de sus grupos (ms), si están los dos. */
async function leerFechasLectura(seasons: readonly number[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (seasons.length === 0) return out;
  try {
    const { rows } = await db.execute<{
      season: number;
      weapon: string;
      gender: string;
      grupos: number;
      leido: number;
    }>(sql`
      select season, weapon, gender, count(*) as grupos, min(read_at) as leido
      from fie_clasificacion_lectura
      where season in (select value from json_each(${JSON.stringify(seasons)}))
        and category_raw = ${CATEGORIA_SENIOR}
      group by season, weapon, gender`);
    for (const r of rows) {
      if (Number(r.grupos) >= 2) {
        out.set(`${Number(r.season)}|${clavePrueba(r.weapon, r.gender)}`, Number(r.leido));
      }
    }
  } catch {
    // Sin la tabla de lecturas se cae a `updated_at`.
  }
  return out;
}

/**
 * La temporada de cada prueba: la más reciente con los DOS formatos. En el
 * cambio de temporada la FIE puede publicar el individual antes que el de
 * selecciones (o fallar su lectura); calcular sin equipos haría entrar a todos
 * los CON por la vía individual. Sin ninguna temporada completa, la prueba
 * queda pendiente.
 */
export function elegirTemporadasOlimpicas(
  filas: readonly { season: number; weapon: string; gender: string; format: string }[],
): Map<string, number> {
  const formatos = new Map<string, Set<string>>();
  for (const f of filas) {
    const k = `${Number(f.season)}|${clavePrueba(f.weapon, f.gender)}`;
    const s = formatos.get(k) ?? new Set<string>();
    s.add(f.format === 'EQUIPOS' ? 'EQUIPOS' : 'INDIVIDUAL');
    formatos.set(k, s);
  }
  const out = new Map<string, number>();
  for (const [k, s] of formatos) {
    if (s.size < 2) continue;
    const corte = k.indexOf('|');
    const season = Number(k.slice(0, corte));
    const prueba = k.slice(corte + 1);
    if (season > (out.get(prueba) ?? -Infinity)) out.set(prueba, season);
  }
  return out;
}

export type PruebaPendiente = { arma: ArmaOlimpica; genero: GeneroOlimpico };

export async function getEntradasOlimpicas(
  filtro: { arma?: ArmaOlimpica; genero?: GeneroOlimpico } = {},
): Promise<{ season: number | null; entradas: EntradaPrueba[]; pendientes: PruebaPendiente[] }> {
  const armas = filtro.arma ? [filtro.arma] : ARMAS;
  const generos = filtro.genero ? [filtro.genero] : GENEROS;

  const disponibles = await db
    .selectDistinct({
      season: fieClasificacionTable.season,
      weapon: fieClasificacionTable.weapon,
      gender: fieClasificacionTable.gender,
      format: fieClasificacionTable.format,
    })
    .from(fieClasificacionTable)
    .where(
      and(
        eq(fieClasificacionTable.category, 'ABS'),
        inArray(fieClasificacionTable.weapon, [...armas]),
        inArray(fieClasificacionTable.gender, [...generos]),
        isNotNull(fieClasificacionTable.position),
      ),
    );
  const temporadas = elegirTemporadasOlimpicas(disponibles);
  const pendientes: PruebaPendiente[] = [];
  for (const arma of armas) {
    for (const genero of generos) {
      if (!temporadas.has(clavePrueba(arma, genero))) pendientes.push({ arma, genero });
    }
  }
  const seasonsUsadas = [...new Set(temporadas.values())];
  if (seasonsUsadas.length === 0) return { season: null, entradas: [], pendientes };
  const season = Math.max(...seasonsUsadas);

  const [filasTodas, lecturas] = await Promise.all([
    db
      .select({
        season: fieClasificacionTable.season,
        format: fieClasificacionTable.format,
        weapon: fieClasificacionTable.weapon,
        gender: fieClasificacionTable.gender,
        fieId: fieClasificacionTable.fieId,
        position: fieClasificacionTable.position,
        points: fieClasificacionTable.points,
        nombre: fieClasificacionTable.sourceName,
        pais: fieClasificacionTable.countryCode,
        updatedAt: fieClasificacionTable.updatedAt,
      })
      .from(fieClasificacionTable)
      .where(
        and(
          inArray(fieClasificacionTable.season, seasonsUsadas),
          eq(fieClasificacionTable.category, 'ABS'),
          inArray(fieClasificacionTable.weapon, [...armas]),
          inArray(fieClasificacionTable.gender, [...generos]),
          isNotNull(fieClasificacionTable.position),
        ),
      )
      .orderBy(asc(fieClasificacionTable.position)),
    leerFechasLectura(seasonsUsadas),
  ]);
  const filas = filasTodas.filter(
    (f) => temporadas.get(clavePrueba(f.weapon, f.gender)) === Number(f.season),
  );

  type Acumulada = EntradaPrueba & {
    equipos: FilaEquipoFie[];
    individual: FilaIndividualFie[];
    ultima: number;
  };
  const porPrueba = new Map<string, Acumulada>();
  for (const arma of armas) {
    for (const genero of generos) {
      porPrueba.set(clavePrueba(arma, genero), {
        arma,
        genero,
        fechaRanking: null,
        equipos: [],
        individual: [],
        ultima: 0,
      });
    }
  }

  for (const f of filas) {
    const p = porPrueba.get(clavePrueba(f.weapon, f.gender));
    if (!p) continue;
    const puntos = f.points === null ? null : Number(f.points);
    const fila = {
      noc: f.pais,
      posicion: f.position,
      puntos: puntos !== null && Number.isFinite(puntos) ? puntos : null,
    };
    if (f.format === 'EQUIPOS') {
      p.equipos.push(fila);
    } else {
      p.individual.push({ ...fila, fieId: f.fieId, nombre: f.nombre ?? '' });
    }
    const t = f.updatedAt instanceof Date ? f.updatedAt.getTime() : Number(f.updatedAt);
    if (t > p.ultima) p.ultima = t;
  }

  const entradas = [...porPrueba.values()]
    .filter((p) => p.equipos.length > 0 && p.individual.length > 0)
    .map(({ ultima, ...p }) => {
      const clave = clavePrueba(p.arma, p.genero);
      const leido = lecturas.get(`${temporadas.get(clave)}|${clave}`) ?? ultima;
      return { ...p, fechaRanking: leido > 0 ? new Date(leido).toISOString() : null };
    });

  return { season, entradas, pendientes };
}

/**
 * La proyección de las seis pruebas, con el detalle de España. Solo viaja al
 * cliente el resultado, no los miles de filas del ranking individual. Las
 * pruebas sin los dos rankings de una misma temporada van en `pendientes`.
 */
export const getClasificacionOlimpica = cache(
  async (): Promise<{
    season: number | null;
    resultados: ResultadoPrueba[];
    pendientes: PruebaPendiente[];
  }> => {
    const { season, entradas, pendientes } = await getEntradasOlimpicas();
    return {
      season,
      resultados: calcularClasificacionesOlimpicas(entradas, { nocsSeguidos: ['ESP'] }),
      pendientes,
    };
  },
);

/**
 * Cuánto se reutiliza la anotación de una prueba entre peticiones del mismo
 * isolate. Cada lectura son ~700–1.300 filas de `fie_clasificacion` y el
 * ranking FIE cambia como mucho una vez al día; sin esto, Buscar (una
 * petición por tecla) leería hasta seis pruebas cada vez. Una ingestión nueva
 * se ve, como tarde, a los diez minutos.
 */
const MEMORIA_MS = 10 * 60_000;
const memoria = new Map<string, { hasta: number; valor: Promise<AnotacionesPrueba | null> }>();

/** Vacía la memoria entre peticiones (pruebas, arneses con otra base). */
export function olvidarAnotacionesOlimpicas() {
  memoria.clear();
}

async function anotarPrueba(arma: ArmaOlimpica, genero: GeneroOlimpico): Promise<AnotacionesPrueba | null> {
  const { entradas } = await getEntradasOlimpicas({ arma, genero });
  const entrada = entradas[0];
  return entrada ? anotarRankingOlimpico(entrada) : null;
}

/**
 * Las marcas olímpicas de las filas de UNA prueba (arma y género, sénior),
 * para la tabla del ranking internacional, el perfil y Buscar. `null` si no
 * hay datos o la combinación no es olímpica (mixto, categorías que no son
 * sénior).
 */
export const getAnotacionesOlimpicas = cache(
  async (arma: ArmaOlimpica, genero: GeneroOlimpico): Promise<AnotacionesPrueba | null> => {
    if (!ARMAS.includes(arma) || !GENEROS.includes(genero)) return null;
    const clave = clavePrueba(arma, genero);
    const ahora = Date.now();
    const guardada = memoria.get(clave);
    if (guardada && guardada.hasta > ahora) return guardada.valor;
    const valor = anotarPrueba(arma, genero);
    memoria.set(clave, { hasta: ahora + MEMORIA_MS, valor });
    // Un fallo no se guarda: la siguiente petición lo vuelve a intentar.
    valor.catch(() => {
      if (memoria.get(clave)?.valor === valor) memoria.delete(clave);
    });
    return valor;
  },
);
