/**
 * Búsqueda de otras publicaciones de los eventos nacionales que siguen sin poules ni cuadro:
 * la web de la RFEE (API REST de WordPress de esgrima.es: entradas y ficheros subidos en los días
 * del evento) y los enlaces que esas entradas publican (Engarde, FencingTimeLive, Ophardt, Drive,
 * Dropbox, PDF). Cada PDF nuevo se descarga a la caché y se mira si trae poules o cuadros.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-pdf-otras-fuentes.ts [--informe <engarde/_informe.json>]
 *
 * Una petición cada vez por host, ≥1 s de pausa, User-Agent `INGEST_USER_AGENT`, todo en
 * `cache-lote7-pdf/otras-fuentes/`. Sólo informa: los PDF con poules o cuadro se pasan después por
 * el lector o los droids.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, CARPETA_TRABAJO } from './comun';
import { CACHE_LOTE7_PDF, ClienteEducado, HECHOS_LOTE7_PDF, NUEVO7 } from './lote7-pdf-comun';
import { textoPdf } from './pdf-droids';

const CARPETA = join(CACHE_LOTE7_PDF, 'otras-fuentes');
const WP = 'https://esgrima.es/wp-json/wp/v2';

export type Evento = { nombre: string; fecha: string; huecos: number; categorias: string[] };

/** Enlaces de interés de un HTML o texto: resultados en plataformas o ficheros. */
export function enlacesDeInteres(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)\\]+/gi)) {
    const u = m[0].replace(/&amp;/g, '&').replace(/[.,;]+$/, '');
    if (/engarde-service\.com|fencingtimelive\.com|ophardt|fencingworldwide|drive\.google\.com|dropbox\.com|bellepoule|\.pdf(\?|$)/i.test(u)) out.add(u);
  }
  return [...out];
}

/** Indicios de poules o cuadro en el texto de un PDF. */
export function traeFases(paginas: readonly string[]): { poules: boolean; cuadro: boolean } {
  const t = paginas.join(' ');
  return {
    poules: /poule\s*(n[oº°]|\d)|poules,\s*vuelta|V\/M\s+(ind|TD)/i.test(t),
    cuadro: /tableau\s+(de|of)\s+\d+|tabla\s+de\s+\d+|cuadro\s+de\s+\d+/i.test(t),
  };
}

const dia = (f: string, d: number) => new Date(Date.parse(`${f}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 19);

async function main(): Promise<void> {
  mkdirSync(CARPETA, { recursive: true });
  const red = new ClienteEducado(1200, 1500);
  const inf = JSON.parse(readFileSync(argumento('informe', join(HECHOS_LOTE7_PDF, 'engarde', '_informe.json')), 'utf8')) as {
    sinCubrir: { hueco: string; fecha: string; categoria: string }[];
  };
  const db = new DatabaseSync(NUEVO7, { readOnly: true });
  const eventos = new Map<string, Evento>();
  for (const s of inf.sinCubrir) {
    const r = db.prepare('SELECT e.name n FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id WHERE c.id = ?').get(s.hueco.split(':')[1]) as { n: string } | undefined;
    const k = `${s.fecha}|${(r?.n ?? '').trim()}`;
    const e = eventos.get(k) ?? { nombre: r?.n ?? '', fecha: s.fecha, huecos: 0, categorias: [] };
    e.huecos += 1;
    if (!e.categorias.includes(s.categoria)) e.categorias.push(s.categoria);
    eventos.set(k, e);
  }
  db.close();
  const cache = (clave: string) => join(CARPETA, `${createHash('sha256').update(clave).digest('hex').slice(0, 24)}.bin`);
  const traer = async (url: string): Promise<{ status: number; bytes: Uint8Array } | null> => {
    const ruta = cache(url);
    const meta = `${ruta}.json`;
    if (existsSync(meta)) {
      const m = JSON.parse(readFileSync(meta, 'utf8')) as { status: number };
      return { status: m.status, bytes: existsSync(ruta) ? new Uint8Array(readFileSync(ruta)) : new Uint8Array() };
    }
    if (!red.disponible()) return null;
    try {
      const r = await red.pedir(url);
      if (r.status === 200) writeFileSync(ruta, r.bytes);
      writeFileSync(meta, JSON.stringify({ url, status: r.status, tipo: r.tipo, en: new Date().toISOString() }));
      return { status: r.status, bytes: r.bytes };
    } catch {
      return null;
    }
  };
  const calidad = new Set((JSON.parse(readFileSync(join(CARPETA_TRABAJO, 'hechos', 'pdf-calidad.json'), 'utf8')) as { url: string }[]).map((c) => c.url.split('#')[0]));
  const salida: unknown[] = [];
  for (const e of [...eventos.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    const fila = { ...e, entradas: [] as { titulo: string; url: string }[], ficheros: [] as { titulo: string; url: string }[], enlaces: [] as string[], pdfsNuevos: [] as { url: string; paginas: number; poules: boolean; cuadro: boolean }[] };
    const despues = dia(e.fecha, -3);
    const antes = dia(e.fecha, 21);
    for (const tipo of ['posts', 'media']) {
      const r = await traer(`${WP}/${tipo}?after=${despues}&before=${antes}&per_page=100&_fields=id,date,link,title,source_url,content`);
      if (!r || r.status !== 200) continue;
      let lista: { link?: string; source_url?: string; title?: { rendered?: string }; content?: { rendered?: string } }[] = [];
      try {
        lista = JSON.parse(new TextDecoder().decode(r.bytes));
      } catch {
        continue;
      }
      for (const x of lista) {
        const titulo = (x.title?.rendered ?? '').replace(/<[^>]+>/g, '');
        if (tipo === 'posts') {
          fila.entradas.push({ titulo, url: x.link ?? '' });
          for (const u of enlacesDeInteres(x.content?.rendered ?? '')) if (!fila.enlaces.includes(u)) fila.enlaces.push(u);
        } else if (x.source_url) {
          fila.ficheros.push({ titulo, url: x.source_url });
          if (/\.pdf$/i.test(x.source_url) && !fila.enlaces.includes(x.source_url)) fila.enlaces.push(x.source_url);
        }
      }
    }
    for (const u of fila.enlaces.filter((x) => /\.pdf(\?|$)/i.test(x) && !calidad.has(x.split('#')[0])).slice(0, 40)) {
      const r = await traer(u);
      if (!r || r.status !== 200 || r.bytes.length < 100) continue;
      try {
        const paginas = await textoPdf(r.bytes);
        fila.pdfsNuevos.push({ url: u, paginas: paginas.length, ...traeFases(paginas) });
      } catch {
        // No es un PDF legible.
      }
    }
    salida.push(fila);
    console.log(`${e.fecha} ${e.nombre.slice(0, 40)}: entradas=${fila.entradas.length} ficheros=${fila.ficheros.length} enlaces=${fila.enlaces.length} pdfsNuevos=${fila.pdfsNuevos.length} conFases=${fila.pdfsNuevos.filter((p) => p.poules || p.cuadro).length}`);
  }
  writeFileSync(join(CARPETA, '_informe.json'), JSON.stringify(salida, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
