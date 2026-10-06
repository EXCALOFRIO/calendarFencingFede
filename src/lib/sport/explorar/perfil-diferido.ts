import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { aTiradoresSugeridos } from './perfil-modelo';
import { resolverPersona } from './personas';
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
 * Lecturas de la ficha que no hacen falta para el primer pintado: el
 * rendimiento, todo lo de rivales, el ranking europeo y los relevos. La página las empieza a la vez que la
 * ficha pero no las espera; cada pestaña las recibe en streaming dentro de
 * su `Suspense`. Ninguna promesa se rechaza: un fallo es `null`.
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

const RIVALES_VACIOS: RivalesDiferidos = { enfrentados: null, stats: null, sugeridos: null };

export function cargarDiferidosPerfil(ctx: ContextoExplorador, personaId: string): DiferidosPerfil {
  const persona = (async () => {
    await exigirPerfil(ctx);
    if (!UUID_RE.test(personaId) || !(await ctx.esquema()).identidad) return null;
    return resolverPersona(ctx.db, personaId);
  })().catch(() => null);

  const rendimiento = persona
    .then((p) => (p ? leerRendimientoDe(ctx.db, p.ids) : null))
    .catch(() => null);

  const rivales = persona
    .then(async (p): Promise<RivalesDiferidos> => {
      if (!p) return RIVALES_VACIOS;
      const [enfrentados, stats, sugeridos] = await Promise.all([
        leerRivalesPorAmbitoDe(ctx.db, p.ids, p.canonicaId),
        leerEstadisticasRivalesDe(ctx.db, p.ids, p.canonicaId),
        ctx.db.execute(sqlTiradoresSugeridos(p.ids, p.canonicaId))
          .then((r) => aTiradoresSugeridos(filas(r)))
          .catch(() => null),
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
