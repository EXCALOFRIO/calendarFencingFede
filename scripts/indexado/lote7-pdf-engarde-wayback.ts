/**
 * Índice de la Wayback Machine de las páginas de Engarde de los organizadores españoles.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-pdf-engarde-wayback.ts [--orgs a,b] [--pausa-ms 1500]
 *
 * Por organizador se pide la API CDX con los prefijos `engarde-service.com/{competition,files,tournament}/{org}/`
 * (con y sin `www.`; capturas 200, una por URL). El resultado queda en
 * `cache-lote7-pdf/engarde-wayback/cdx/{org}.json` (lista de `[timestamp, original]`) y no se vuelve a pedir.
 * `capturasEngarde` agrupa esas capturas por torneo y prueba para `lote7-pdf-engarde.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argumento } from './comun';
import { CACHE_LOTE7_PDF, ClienteEducado } from './lote7-pdf-comun';

export const CARPETA_ENGARDE_WAYBACK = join(CACHE_LOTE7_PDF, 'engarde-wayback');

export type CapturaEngarde = { timestamp: string; original: string };
export type PaginaCapturada = { org: string; evt: string; compe: string | null; pagina: string; timestamp: string; original: string };

/** `https://www.engarde-service.com:80/competition/rfee/evt/compe/poules1.htm` → partes; null si no es de torneo. */
export function partesUrlEngarde(original: string): Omit<PaginaCapturada, 'timestamp' | 'original'> | null {
  const m = original.match(/^https?:\/\/(?:www\.)?engarde-service\.com(?::\d+)?\/(competition|files|tournament)\/([^/?#]+)\/([^/?#]+)(?:\/([^?#]*))?/i);
  if (!m) return null;
  const resto = (m[4] ?? '').split('/').filter(Boolean);
  const tipo = m[1].toLowerCase();
  if (tipo === 'tournament') return { org: m[2].toLowerCase(), evt: m[3].toLowerCase(), compe: null, pagina: 'torneo' };
  const compe = resto[0] ?? null;
  let pagina = resto.slice(1).join('/') || (tipo === 'files' ? 'menu.html' : 'prueba');
  const q = original.match(/[?&]page=([^&#]+)/i);
  if (q) pagina = q[1];
  return { org: m[2].toLowerCase(), evt: m[3].toLowerCase(), compe: compe?.toLowerCase() ?? null, pagina: `${tipo === 'files' ? 'files_' : ''}${pagina}` };
}

/** Capturas agrupadas por `org/evt`, con la última captura de cada página. */
export function capturasEngarde(capturas: readonly CapturaEngarde[]): Map<string, PaginaCapturada[]> {
  const out = new Map<string, Map<string, PaginaCapturada>>();
  for (const c of capturas) {
    const p = partesUrlEngarde(c.original);
    if (!p) continue;
    const k = `${p.org}/${p.evt}`;
    const g = out.get(k) ?? new Map<string, PaginaCapturada>();
    const kp = `${p.compe ?? ''}/${p.pagina}`;
    const previa = g.get(kp);
    if (!previa || previa.timestamp < c.timestamp) g.set(kp, { ...p, timestamp: c.timestamp, original: c.original });
    out.set(k, g);
  }
  return new Map([...out].map(([k, g]) => [k, [...g.values()]]));
}

export function leerCdxOrganizador(org: string): CapturaEngarde[] | null {
  const ruta = join(CARPETA_ENGARDE_WAYBACK, 'cdx', `${org}.json`);
  return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as CapturaEngarde[]) : null;
}

export async function cdxOrganizador(org: string, red: ClienteEducado): Promise<CapturaEngarde[]> {
  const previo = leerCdxOrganizador(org);
  if (previo) return previo;
  const out: CapturaEngarde[] = [];
  for (const tipo of ['competition', 'files', 'tournament']) {
    const url = `https://web.archive.org/cdx/search/cdx?url=engarde-service.com/${tipo}/${encodeURIComponent(org)}/&matchType=prefix&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=urlkey&limit=20000`;
    const r = await red.pedir(url);
    if (r.status !== 200) throw new Error(`cdx ${org} ${tipo}: ${r.status}`);
    const texto = new TextDecoder().decode(r.bytes).trim();
    const filas = texto ? (JSON.parse(texto) as string[][]) : [];
    for (const f of filas.slice(1)) out.push({ timestamp: f[0], original: f[1] });
  }
  mkdirSync(join(CARPETA_ENGARDE_WAYBACK, 'cdx'), { recursive: true });
  writeFileSync(join(CARPETA_ENGARDE_WAYBACK, 'cdx', `${org}.json`), JSON.stringify(out));
  return out;
}

async function main(): Promise<void> {
  const orgs = argumento('orgs', '').split(',').map((s) => s.trim()).filter(Boolean);
  const red = new ClienteEducado(Math.max(1000, Number(argumento('pausa-ms', '1500'))), 2000);
  const resumen: Record<string, { capturas: number; torneos: number }> = {};
  for (const org of orgs) {
    try {
      const c = await cdxOrganizador(org, red);
      resumen[org] = { capturas: c.length, torneos: capturasEngarde(c).size };
      console.log(`${org}: ${c.length} capturas, ${resumen[org].torneos} torneos`);
    } catch (e) {
      console.log(`${org}: error ${(e as Error).message}`);
    }
  }
  writeFileSync(join(CARPETA_ENGARDE_WAYBACK, '_resumen.json'), JSON.stringify(resumen, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
