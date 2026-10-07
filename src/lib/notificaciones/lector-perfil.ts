import { sql } from 'drizzle-orm';
import { leerOlimpicaPersonas } from '@/lib/sport/explorar/olimpica-perfil';
import { resolverPersona } from '@/lib/sport/explorar/personas';
import { leerRankingInternacionalDeIds } from '@/lib/sport/explorar/ranking-internacional';
import { leerRankingNacional } from '@/lib/sport/explorar/ranking-nacional';
import type { Db } from '@/db';
import { filasDe } from './db';
import type { LecturasPersona, Lectura, LectorPerfil, PersonaVinculada } from './perfil';
import { nombrePrueba } from './textos';

/**
 * La lectura de hoy de cada persona, con las MISMAS funciones que pintan su
 * ficha en Explorar: si el aviso dice «5.º», la ficha dice «5.º». Solo se
 * leen, no se tocan.
 */
export function crearLectorPerfil(db: Pick<Db, 'execute'>): LectorPerfil {
  return async (personas: readonly PersonaVinculada[]) => {
    const salida: LecturasPersona[] = [];
    for (const persona of personas) {
      const grupo = await resolverPersona(db, persona.personId);
      if (!grupo) continue;
      const [cabecera] = await filasDe<{ pais: string | null }>(db, sql`SELECT country_code AS pais FROM sport_person WHERE id = ${grupo.canonicaId}`);
      const [nacional, internacional, olimpica] = await Promise.all([
        leerRankingNacional(db, grupo.ids),
        leerRankingInternacionalDeIds(db, grupo.ids, cabecera?.pais ?? null),
        leerOlimpicaPersonas(db, [grupo.canonicaId]),
      ]);
      const lecturas: Lectura[] = [];
      for (const lista of nacional.actuales) {
        lecturas.push({
          clave: `nacional:${lista.clave}`,
          valor: `${lista.ultimo.temporada}|${lista.ultimo.puesto ?? ''}`,
          etiqueta: `Ranking nacional · ${nombrePrueba({ arma: lista.arma, genero: lista.genero, categoria: lista.categoria })}`,
        });
      }
      for (const bloque of [internacional.mundial, internacional.continental]) {
        for (const p of bloque?.actual ?? []) {
          lecturas.push({
            clave: `internacional:${p.organismo}:${p.arma}-${p.genero}-${p.categoriaRaw}`,
            valor: `${p.temporada}|${p.puesto ?? ''}`,
            etiqueta: `Ranking ${p.organismo} · ${nombrePrueba({ arma: p.arma, genero: p.genero, categoria: p.categoria })}`,
          });
        }
      }
      for (const o of olimpica[grupo.canonicaId] ?? []) {
        if (!o.anotacion.estado) continue;
        lecturas.push({
          clave: `olimpico:${o.arma}-${o.genero}`,
          valor: o.anotacion.estado,
          etiqueta: `Estado olímpico · ${nombrePrueba({ arma: o.arma, genero: o.genero, categoria: 'ABS' })}`,
        });
      }
      salida.push({ personId: grupo.canonicaId, lecturas });
    }
    return salida;
  };
}
