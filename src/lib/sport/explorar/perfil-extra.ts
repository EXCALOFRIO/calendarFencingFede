import { sql } from 'drizzle-orm';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { vetarEnlaceFie } from './anio-publico';
import { UUID_RE } from './cursor';
import { listaUuid } from './filtros-sql';
import { resolverPersona } from './personas';
import {
  leerRankingMundial,
  leerRankingNacional,
  leerResumenMundial,
  type RankingNacional,
  type ResumenMundial,
} from './ranking-nacional';
import type { EntradaRankingOficial } from './tipos';
import { leerOlimpicaPerfil, type OlimpicaPerfil } from './olimpica-perfil';
import { leerRankingAmbitos, type RankingAmbitos } from './ranking-ambitos';
import { leerRendimientoDe, type Rendimiento } from './rendimiento';

/**
 * Lo que la ficha añade a la lectura base: los datos personales derivados de
 * `perfil_deportista` y las series de rendimiento. Cada parte es opcional y su
 * fallo sólo la omite: la ficha nunca se cae por ellas.
 */

export type DatosPersonales = {
  /** «Carlos Llavador Fernández»; `null` si no añade nada al nombre de siempre. */
  nombreCompleto: string | null;
  edad: number | null;
  mano: 'L' | 'R' | null;
  alturaCm: number | null;
  /**
   * La persona puede ser menor (o ningún año del grupo es conocido): no se
   * enseña su edad por ninguna vía, salvo en su propia ficha.
   */
  edadVetada?: true;
  /** Nombre legible del club; si sólo hay código, va en `codigo`. */
  club: { nombre: string | null; codigo: string | null } | null;
};

export type ExtrasPerfil = {
  datos: DatosPersonales | null;
  rendimiento: Rendimiento | null;
  /** Ranking nacional RFEE por temporada; ausente si no se pudo leer. */
  rankingNacional?: RankingNacional;
  /** Puestos en el ranking mundial de su última temporada FIE. */
  rankingMundial?: EntradaRankingOficial[];
  /** Mejores puestos FIE de su carrera y la última temporada FIE publicada. */
  resumenMundial?: ResumenMundial;
  /** FIE con histórico y, para extranjeros, su federación (ver `leerRankingAmbitos`). */
  rankingAmbitos?: RankingAmbitos;
  /** Pruebas olímpicas en las que está en zona de clasificación. */
  olimpica?: OlimpicaPerfil[];
};

export const EXTRAS_VACIOS: ExtrasPerfil = { datos: null, rendimiento: null };

export type FilaPerfilDeportista = {
  nombreCompleto: string | null;
  anio: number | null;
  mano: string | null;
  altura: number | null;
  clubNombre: string | null;
  clubCodigo: string | null;
};

const limpio = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

/**
 * Edad por año (sin fecha exacta): la que cumple o ya cumplió este año. Sale
 * `null` si la persona puede ser menor o no hay ningún año conocido, con el
 * mismo veto que la foto y el enlace FIE (`vetarEnlaceFie`) sobre el año de
 * esta fila y los de todo el grupo de identidad (`aniosGrupo`). La ficha
 * propia recupera su edad aparte, por `FichaDeportiva.anioNacimiento`.
 */
export function aDatosPersonales(
  f: FilaPerfilDeportista | undefined,
  hoy: string,
  aniosGrupo: readonly (number | null)[] = [],
): DatosPersonales | null {
  if (!f) return null;
  const anioActual = Number(hoy.slice(0, 4));
  const anio = f.anio === null ? null : Number(f.anio);
  const vetada = vetarEnlaceFie([anio, ...aniosGrupo.map((a) => (a === null ? null : Number(a)))], hoy);
  const edad = !vetada && anio !== null && Number.isInteger(anio) && anio > 1900 && anio <= anioActual ? anioActual - anio : null;
  const altura = f.altura === null ? null : Number(f.altura);
  const nombre = limpio(f.clubNombre);
  const codigo = limpio(f.clubCodigo);
  const datos: DatosPersonales = {
    nombreCompleto: limpio(f.nombreCompleto),
    edad,
    mano: f.mano === 'L' || f.mano === 'R' ? f.mano : null,
    alturaCm: altura !== null && Number.isInteger(altura) && altura > 0 ? altura : null,
    club: nombre || codigo ? { nombre, codigo: nombre ? null : codigo } : null,
    ...(vetada ? { edadVetada: true as const } : {}),
  };
  // Una fila vetada por un año de menor se devuelve aunque no traiga nada más: el veto también
  // manda sobre el año de la ficha. Sin ningún año conocido, la ficha tampoco tiene uno que enseñar.
  const porMenor = vetada && [anio, ...aniosGrupo].some((a) => a !== null);
  const vacio = !porMenor && !datos.nombreCompleto && datos.edad === null && !datos.mano && datos.alturaCm === null && !datos.club;
  return vacio ? null : datos;
}

/**
 * Fila de `perfil_deportista` de la persona superviviente. La tabla puede no
 * existir todavía en la base: cualquier fallo devuelve `null`.
 */
export async function leerDatosPersonales(
  db: ContextoExplorador['db'],
  canonicaId: string,
  hoy: string,
  ids: readonly string[] = [canonicaId],
): Promise<DatosPersonales | null> {
  try {
    const [[fila], anios] = await Promise.all([
      db.execute(sql`
        SELECT full_name AS "nombreCompleto", birth_year AS anio, hand AS mano, height_cm AS altura,
               club_name AS "clubNombre", club_code AS "clubCodigo"
        FROM perfil_deportista WHERE person_id = ${canonicaId} LIMIT 1`).then((r) => filas<FilaPerfilDeportista>(r)),
      db.execute(sql`SELECT birth_year AS anio FROM sport_person WHERE id IN (${listaUuid(ids)})`)
        .then((r) => filas<{ anio: number | null }>(r).map((a) => a.anio)),
    ]);
    return aDatosPersonales(fila, hoy, anios);
  } catch {
    return null;
  }
}

/** Datos personales y rendimiento de una persona; con sesión, pero sin fallar nunca por ellos. */
export async function cargarExtrasPerfil(
  ctx: ContextoExplorador,
  personaId: string,
  /** Sin rendimiento cuando la página lo pide aparte (`cargarDiferidosPerfil`). */
  { conRendimiento = true }: { conRendimiento?: boolean } = {},
): Promise<ExtrasPerfil> {
  try {
    await exigirPerfil(ctx);
    if (!UUID_RE.test(personaId)) return EXTRAS_VACIOS;
    if (!(await ctx.esquema()).identidad) return EXTRAS_VACIOS;
    const persona = await resolverPersona(ctx.db, personaId);
    if (!persona) return EXTRAS_VACIOS;
    const resumen = leerResumenMundial(ctx.db, persona.ids);
    const [datos, rendimiento, rankingNacional, rankingMundial, resumenMundial, rankingAmbitos, olimpica] = await Promise.all([
      leerDatosPersonales(ctx.db, persona.canonicaId, ctx.hoy(), persona.ids),
      conRendimiento ? leerRendimientoDe(ctx.db, persona.ids) : null,
      leerRankingNacional(ctx.db, persona.ids),
      leerRankingMundial(ctx.db, persona.ids),
      resumen,
      leerRankingAmbitos(ctx.db, persona.ids, persona.canonicaId),
      resumen.then((r) => leerOlimpicaPerfil(r.actuales)).catch(() => []),
    ]);
    return { datos, rendimiento, rankingNacional, rankingMundial, resumenMundial, rankingAmbitos, olimpica };
  } catch {
    return EXTRAS_VACIOS;
  }
}
