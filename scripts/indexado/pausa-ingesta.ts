/**
 * Pausa a los escritores automáticos de sport_* (el cron /api/cron/resultados) mientras se
 * prepara y aplica un lote manual. Reserva el lease global igual que lo haría un escritor:
 * el cron lo ve ocupado, responde `ocupado` y no escribe nada, de modo que la copia local
 * sigue siendo idéntica a producción hasta `sincronizar-d1 --aplicar`.
 *
 *   --reservar [--horas 6]   reserva el lease si está libre, o lo prorroga si ya es nuestro
 *   --liberar                lo suelta (sólo si sigue siendo nuestro); hacerlo justo antes de --aplicar
 *   --estado                 lease actual y última actividad del cron
 *   [--archivo <ruta>]       dónde se guarda el owner (por defecto calendario-trabajo/pausa-ingesta.json)
 *
 * El lease caduca solo: si nadie lo libera, el cron vuelve a escribir al cabo de --horas.
 * `sincronizar-d1 --aplicar` exige el lease libre, así que hay que liberar antes de aplicar,
 * y conviene aplicar justo después de un minuto :20 (la pasada del cron dura ≤45 s).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento, bandera, CARPETA_TRABAJO } from './comun';
import { consultarRemoto, literal } from './sincronizar-d1';

export const HORAS_POR_DEFECTO = 6;
export const HORAS_MAX = 12;
const AHORA_SQL =
  "(cast(strftime('%s','now') as integer)*1000 + cast(substr(strftime('%f','now'),4,3) as integer))";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Lease {
  owner: string;
  lease_version: number;
  expires_at: number;
  ahora: number;
}

function comprobarOwner(owner: string): string {
  if (!UUID.test(owner)) throw new Error('owner_invalido');
  return literal(owner);
}

export function horasValidas(texto: string): number {
  const h = Number(texto);
  if (!Number.isFinite(h) || h <= 0 || h > HORAS_MAX) throw new Error(`--horas debe estar entre 0 y ${HORAS_MAX}`);
  return h;
}

const SELECT_LEASE = `SELECT owner, lease_version, expires_at, ${AHORA_SQL} AS ahora FROM sport_write_lease WHERE key='global'`;

/** Igual que la cabecera de cada chunk de sincronizar-d1: sólo se toma si ha caducado. */
export function sqlReservar(owner: string, ms: number): string {
  const o = comprobarOwner(owner);
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error('duracion_invalida');
  return `INSERT INTO sport_write_lease(key,owner,expires_at,lease_version) VALUES('global',${o},${AHORA_SQL}+${ms},1) ` +
    `ON CONFLICT(key) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at, ` +
    `lease_version=sport_write_lease.lease_version+1 WHERE sport_write_lease.expires_at <= ${AHORA_SQL};\n${SELECT_LEASE}`;
}

/** Prórroga de un lease que sigue siendo nuestro y no ha caducado. */
export function sqlProrrogar(owner: string, ms: number): string {
  const o = comprobarOwner(owner);
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error('duracion_invalida');
  return `UPDATE sport_write_lease SET expires_at=${AHORA_SQL}+${ms} ` +
    `WHERE key='global' AND owner=${o} AND expires_at > ${AHORA_SQL};\n${SELECT_LEASE}`;
}

export function sqlLiberar(owner: string): string {
  const o = comprobarOwner(owner);
  return `UPDATE sport_write_lease SET expires_at=${AHORA_SQL} WHERE key='global' AND owner=${o} AND expires_at > ${AHORA_SQL};\n${SELECT_LEASE}`;
}

export function vigente(l: Lease | null | undefined): boolean {
  return Boolean(l && Number(l.expires_at) > Number(l.ahora));
}

function hora(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function describir(l: Lease | null | undefined, propio: string | null): string {
  if (!l || !vigente(l)) return 'lease libre: el cron puede escribir en su próxima pasada';
  const min = Math.round((Number(l.expires_at) - Number(l.ahora)) / 60_000);
  return `lease ${l.owner === propio ? 'NUESTRO' : `de otro escritor (${l.owner})`} hasta ${hora(Number(l.expires_at))} (${min} min)`;
}

function leaseDe(sql: string): Lease | null {
  const r = consultarRemoto(sql);
  return (r[r.length - 1]?.results[0] as unknown as Lease | undefined) ?? null;
}

function main() {
  const archivo = resolve(argumento('archivo', join(CARPETA_TRABAJO, 'pausa-ingesta.json')));
  const guardado: string | null = existsSync(archivo) ? (JSON.parse(readFileSync(archivo, 'utf8')) as { owner: string }).owner : null;
  if (bandera('reservar')) {
    const ms = Math.round(horasValidas(argumento('horas', String(HORAS_POR_DEFECTO))) * 3_600_000);
    let l = guardado ? leaseDe(sqlProrrogar(guardado, ms)) : null;
    if (!guardado || l?.owner !== guardado || !vigente(l)) {
      const owner = randomUUID();
      l = leaseDe(sqlReservar(owner, ms));
      if (l?.owner !== owner || !vigente(l)) {
        console.error(`No se pudo reservar: ${describir(l, guardado)}. Si es el cron, reintentar en un minuto.`);
        process.exitCode = 1;
        return;
      }
      writeFileSync(archivo, `${JSON.stringify({ owner, reservado: new Date().toISOString() }, null, 2)}\n`);
      console.log(`Reservado. ${describir(l, owner)}`);
    } else {
      console.log(`Prorrogado. ${describir(l, guardado)}`);
    }
  } else if (bandera('liberar')) {
    if (!guardado) throw new Error(`no hay owner guardado en ${archivo}`);
    const l = leaseDe(sqlLiberar(guardado));
    if (l?.owner === guardado && vigente(l)) throw new Error('el lease sigue vigente; no se pudo liberar');
    rmSync(archivo, { force: true });
    console.log(`Liberado. ${describir(l, null)}`);
  } else if (bandera('estado')) {
    const r = consultarRemoto(`${SELECT_LEASE};
      SELECT max(ultima) AS ultima, count(*) AS unidades FROM resultado_auto_unidad;
      SELECT clave, valor FROM resultado_auto_consumo WHERE dia = date('now');
      SELECT count(*) AS abiertas FROM resultado_auto_revision WHERE estado = 'abierta'`);
    console.log(describir(r[0]?.results[0] as unknown as Lease | undefined, guardado));
    const u = r[1]?.results[0] as { ultima: number | null; unidades: number } | undefined;
    console.log(`Cron: ${u?.unidades ?? 0} unidades; última pasada con unidad ${u?.ultima ? hora(Number(u.ultima)) : 'nunca'}`);
    const consumo = (r[2]?.results ?? []) as { clave: string; valor: number }[];
    console.log(`Consumo de hoy: ${consumo.length ? consumo.map((c) => `${c.clave}=${c.valor}`).join(', ') : 'nada'}`);
    console.log(`Revisiones abiertas: ${(r[3]?.results[0] as { abiertas: number } | undefined)?.abiertas ?? 0}`);
  } else {
    throw new Error('modo: --reservar [--horas N] | --liberar | --estado');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
