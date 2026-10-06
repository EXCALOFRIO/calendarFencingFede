/**
 * Diagnóstico de asaltos nacionales: pruebas individuales con puestos y sin poules o
 * sin cuadro (rfee_pdf, skermo_rfee, engarde), con el motivo por el que faltan. Sólo lee.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/asaltos-rfee-diagnostico.ts \
 *     --db <copia.sqlite> [--desde 2017-01-01] [--hechos <calendario-trabajo/hechos>] \
 *     [--inventario <national-inventory.json>] [--cache <cache-rfee-2018>] [--informe <json>]
 *
 * Motivo por fase que falta, en este orden:
 *  - duplicado_con_asaltos: otra prueba del mismo evento (`dedupe-pruebas.ts`) tiene esa fase;
 *  - hechos_con_asaltos: algún fichero de hechos de la prueba (o del PDF que la publica) trae
 *    asaltos de esa fase y la base no;
 *  - pdf_sin_<fase>: el PDF se leyó y no publica la fase (sólo clasificación);
 *  - pdf_lectura_<estado>: el PDF publica la fase y la lectura quedó parcial o ilegible sin filas;
 *  - pdf_sin_leer: el PDF está en caché y no hay hechos; pdf_sin_descargar: no está en caché;
 *  - engarde_<estado>: el catálogo enlaza Engarde (con o sin hechos de ese torneo);
 *  - sin_enlace: el catálogo no publica nada más que la clasificación HTML.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, CARPETA_CACHES, CARPETA_TRABAJO, NUEVO_POR_DEFECTO } from './comun';
import { cargarPruebasNacionales, emparejarDuplicados, enlacesDelCatalogo } from './dedupe-pruebas';
import { enlaceEngarde } from './engarde-descargar';

const FASES = ['pools', 'tableau'] as const;
type Fase = (typeof FASES)[number];
type Estado = 'completo' | 'parcial' | 'sin_resultados' | 'ilegible';

export type ResumenHechos = {
  ruta: string;
  source: string;
  extractor: string;
  url: string;
  clave: string;
  torneo: string;
  weapon: string;
  gender: string;
  status: Record<'results' | Fase, Estado>;
  filas: Record<'results' | Fase, number>;
};

const sinFragmento = (u: string) => u.split('#')[0];

export function indexarHechos(raiz: string, carpetas: readonly string[]): ResumenHechos[] {
  const out: ResumenHechos[] = [];
  const recorrer = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const ruta = join(d, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('_')) {
        try {
          const h = JSON.parse(readFileSync(ruta, 'utf8'));
          if (h?.version !== 1 || !h.competition) continue;
          const bouts = (h.bouts ?? []) as { phase: string }[];
          out.push({
            ruta, source: h.source, extractor: h.extractor, url: sinFragmento(h.sourceUrl),
            clave: `${h.source}|${h.edition.season}|${h.competition.competitionKey}`, torneo: h.edition.tournamentKey,
            weapon: h.competition.weapon, gender: h.competition.gender,
            status: { results: h.status.results, pools: h.status.pools, tableau: h.status.tableau },
            filas: {
              results: (h.results ?? []).length,
              pools: bouts.filter((b) => b.phase === 'POULE').length,
              tableau: bouts.filter((b) => b.phase === 'TABLEAU').length,
            },
          });
        } catch {
          // Fichero a medio escribir o ajeno al formato: no cuenta.
        }
      }
    }
  };
  for (const c of carpetas) if (existsSync(join(raiz, c))) recorrer(join(raiz, c));
  return out;
}

type Enlace = { tipo: string; url: string };
type FilaCatalogo = { claveCatalogo: string; fuente: string; temporada: string; clavePrueba: string | null; enlaces?: Enlace[] };

export type FilaDiagnostico = {
  id: string; source: string; season: string; fecha: string; nombre: string; weapon: string; gender: string; category: string;
  resultados: number; pools: number; tableau: number; motivos: Partial<Record<Fase, string>>;
};

export type InformeDiagnostico = {
  desde: string;
  pruebas: number;
  conAsaltos: number;
  conAmbasFases: number;
  pct: number;
  porFuente: Record<string, { pruebas: number; conAsaltos: number; pct: number }>;
  motivos: Record<string, Record<string, number>>;
  principales: { pruebas: number; conAsaltos: number; pct: number; motivos: Record<string, number> };
  filas: FilaDiagnostico[];
};

const PRINCIPALES = new Set(['ABS', 'M23', 'M20', 'M17']);
export const esPrincipal = (nombre: string, categoria: string) =>
  PRINCIPALES.has(categoria) && /(campeonato|cto\.?|camp\.)\s*(de\s*)?espa|tnr|torneo\s+nacional|ranking|liga/i.test(nombre);

export function diagnosticar(db: DatabaseSync, opciones: {
  desde: string; hechos: ResumenHechos[]; catalogo: FilaCatalogo[]; cacheUrls: Set<string>; hasta?: string;
}): InformeDiagnostico {
  const hasta = opciones.hasta ?? new Date().toISOString().slice(0, 10);
  const pruebas = cargarPruebasNacionales(db, opciones.desde).filter((p) => p.resultados > 0 && p.fecha < hasta);
  const todas = cargarPruebasNacionales(db, '0000');
  const { grupos, gruposConVariasSkermo } = emparejarDuplicados(todas, 0.5, enlacesDelCatalogo(todas, opciones.catalogo));
  const grupoDe = new Map<string, typeof todas>();
  for (const g of [...grupos, ...gruposConVariasSkermo]) {
    const miembros = [g.destino, ...g.otras];
    for (const m of miembros) grupoDe.set(m.id, miembros);
  }
  const nombres = new Map((db.prepare(
    `SELECT c.id, e.name n, c.source_url u FROM sport_competition c JOIN sport_edition e ON e.id = c.edition_id`,
  ).all() as { id: string; n: string; u: string | null }[]).map((r) => [r.id, r]));
  const porClave = new Map<string, ResumenHechos[]>();
  const porUrl = new Map<string, ResumenHechos[]>();
  const porTorneo = new Map<string, ResumenHechos[]>();
  for (const h of opciones.hechos) {
    (porClave.get(h.clave) ?? porClave.set(h.clave, []).get(h.clave)!).push(h);
    (porUrl.get(h.url) ?? porUrl.set(h.url, []).get(h.url)!).push(h);
    (porTorneo.get(h.torneo) ?? porTorneo.set(h.torneo, []).get(h.torneo)!).push(h);
  }
  const catalogoPorClave = new Map<string, FilaCatalogo>();
  const catalogoPorUrl = new Map<string, FilaCatalogo[]>();
  for (const f of opciones.catalogo) {
    if (f.clavePrueba) catalogoPorClave.set(`${f.fuente}|${f.temporada}|${f.clavePrueba}`, f);
    for (const e of f.enlaces ?? []) {
      const u = sinFragmento(e.url);
      (catalogoPorUrl.get(u) ?? catalogoPorUrl.set(u, []).get(u)!).push(f);
    }
  }
  const claveSql = db.prepare(`SELECT competition_key k FROM sport_competition WHERE id=?`);

  const filas: FilaDiagnostico[] = [];
  for (const p of pruebas) {
    const info = nombres.get(p.id)!;
    const k = `${p.source}|${p.season}|${(claveSql.get(p.id) as { k: string }).k}`;
    const fila: FilaDiagnostico = {
      id: p.id, source: p.source, season: p.season, fecha: p.fecha, nombre: info.n, weapon: p.weapon, gender: p.gender,
      category: p.category, resultados: p.resultados, pools: p.asaltos.POULE, tableau: p.asaltos.TABLEAU, motivos: {},
    };
    const url = info.u ? sinFragmento(info.u) : null;
    const filasCat = [
      ...(catalogoPorClave.has(k) ? [catalogoPorClave.get(k)!] : []),
      ...(url ? catalogoPorUrl.get(url) ?? [] : []),
    ];
    const enlaces = filasCat.flatMap((f) => f.enlaces ?? []);
    const pdfs = [...new Set([...(p.source === 'rfee_pdf' && url ? [url] : []), ...enlaces.filter((e) => e.tipo === 'pdf').map((e) => sinFragmento(e.url))])];
    // Un PDF trae varias pruebas: de los hechos por URL sólo cuentan los de la misma arma y género,
    // y en rfee_pdf sólo los de su propia clave.
    const hechosDe = [
      ...(porClave.get(k) ?? []),
      ...(p.source === 'rfee_pdf' ? [] : pdfs.flatMap((u) => porUrl.get(u) ?? []).filter((h) => h.weapon === p.weapon && h.gender === p.gender)),
    ];
    const externos = enlaces.filter((e) => e.tipo === 'externo');
    for (const fase of FASES) {
      const n = fase === 'pools' ? p.asaltos.POULE : p.asaltos.TABLEAU;
      if (n > 0) continue;
      const faseBd = fase === 'pools' ? 'POULE' : 'TABLEAU';
      const g = grupoDe.get(p.id);
      let motivo: string;
      if (g && g.some((o) => o.id !== p.id && o.asaltos[faseBd] > 0)) motivo = 'duplicado_con_asaltos';
      else if (hechosDe.some((h) => h.filas[fase] > 0)) motivo = 'hechos_con_asaltos';
      else if (hechosDe.length > 0) {
        const estados = new Set(hechosDe.map((h) => h.status[fase]));
        motivo = estados.has('parcial') ? 'pdf_lectura_parcial'
          : estados.has('ilegible') ? 'pdf_lectura_ilegible'
          : `pdf_sin_${fase}`;
        if (p.source === 'engarde') motivo = `engarde_${[...estados].sort().join('+')}`;
      } else if (pdfs.length > 0) motivo = pdfs.some((u) => opciones.cacheUrls.has(u)) ? 'pdf_sin_leer' : 'pdf_sin_descargar';
      else if (externos.length > 0) {
        const torneos = externos.map((e) => enlaceEngarde(e.url)).filter((x) => x.tipo === 'torneo') as { org: string; evt: string }[];
        const conHechos = torneos.some((t) => (porTorneo.get(`engarde:${t.org}/${t.evt}`) ?? []).length > 0);
        motivo = torneos.length === 0 ? 'externo_no_engarde' : conHechos ? 'engarde_torneo_con_hechos' : 'engarde_sin_hechos';
      } else motivo = p.source === 'engarde' ? 'engarde_sin_fase' : 'sin_enlace';
      fila.motivos[fase] = motivo;
    }
    filas.push(fila);
  }
  const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
  const conAsaltos = filas.filter((f) => f.pools + f.tableau > 0).length;
  const porFuente: InformeDiagnostico['porFuente'] = {};
  const motivos: InformeDiagnostico['motivos'] = {};
  for (const f of filas) {
    const s = (porFuente[f.source] ??= { pruebas: 0, conAsaltos: 0, pct: 0 });
    s.pruebas += 1;
    if (f.pools + f.tableau > 0) s.conAsaltos += 1;
    for (const [fase, m] of Object.entries(f.motivos)) {
      const t = (motivos[`${f.source}:${fase}`] ??= {});
      t[m] = (t[m] ?? 0) + 1;
    }
  }
  for (const s of Object.values(porFuente)) s.pct = pct(s.conAsaltos, s.pruebas);
  const prin = filas.filter((f) => esPrincipal(f.nombre, f.category));
  const prinMotivos: Record<string, number> = {};
  for (const f of prin) {
    if (f.pools + f.tableau > 0) continue;
    const m = [...new Set(Object.values(f.motivos))].sort().join('+');
    prinMotivos[m] = (prinMotivos[m] ?? 0) + 1;
  }
  const prinCon = prin.filter((f) => f.pools + f.tableau > 0).length;
  return {
    desde: opciones.desde, pruebas: filas.length, conAsaltos,
    conAmbasFases: filas.filter((f) => f.pools > 0 && f.tableau > 0).length, pct: pct(conAsaltos, filas.length),
    porFuente, motivos,
    principales: { pruebas: prin.length, conAsaltos: prinCon, pct: pct(prinCon, prin.length), motivos: prinMotivos },
    filas,
  };
}

export const CARPETAS_HECHOS = ['pdf-lector', 'pdf-droid', 'rfee-huecos', 'rfee-wayback', 'engarde', 'engarde-historico', 'asaltos-rfee'];

function main(): void {
  const db = new DatabaseSync(argumento('db', NUEVO_POR_DEFECTO), { readOnly: true });
  const raiz = argumento('hechos', join(CARPETA_TRABAJO, 'hechos'));
  const inv = JSON.parse(readFileSync(argumento('inventario', join(CARPETA_CACHES, 'history-national', 'national-inventory.json')), 'utf8'));
  const cache = argumento('cache', join(CARPETA_CACHES, 'cache-rfee-2018'));
  const cacheUrls = new Set<string>();
  if (existsSync(join(cache, 'manifest.json'))) {
    for (const u of JSON.parse(readFileSync(join(cache, 'manifest.json'), 'utf8')).unidades ?? []) {
      if (u.estado === 'cached') cacheUrls.add(sinFragmento(u.url));
    }
  }
  const informe = diagnosticar(db, {
    desde: argumento('desde', '2017-01-01'), hechos: indexarHechos(raiz, CARPETAS_HECHOS), catalogo: inv.ownRfeeCatalog ?? [], cacheUrls,
  });
  db.close();
  const salida = argumento('informe', '');
  if (salida) writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ ...informe, filas: undefined }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
