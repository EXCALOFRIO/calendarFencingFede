import { parseArgs } from 'node:util';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { CARPETA_TRABAJO } from './indexado/comun';
import { resolverFotoOficial } from '../src/lib/sport/explorar/foto-fuente';
import { retratoAncho } from '../src/lib/sport/explorar/foto-contrato';
import {
  almacenR2, claveMarcaFie, leerMarca, marcaVigente, type MarcaFoto,
} from '../src/lib/sport/explorar/fotos/cache';
import { createPrivateExportDirectory, sanitizedError } from '../src/lib/migracion-cloudflare/files';
import type { CuboR2 } from '../src/lib/storage';

/**
 * PRECARGA DE RETRATOS FIE: resuelve, no descarga.
 *
 * Calienta de antemano lo mismo que la ruta `/api/explorar/deportistas/<id>/foto`
 * guarda en R2 la primera vez: por FIE ID, la dirección ya validada del retrato
 * o «no hay» (`fotos/fie/<id>.json`, ver `src/lib/sport/explorar/fotos/cache.ts`).
 * Usa exactamente `resolverFotoOficial`, con sus límites y su veto de menores.
 *
 * NO copia píxeles: los términos de la FIE no lo permiten y el permiso
 * obtenido excluye expresamente las fotos (ver `fie-tiradores.ts`).
 *
 * Educado con la FIE: dos peticiones por ID (GET de la ficha + HEAD de la
 * imagen), cuatro a la vez como mucho, pausa entre peticiones, `User-Agent`
 * identificable y tope por ejecución. Lo ya resuelto y vigente en la carpeta
 * local no se vuelve a pedir, así que se puede parar y seguir otro día.
 *
 *   npx tsx scripts/fotos-precargar.ts --limite 200            # sólo local
 *   npx tsx scripts/fotos-precargar.ts --limite 200 --medir    # + HEAD a 96 px
 *   npx tsx scripts/fotos-precargar.ts --subir --account-id <id> \
 *     --confirmar-cubo calendario-esgrima-archivos              # sube lo local
 */

const BUCKET = 'calendario-esgrima-archivos';
const UA_POR_DEFECTO = 'CalendarioEsgrima/1.0 (+https://calendario-fie-fede.excalofrio.workers.dev)';
const MAX_CONCURRENCIA = 4;

type Fila = { valor: string; esp: number };
type Resumen = {
  candidatos: number; pedidos: number; reutilizados: number;
  publicadas: number; sinFoto: number; fallos: number;
  bytes320: number; medidas320: number; bytes96: number; medidas96: number;
};

function seleccionar(base: string, limite: number): Fila[] {
  const db = new DatabaseSync(base, { readOnly: true });
  try {
    // Los españoles primero: son los que más se miran en Explorar.
    return db.prepare(`
      SELECT e.value AS valor, MAX(p.country_code = 'ESP') AS esp
      FROM sport_external_id e JOIN sport_person p ON p.id = e.person_id
      WHERE e.scheme = 'fie_addr_id' AND e.scope_source = 'fie' AND e.link_status = 'CONFIRMADO'
      GROUP BY e.value
      ORDER BY esp DESC, CAST(e.value AS INTEGER)
      LIMIT ?`).all(limite) as Fila[];
  } finally {
    db.close();
  }
}

