/**
 * Huecos del catálogo nacional cuyo único documento es un torneo de Engarde que ya no
 * tiene datos («This competition currently has no data»): se buscan en la Wayback
 * Machine las exportaciones estáticas archivadas (`/files/{org}/{evt}/{compe}/…`,
 * clasificación, poules y cuadro) y se leen con el lector de exportaciones estáticas
 * de `engarde-historico-a-hechos.ts`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote7-faltan-engarde-wayback.ts [--db <nuevo7.sqlite>]
 *
 * Sólo se escribe una prueba si (a) el documento archivado la describe sin ambigüedad
 * (arma, género, categoría y modalidad por el título publicado), (b) casa con la fila del
 * catálogo que la enlaza (±2 días) y (c) nuevo7 no tiene ninguna prueba equivalente.
 * Claves de Engarde: edición `engarde:{org}/{evt}`, prueba `engarde:{org}/{evt}/{compe}`.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { argumento } from './comun';
import { CARPETA_ENGARDE, enlaceEngarde, type FilaInventario } from './engarde-descargar';
import { convertirEntrada, type EntradaPrueba } from './engarde-historico-a-hechos';
import { abrirNuevo7, dia, EscritorHechos, INVENTARIO_NACIONAL, NUEVO7 } from './lote7-faltan-comun';
import { compatibles, engardeSinDatos, huecosCatalogo, pruebasDeBase } from './lote7-faltan-huecos';
import { Red } from './lote7-faltan-red';

type Captura = { timestamp: string; original: string; compe: string; fichero: string };

/** `…/files/{org}/{evt}/{compe}/index.php?page=clasfinal.htm` o `…/{compe}/clasfinal.htm` → compe y documento. */
export function documentoArchivado(original: string, org: string, evt: string): { compe: string; fichero: string } | null {
  const u = original.replace(/^https?:\/\/(www\.)?/i, '').replace(/:80\//, '/');
  const raiz = `engarde-service.com/files/${org}/${evt}/`.toLowerCase();
  if (!u.toLowerCase().startsWith(raiz)) return null;
  const resto = u.slice(raiz.length);
  const m = /^([^/?#]+)\/(?:index\.php\?page=)?([^/?#&]+\.html?)$/i.exec(resto);
  if (!m) return null;
  return { compe: m[1], fichero: m[2] };
}

async function main(): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);
  const db = abrirNuevo7(argumento('db', NUEVO7));
  const inv = JSON.parse(readFileSync(INVENTARIO_NACIONAL, 'utf8')) as { ownRfeeCatalog: FilaInventario[]; catalog: FilaInventario[] };
  const pruebas = pruebasDeBase(db);
  db.close();
  const huecos = huecosCatalogo(inv, pruebas, [], engardeSinDatos(CARPETA_ENGARDE), hoy);
  const torneos = new Map<string, { org: string; evt: string; filas: FilaInventario[] }>();
  for (const h of huecos) {
    if (h.clase !== 'engarde_sin_datos' && h.clase !== 'pendiente' && h.clase !== 'documento_en_otra_prueba') continue;
    const f: FilaInventario = { fuente: 'skermo_rfee', ...h };
    for (const e of f.enlaces) {
      const r = enlaceEngarde(e.url);
      if (r.tipo !== 'torneo') continue;
      const k = `${r.org}/${r.evt}`;
      const t = torneos.get(k) ?? { org: r.org, evt: r.evt, filas: [] };
      if (!t.filas.includes(f)) t.filas.push(f);
      torneos.set(k, t);
    }
  }
  const red = new Red(undefined, 1500, 1);
  const escritor = new EscritorHechos('lector_engarde_wayback');
  const detalle: Record<string, unknown>[] = [];
  for (const t of torneos.values()) {
    const cdx = await red.get(`https://web.archive.org/cdx/search/cdx?url=engarde-service.com/files/${t.org}/${t.evt}/&matchType=prefix&collapse=urlkey&filter=statuscode:200&output=json&limit=2000`);
    const filas = cdx.status === 200 && cdx.body.length > 2 ? (JSON.parse(cdx.body.toString('utf8')) as string[][]).slice(1) : [];
    const porCompe = new Map<string, Captura[]>();
    for (const [, timestamp, original] of filas) {
      const d = documentoArchivado(original, t.org, t.evt);
      if (!d || !tipoDocumentoEngarde(d.fichero)) continue;
      (porCompe.get(d.compe) ?? porCompe.set(d.compe, []).get(d.compe)!).push({ timestamp, original, ...d });
    }
    if (porCompe.size === 0) {
      detalle.push({ torneo: `${t.org}/${t.evt}`, motivo: 'sin_capturas_de_documentos', filas: t.filas.map((f) => f.claveCatalogo) });
      continue;
    }
    for (const [compe, capturas] of porCompe) {
      const docs: { fichero: string; html: string; url: string; tipo: string }[] = [];
      for (const c of capturas) {
        const r = await red.get(`https://web.archive.org/web/${c.timestamp}id_/${c.original}`);
        if (r.status !== 200) continue;
        docs.push({ fichero: c.fichero, html: r.body.toString('utf8'), url: `https://web.archive.org/web/${c.timestamp}/${c.original}`, tipo: tipoDocumentoEngarde(c.fichero)! });
      }
      const entrada: EntradaPrueba = {
        org: t.org, evt: t.evt, compe,
        claveTorneo: `engarde:${t.org}/${t.evt}`, claveCompeticion: `engarde:${t.org}/${t.evt}/${compe}`,
        nombreTorneo: t.filas[0]?.nombre ?? `${t.org}/${t.evt}`,
        comp: { sexe: '', arme: '', estindividuelle: '', categorie: '', etat: 'completed', ville: '', pays: '' },
        legado: true, titulos: [], fechaIndice: null, fechaTorneo: null, temporadaCarpeta: null,
        clasificacion: docs.find((d) => d.tipo === 'clasificacion') ?? null,
        poules: docs.filter((d) => d.tipo === 'poules').map((d) => ({ ...d, pagina: Number(/(\d+)\.html?$/i.exec(d.fichero)?.[1] ?? 1) })),
        cuadros: docs.filter((d) => d.tipo === 'cuadro'),
        faltan: [], extractor: 'lector_engarde_wayback',
      };
      const r = convertirEntrada(entrada, '2100-01-01');
      if (!r.ok) {
        detalle.push({ prueba: entrada.claveCompeticion, motivo: r.motivo });
        continue;
      }
      const c = r.hechos.competition;
      const fecha = c.date ?? r.hechos.edition.startDate;
      const p = { weapon: c.weapon, gender: c.gender, category: c.category, format: c.format, d: fecha ? dia(fecha) : Number.NaN };
      const fila = t.filas.find((f) => compatibles(p, f));
      if (!fila) {
        detalle.push({ prueba: entrada.claveCompeticion, motivo: 'no_casa_con_la_fila_del_catalogo', atributos: `${c.weapon} ${c.gender} ${c.category} ${c.format} ${fecha}` });
        continue;
      }
      if (pruebas.some((x) => compatibles(x, { arma: c.weapon, genero: c.gender, categoria: c.category, formato: c.format, fecha }))) {
        detalle.push({ prueba: entrada.claveCompeticion, motivo: 'existe_en_nuevo7' });
        continue;
      }
      const h = { ...r.hechos, edition: { ...r.hechos.edition, season: fila.temporada, name: fila.nombre } };
      h.status = { ...h.status, notes: [...h.status.notes, 'Exportación estática de Engarde archivada en la Wayback Machine; Engarde ya no publica los datos de esta prueba'] };
      escritor.escribir(h);
      detalle.push({ prueba: entrada.claveCompeticion, fila: fila.claveCatalogo, atributos: `${c.weapon} ${c.gender} ${c.category} ${c.format} ${fecha}`, puestos: h.results.length, asaltos: h.bouts.length, estados: h.status });
    }
  }
  escritor.limpiarAntiguos();
  const resumen = { generado: new Date().toISOString(), torneos: torneos.size, ficheros: escritor.total, peticiones: red.peticiones, detalle };
  escritor.informe('engarde-wayback', resumen);
  console.log(JSON.stringify(resumen, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
