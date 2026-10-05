import { filas, type ContextoExplorador } from './contexto';
import type { FilasPerfil } from './perfil-modelo';
import {
  sqlBalanceAsaltos,
  sqlClubesRecientes,
  sqlIdFieConfirmado,
  sqlMejorRanking,
  sqlRivalesFrecuentes,
  type FilaBalanceAsaltos,
  type FilaClubPublicado,
  type FilaMejorRanking,
  type FilaRivalFrecuente,
} from './perfil-sql';

async function tolerante<T>(consulta: () => Promise<unknown>, que: string): Promise<T[] | null> {
  try {
    return filas<T>(await consulta());
  } catch (error) {
    console.error(
      `[explorar] ${que} del perfil no se pudo leer:`,
      error instanceof Error ? error.name : 'desconocido',
    );
    return null;
  }
}

/**
 * Lecturas propias del perfil, en paralelo y sin depender de la ficha. Cada
 * una falla por separado: un fallo en los asaltos deja `null` (la pantalla
 * dice que no se pudo leer) y no tumba la ficha ni se presenta como cero.
 */
export async function leerFilasPerfil(
  db: ContextoExplorador['db'],
  ids: readonly string[],
  canonicaId: string,
): Promise<Omit<FilasPerfil, 'estadisticas'>> {
  const [asaltos, rivales, clubes, idsFie, mejorRanking] = await Promise.all([
    tolerante<FilaBalanceAsaltos>(() => db.execute(sqlBalanceAsaltos(ids)), 'el balance de asaltos'),
    tolerante<FilaRivalFrecuente>(() => db.execute(sqlRivalesFrecuentes(ids, canonicaId)), 'la lista de rivales'),
    tolerante<FilaClubPublicado>(() => db.execute(sqlClubesRecientes(ids)), 'el club'),
    tolerante<{ valor: string }>(() => db.execute(sqlIdFieConfirmado(ids)), 'el enlace FIE'),
    tolerante<FilaMejorRanking>(() => db.execute(sqlMejorRanking(ids)), 'el mejor ranking'),
  ]);
  return {
    asaltos,
    rivales,
    clubes: clubes ?? [],
    idsFie: idsFie ?? [],
    mejorRanking: mejorRanking ?? [],
  };
}