async function leerLocal(ruta: string): Promise<MarcaFoto | null> {
  try { return leerMarca(await readFile(ruta, 'utf8')); } catch { return null; }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function precargar(opciones: {
  base: string; salida: string; limite: number; concurrencia: number;
  pausaMs: number; rehacer: boolean; medir: boolean; hoy: string;
}): Promise<Resumen> {
  const ua = process.env.INGEST_USER_AGENT || UA_POR_DEFECTO;
  const filas = seleccionar(opciones.base, opciones.limite)
    .filter((f) => /^[1-9]\d{0,9}$/.test(f.valor));
  const carpeta = join(opciones.salida, 'fie');
  await mkdir(carpeta, { recursive: true });
  const resumen: Resumen = {
    candidatos: filas.length, pedidos: 0, reutilizados: 0,
    publicadas: 0, sinFoto: 0, fallos: 0, bytes320: 0, medidas320: 0, bytes96: 0, medidas96: 0,
  };
  // Cada petición, sea GET o HEAD, pasa por aquí: UA y pausa en un único sitio.
  const fetchEducado: typeof fetch = async (url, init) => {
    await esperar(opciones.pausaMs);
    const headers = new Headers(init?.headers);
    headers.set('User-Agent', ua);
    return fetch(url, { ...init, headers });
  };

  async function procesar(fieId: number) {
    const ruta = join(carpeta, `${fieId}.json`);
    const previa = opciones.rehacer ? null : await leerLocal(ruta);
    if (previa && marcaVigente(previa, opciones.hoy)) {
      resumen.reutilizados++;
      if (previa.estado === 'publicada') resumen.publicadas++; else resumen.sinFoto++;
      return;
    }
    resumen.pedidos++;
    const r = await resolverFotoOficial(fieId, opciones.hoy, { fetch: fetchEducado });
    if (r.tipo === 'fallo') { resumen.fallos++; return; }
    const marca: MarcaFoto = r.tipo === 'publicada'
      ? { v: 1, estado: 'publicada', src: r.foto.src, comprobada: opciones.hoy }
      : { v: 1, estado: 'sin_foto', comprobada: opciones.hoy };
    await writeFile(ruta, JSON.stringify(marca));
    if (r.tipo === 'sin_foto') { resumen.sinFoto++; return; }
    resumen.publicadas++;
    resumen.bytes320 += r.bytes;
    resumen.medidas320++;
    if (!opciones.medir) return;
    const mini = retratoAncho(r.foto.src, 96);
    const h = mini ? await fetchEducado(mini, {
      method: 'HEAD', redirect: 'manual', headers: { Accept: 'image/avif,image/webp,image/jpeg,image/png' },
    }).catch(() => null) : null;
    const peso = Number(h?.headers.get('content-length'));
    if (h?.ok && Number.isFinite(peso) && peso > 0) { resumen.bytes96 += peso; resumen.medidas96++; }
  }

  let siguiente = 0;
  async function trabajador() {
    for (;;) {
      const fila = filas[siguiente++];
      if (!fila) return;
      await procesar(Number(fila.valor));
      const hechos = resumen.pedidos + resumen.reutilizados;
      if (hechos % 50 === 0) console.log(JSON.stringify({ progreso: hechos, de: filas.length }));
    }
  }
  await Promise.all(Array.from({ length: opciones.concurrencia }, trabajador));
  return resumen;
}

async function subir(salida: string, hoy: string, accountId: string): Promise<{ subidas: number; omitidas: number }> {
  const carpeta = join(salida, 'fie');
  const ficheros = (await readdir(carpeta)).filter((f) => /^[1-9]\d{0,9}\.json$/.test(f));
  const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const directorio = await createPrivateExportDirectory(workspace);
  const configPath = join(directorio, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({
    name: 'calendario-fotos-local', account_id: accountId, compatibility_date: '2026-09-15',
    r2_buckets: [{ binding: 'ARCHIVOS', bucket_name: BUCKET, remote: true }],
  }), { flag: 'wx', mode: 0o600 });
  delete process.env.CLOUDFLARE_API_TOKEN;
  process.env.WRANGLER_LOG_LEVEL = 'error';
  process.chdir(directorio);
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ ARCHIVOS: CuboR2 }>({ configPath, envFiles: [], persist: false, remoteBindings: true });
  const almacen = almacenR2(proxy.env.ARCHIVOS);
  let subidas = 0, omitidas = 0;
  try {
    for (const fichero of ficheros) {
      const fieId = Number(fichero.slice(0, -'.json'.length));
      const marca = await leerLocal(join(carpeta, fichero));
      // Lo caducado no se sube: en R2 obligaría a la ruta a fiarse de algo viejo.
      if (!marca || !marcaVigente(marca, hoy)) { omitidas++; continue; }
      await almacen.guardar(claveMarcaFie(fieId), JSON.stringify(marca));
      if (++subidas % 200 === 0) console.log(JSON.stringify({ subidas, de: ficheros.length }));
    }
  } finally {
    await proxy.dispose();
  }
  return { subidas, omitidas };
}

async function main() {
  const { values } = parseArgs({ options: {
    base: { type: 'string' }, salida: { type: 'string' },
    limite: { type: 'string' }, concurrencia: { type: 'string' }, 'pausa-ms': { type: 'string' },
    rehacer: { type: 'boolean' }, medir: { type: 'boolean' },
    subir: { type: 'boolean' }, 'account-id': { type: 'string' }, 'confirmar-cubo': { type: 'string' },
  } });
  const hoy = new Date().toISOString().slice(0, 10);
  const salida = resolve(values.salida ?? join(CARPETA_TRABAJO, 'fotos'));
  if (values.subir) {
    if (!/^[a-f0-9]{32}$/.test(values['account-id'] ?? '') || values['confirmar-cubo'] !== BUCKET) {
      throw new Error('fotos_destination_confirmation_required');
    }
    console.log(JSON.stringify({ modo: 'subida', ...(await subir(salida, hoy, values['account-id']!)) }));
    return;
  }
  const limite = Number(values.limite ?? 500);
  const concurrencia = Number(values.concurrencia ?? MAX_CONCURRENCIA);
  const pausaMs = Number(values['pausa-ms'] ?? 250);
  if (!Number.isInteger(limite) || limite < 1 || limite > 100_000) throw new Error('fotos_limite_invalido');
  if (!Number.isInteger(concurrencia) || concurrencia < 1 || concurrencia > MAX_CONCURRENCIA) {
    throw new Error('fotos_concurrencia_invalida');
  }
  if (!Number.isInteger(pausaMs) || pausaMs < 100) throw new Error('fotos_pausa_invalida');
  const inicio = Date.now();
  const resumen = await precargar({
    base: resolve(values.base ?? join(CARPETA_TRABAJO, 'nuevo5.sqlite')),
    salida, limite, concurrencia, pausaMs, hoy,
    rehacer: values.rehacer === true, medir: values.medir === true,
  });
  const informe = {
    modo: 'precarga', hoy, salida, segundos: Math.round((Date.now() - inicio) / 1000), ...resumen,
    media320Kb: resumen.medidas320 ? +(resumen.bytes320 / resumen.medidas320 / 1024).toFixed(1) : null,
    media96Kb: resumen.medidas96 ? +(resumen.bytes96 / resumen.medidas96 / 1024).toFixed(1) : null,
  };
  // Con hora: una segunda pasada el mismo día no pisa el informe de la primera.
  const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  await writeFile(join(salida, `resumen-${sello}.json`), JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(informe));
}

main().catch((error) => {
  console.error(error instanceof Error && /^fotos_/.test(error.message) ? error.message : sanitizedError(error));
  process.exitCode = 1;
});
