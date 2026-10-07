import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { aTiradoresSugeridos } from './perfil-modelo';
import { leerCabeceras, resolverPersona } from './personas';
import { leerRankingEuropeo } from './ranking-ambitos';
import { leerRelevosPerfilDe, type RelevosPerfil } from './relevos';
import type { BloqueRankingInternacional } from './ranking-internacional';
import { leerRendimientoDe, type Rendimiento } from './rendimiento';
import { leerRivalesPorAmbitoDe, type RivalesPorAmbito } from './rivales-ambito';
import { leerEstadisticasRivalesDe } from './rivales-stats';
import { sqlTiradoresSugeridos } from './sugeridos';
import type { TiradorSugerido } from './tipos-perfil';
import type { EstadisticasRivales } from './tipos-social';

/**
 * Lecturas de la ficha que no hacen falta para la cabecera: el rendimiento,
 * todo lo de rivales, el ranking europeo y los relevos. En el perfil por
 * secciones cada sección pide sólo lo suyo al abrirse (`cargar…Perfil`);
 * `cargarDiferidosPerfil` las empieza todas a la vez para quien pinta la
 * ficha entera. Ninguna promesa se rechaza: un fallo es `null`.
 */

export type RivalesDiferidos = {
  /** `null` = no se pudo leer. */
  enfrentados: RivalesPorAmbito | null;
  stats: EstadisticasRivales | null;
  sugeridos: TiradorSugerido[] | null;
};

export type DiferidosPerfil = {
  rendimiento: Promise<Rendimiento | null>;
  rivales: Promise<RivalesDiferidos>;
  /**
   * Ranking europeo (EFC) de la pestaña Ranking; la cabecera no lo usa. Si
   * la pestaña sale lo decide `RankingAmbitos.europeo`, en el camino crítico.
   */
  europeo: Promise<BloqueRankingInternacional | null>;
  /** Relevos de pruebas por equipos, al final de la pestaña Rivales; `null` si no hay o no se pudieron leer. */
  relevos: Promise<RelevosPerfil | null>;
};

/** Sección Rivales: el nombre para el comparador, los más enfrentados y los sugeridos. */
export type RivalesSeccion = {
  /** Nombre publicado de la persona; `null` si no existe o no se pudo leer. */
  nombre: string | null;
  enfrentados: RivalesPorAmbito | null;
  sugeridos: TiradorSugerido[] | null;
};

const RIVALES_VACIOS: RivalesDiferidos = { enfrentados: null, stats: null, sugeridos: null };

type Persona = NonNullable<Awaited<ReturnType<typeof resolverPersona>>>;

/** Sesión, identificador y fusiones; cualquier fallo es `null`, nunca un rechazo. */
function personaDe(ctx: ContextoExplorador, personaId: string): Promise<Persona | null> {
  return (async () => {
    await exigirPerfil(ctx);
    if (!UUID_RE.test(personaId) || !(await ctx.esquema()).identidad) return null;
    return resolverPersona(ctx.db, personaId);
  })().catch(() => null);
}

function sugeridosDe(ctx: ContextoExplorador, p: Persona): Promise<TiradorSugerido[] | null> {
  return ctx.db.execute(sqlTiradoresSugeridos(p.ids, p.canonicaId))
    .then((r) => aTiradoresSugeridos(filas(r)))
    .catch(() => null);
}

export async function cargarRendimientoPerfil(ctx: ContextoExplorador, personaId: string): Promise<Rendimiento | null> {
  const p = await personaDe(ctx, personaId);
  return p ? leerRendimientoDe(ctx.db, p.ids).catch(() => null) : null;
}

export async function cargarRivalesPerfil(ctx: ContextoExplorador, personaId: string): Promise<RivalesSeccion> {
  const p = await personaDe(ctx, personaId);
  if (!p) return { nombre: null, enfrentados: null, sugeridos: null };
  try {
    const [cabeceras, enfrentados, sugeridos] = await Promise.all([
      leerCabeceras(ctx.db, [p.canonicaId], { sinFiltrar: true }).catch(() => null),
      leerRivalesPorAmbitoDe(ctx.db, p.ids, p.canonicaId),
      sugeridosDe(ctx, p),
    ]);
    return { nombre: cabeceras?.get(p.canonicaId)?.nombre ?? null, enfrentados, sugeridos };
  } catch {
    return { nombre: null, enfrentados: null, sugeridos: null };
  }
}

/** Curiosidades y balance por fase: una sola lectura de los asaltos contra cada rival. */
export async function cargarCuriosidadesPerfil(ctx: ContextoExplorador, personaId: string): Promise<EstadisticasRivales | null> {
  const p = await personaDe(ctx, personaId);
  return p ? leerEstadisticasRivalesDe(ctx.db, p.ids, p.canonicaId).catch(() => null) : null;
}

export async function cargarEuropeoPerfil(ctx: ContextoExplorador, personaId: string): Promise<BloqueRankingInternacional | null> {
  const p = await personaDe(ctx, personaId);
  return p ? leerRankingEuropeo(ctx.db, p.ids).catch(() => null) : null;
}

export async function cargarRelevosPerfil(ctx: ContextoExplorador, personaId: string): Promise<RelevosPerfil | null> {
  const p = await personaDe(ctx, personaId);
  return p ? leerRelevosPerfilDe(ctx.db, p.ids).catch(() => null) : null;
}

export function cargarDiferidosPerfil(ctx: ContextoExplorador, personaId: string): DiferidosPerfil {
  const persona = personaDe(ctx, personaId);

  const rendimiento = persona
    .then((p) => (p ? leerRendimientoDe(ctx.db, p.ids) : null))
    .catch(() => null);

  const rivales = persona
    .then(async (p): Promise<RivalesDiferidos> => {
      if (!p) return RIVALES_VACIOS;
      const [enfrentados, stats, sugeridos] = await Promise.all([
        leerRivalesPorAmbitoDe(ctx.db, p.ids, p.canonicaId),
        leerEstadisticasRivalesDe(ctx.db, p.ids, p.canonicaId),
        sugeridosDe(ctx, p),
      ]);
      return { enfrentados, stats, sugeridos };
    })
    .catch(() => RIVALES_VACIOS);

  const europeo = persona
    .then((p) => (p ? leerRankingEuropeo(ctx.db, p.ids) : null))
    .catch(() => null);

  const relevos = persona
    .then((p) => (p ? leerRelevosPerfilDe(ctx.db, p.ids) : null))
    .catch(() => null);

  return { rendimiento, rivales, europeo, relevos };
}
