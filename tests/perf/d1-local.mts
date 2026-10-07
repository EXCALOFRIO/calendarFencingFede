/**
 * D1 local de verdad (workerd por `getPlatformProxy` de Wrangler) sobre una
 * copia de trabajo de la base. Es el mismo motor que producción y, sobre
 * todo, el mismo contador `meta.rows_read` con el que Cloudflare factura; el
 * SQLite de Node no lo da.
 *
 * La copia se MUEVE (no se copia) al directorio de estado de Miniflare la
 * primera vez, así que en disco sólo hay una. Para volver a usarla basta con
 * pasar el mismo `estado`. workerd la abre en escritura (modo WAL): nunca le
 * des la copia de producción.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { D1Binding } from '@/db/d1/binding';

const ID = 'e1c28f19-278c-4d8f-9c7c-9b9d1c45653e';

type Proxy = { env: Record<string, unknown>; dispose(): Promise<void> };

async function arrancar(estado: string): Promise<Proxy> {
  const { getPlatformProxy } = await import('wrangler');
  const config = join(estado, 'wrangler.json');
  if (!existsSync(config)) {
    // Sólo D1: IA, imágenes y R2 de `wrangler.jsonc` son remotos o no hacen falta.
    writeFileSync(config, JSON.stringify({
      name: 'perf-local',
      compatibility_date: '2026-09-15',
      compatibility_flags: ['nodejs_compat'],
      d1_databases: [{ binding: 'DB', database_name: 'calendario-fie-fede-db', database_id: ID }],
    }, null, 2));
  }
  return await getPlatformProxy({ configPath: config, persist: { path: join(estado, 'v3') }, remoteBindings: false } as never) as unknown as Proxy;
}

export function ficheroD1(estado: string): string | null {
  const dir = join(estado, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite');
  return f ? join(dir, f) : null;
}

/** Abre (y la primera vez instala moviendo `copia`) el D1 local. */
export async function abrirD1Local(estado: string, copia?: string): Promise<{ DB: D1Binding; fichero: string; cerrar: () => Promise<void> }> {
  estado = resolve(estado);
  mkdirSync(estado, { recursive: true });
  let fichero = ficheroD1(estado);
  if (!fichero || (copia && existsSync(copia))) {
    if (!copia || !existsSync(copia)) throw new Error('falta la copia de trabajo que instalar en el D1 local');
    if (/nuevo\d+\.sqlite$/i.test(copia)) throw new Error('esa es una copia de producción: haz una copia de trabajo');
    const p = await arrancar(estado);
    await (p.env.DB as D1Binding).prepare('SELECT 1').all();
    await p.dispose();
    fichero = ficheroD1(estado);
    if (!fichero) throw new Error('Miniflare no creó el fichero de D1');
    for (const s of ['', '-wal', '-shm']) if (existsSync(fichero + s)) rmSync(fichero + s);
    renameSync(copia, fichero);
  }
  const proxy = await arrancar(estado);
  return { DB: proxy.env.DB as D1Binding, fichero, cerrar: () => proxy.dispose() };
}
