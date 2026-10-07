/**
 * Clasificaciones oficiales de la web antigua de la FIE (fie.ch, 2006-2014)
 * archivadas en la Wayback Machine, para las pruebas FIE que la base tiene sin
 * ningún puesto (la API actual de la FIE no las devuelve).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-fiech.ts descargar
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote10-fie-fiech.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * `Competitions/ResultsList.aspx?Key=<clave>` publica la cabecera de la prueba
 * (Competition, Place, Date, Category, Weapon, Gender, Event) y la lista de
 * puestos (Rank, Pts, Name, Nationality, Birth, Licence). `descargar` baja la
 * última captura 200 de cada clave (2006-2014); `hechos` trabaja sin red: cada
 * página se casa con la única prueba FIE sin puestos de su arma, género,
 * categoría y modalidad cuya fecha está a ±3 días, y se escribe con las claves
 * existentes. `factKey` = ID FIE de la única persona FIE con el mismo nombre,
 * nación y género (si no, `fiech:<licencia FIE>`); por equipos,
 * `team:fiech:<nación>`. Una lista sin puestos crecientes desde 1 no se escribe.
 */
import * as cheerio from 'cheerio';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hechosPrueba, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { argumento } from './comun';
import { fieIdPorNombre, indicePersonasFie } from './fie-huecos-objetivos';
import { abrirBase, escribirHechos, HOY, plegar, pruebasFie, type PruebaBase } from './lote10-fie-comun';
import { CACHE_LOTE10_FIE, cdx, enCache, NUEVO9, obtener, salidaLote10Fie, urlWayback } from './lote10-fie-red';

/** Misma ciudad con otra grafía («St-Petersbourg» / «St Petersbourg», «Göteborg» / «Goteborg», «Pékin» / «Pekin»). */
export function mismaCiudad(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const x = plegar(a).replace(/ /g, '');
  const y = plegar(b).replace(/ /g, '');
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))) return true;
  const d: number[] = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let previo = d[0];
    d[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, previo + (x[i - 1] === y[j - 1] ? 0 : 1));
      previo = t;
    }
  }
  return 1 - d[y.length] / Math.max(x.length, y.length) >= 0.8;
}

const MANIFIESTO = join(CACHE_LOTE10_FIE, 'fiech-manifiesto.json');
const INFORME = join(CACHE_LOTE10_FIE, 'fiech-informe.json');

type Arma = HechosPrueba['competition']['weapon'];
type Genero = HechosPrueba['competition']['gender'];
type Categoria = HechosPrueba['competition']['category'];
type Formato = HechosPrueba['competition']['format'];

export type ListaFiech = {
  competicion: string; lugar: string; fecha: string | null;
  categoria: Categoria | null; arma: Arma | null; genero: Genero | null; formato: Formato | null;
  filas: { puesto: number | null; puestoTexto: string; puntos: string | null; nombre: string; nacion: string | null; licencia: string | null }[];
};

const limpio = (s: string) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

export function parsearListaFiech(html: string): ListaFiech | null {
  const $ = cheerio.load(html);
  const v = (id: string) => limpio($(`#${id}`).first().text());
  const competicion = v('labNameDat');
  if (!competicion) return null;
  const f = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v('labDtBeginDat'));
  const cat = v('labFencerCatDat').toLowerCase();
  const arma = v('labWeaponDat').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const sexo = v('labSexDat').toUpperCase();
  const tipo = v('labContestTypeDat').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const filas: ListaFiech['filas'] = [];
  const tabla = $('#Table2');
  tabla.find('tr').each((_, tr) => {
    const td = $(tr).children('td');
    if (td.length < 4) return;
    const puestoTexto = limpio(td.eq(0).text());
    if (!/^\d{1,3}$/.test(puestoTexto) && !/^(DNS|DNF|EXC|ABS)/i.test(puestoTexto)) return;
    const puntos = limpio(td.eq(1).text());
    const nacion = limpio(td.eq(3).text());
    const licencia = limpio(td.eq(5).text());
    filas.push({
      puesto: /^\d+$/.test(puestoTexto) ? Number(puestoTexto) : null, puestoTexto,
      puntos: /^\d+(\.\d+)?$/.test(puntos) ? puntos : null,
      nombre: limpio(td.eq(2).text()), nacion: /^[A-Z]{3}$/.test(nacion) ? nacion : null,
      licencia: /^\d{6,}$/.test(licencia) ? licencia : null,
    });
  });
  return {
    competicion, lugar: v('labLocalDat'), fecha: f ? `${f[3]}-${f[2]}-${f[1]}` : null,
    categoria: /cadet/.test(cat) ? 'M17' : /junior/.test(cat) ? 'M20' : /senior/.test(cat) ? 'ABS' : /veteran/.test(cat) ? 'VET' : null,
    arma: /epee/.test(arma) ? 'ESPADA' : /foil|fleuret/.test(arma) ? 'FLORETE' : /sab/.test(arma) ? 'SABLE' : null,
    genero: sexo === 'M' ? 'M' : sexo === 'F' ? 'F' : null,
    formato: /individ/.test(tipo) ? 'INDIVIDUAL' : /team|equip/.test(tipo) ? 'EQUIPOS' : null,
    filas,
  };
}

/** Puestos crecientes desde 1 (con empates) y nombres no vacíos. */
export function listaCoherente(l: ListaFiech): boolean {
  const ps = l.filas.map((f) => f.puesto).filter((p): p is number => p !== null);
  if (ps.length < 2 || ps[0] !== 1 || l.filas.some((f) => !f.nombre)) return false;
  for (let i = 1; i < ps.length; i += 1) if (ps[i] < ps[i - 1] || ps[i] > i + 1) return false;
  return true;
}

type Manifiesto = { generado: string; capturas: { clave: string; timestamp: string; original: string }[] };

async function descargar() {
  const capturas = await cdx('fie.ch/Competitions/ResultsList.aspx', { matchType: 'prefix', filter: 'statuscode:200', from: '2006', to: '2014', limit: '100000' });
  const ultima = new Map<string, { timestamp: string; original: string }>();
  for (const c of capturas) {
    const k = /[?&]Key=([0-9A-F]{20,40})\b/i.exec(c.original)?.[1]?.toUpperCase();
    if (!k || c.length < 3000) continue;
    const previa = ultima.get(k);
    if (!previa || c.timestamp > previa.timestamp) ultima.set(k, { timestamp: c.timestamp, original: c.original });
  }
  console.log(`${capturas.length} capturas, ${ultima.size} claves`);
  const man: Manifiesto = { generado: new Date().toISOString(), capturas: [...ultima].map(([clave, c]) => ({ clave, ...c })) };
  let n = 0;
  for (const c of man.capturas) {
    await obtener(urlWayback(c.timestamp, c.original));
    n += 1;
    if (n % 50 === 0) console.log(`  ${n}/${man.capturas.length}`);
  }
  writeFileSync(MANIFIESTO, `${JSON.stringify(man, null, 1)}\n`);
  console.log(`manifiesto en ${MANIFIESTO}`);
}

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);
const PAIS = /^[A-Z]{3}$/;

function hechos() {
  const db = abrirBase(argumento('db', NUEVO9));
  const salida = argumento('salida', salidaLote10Fie('fiech'));
  if (!existsSync(MANIFIESTO)) throw new Error(`falta ${MANIFIESTO}: ejecuta antes «descargar»`);
  const man = JSON.parse(readFileSync(MANIFIESTO, 'utf8')) as Manifiesto;
  const todas = pruebasFie(db).filter((p) => {
    const f = p.date ?? p.startDate;
    return f && f < HOY;
  });
  const vacias = todas.filter((p) => p.resultados === 0);
  const indice = indicePersonasFie(db);
  db.close();
  const informe: { clave: string; motivo: string; prueba?: string; fie?: string; filas?: number }[] = [];
  const usadas = new Set<string>();
  let escritos = 0;
  let filasEscritas = 0;
  for (const c of man.capturas) {
    const url = urlWayback(c.timestamp, c.original);
    const d = enCache(url);
    if (!d?.bytes || !d.sha256) continue;
    const l = parsearListaFiech(new TextDecoder('utf-8').decode(d.bytes));
    if (!l) {
      informe.push({ clave: c.clave, motivo: 'pagina_sin_prueba' });
      continue;
    }
    const prueba = `${l.competicion} | ${l.lugar} | ${l.fecha} | ${l.categoria} ${l.arma} ${l.genero} ${l.formato}`;
    if (!l.fecha || !l.arma || !l.genero || !l.formato || !l.categoria) {
      informe.push({ clave: c.clave, prueba, motivo: 'cabecera_incompleta' });
      continue;
    }
    const misma = (p: PruebaBase, dias: number) => p.weapon === l.arma && p.gender === l.genero && p.format === l.formato
      && p.category === l.categoria && mismaCiudad(p.city, l.lugar) && Math.abs(dia((p.date ?? p.startDate)!) - dia(l.fecha!)) <= dias;
    // La API de la FIE duplica algunas pruebas (JJOO de 2008: «JO» con puestos y «SF-IND» vacía): si la misma
    // prueba ya tiene clasificación, la vacía es un duplicado y no se rellena.
    const conPuestos = todas.filter((p) => p.resultados > 0 && misma(p, 7));
    if (conPuestos.length) {
      informe.push({ clave: c.clave, prueba, motivo: `la_prueba_ya_tiene_puestos:${conPuestos.map((p) => `${p.season}:${p.competitionKey}`).join(',')}` });
      continue;
    }
    const cand = vacias.filter((p) => misma(p, 3));
    if (cand.length !== 1) {
      informe.push({
        clave: c.clave, prueba,
        motivo: cand.length ? `varias_pruebas_fie_sin_puestos:${cand.map((p) => `${p.season}:${p.competitionKey}`).join(',')}` : 'sin_prueba_fie_vacia_en_esa_ciudad_y_fecha',
      });
      continue;
    }
    const p: PruebaBase = cand[0];
    const fie = `${p.season}:${p.competitionKey}`;
    if (!listaCoherente(l)) {
      informe.push({ clave: c.clave, prueba, fie, motivo: 'lista_incoherente' });
      continue;
    }
    if (usadas.has(fie)) {
      informe.push({ clave: c.clave, prueba, fie, motivo: 'prueba_ya_escrita_desde_otra_clave' });
      continue;
    }
    usadas.add(fie);
    const results: HechosPrueba['results'] = l.filas.map((f, i) => {
      const fieId = p.format === 'INDIVIDUAL' ? fieIdPorNombre(indice, f.nombre, f.nacion, p.gender) : null;
      const factKey = p.format === 'EQUIPOS'
        ? `team:fiech:${f.nacion ?? f.nombre.toLowerCase().replace(/[^a-z]+/g, '-')}`
        : fieId ?? (f.licencia ? `fiech:${f.licencia}` : `fiech:${c.clave}:${i + 1}`);
      return {
        factKey, name: f.nombre, countryCode: f.nacion && PAIS.test(f.nacion) ? f.nacion : null, club: null,
        position: f.puesto, positionRaw: f.puestoTexto, points: f.puntos, fieId, license: null, birthYear: null,
      };
    });
    const vinculados = results.filter((r) => r.fieId).length;
    const h = hechosPrueba.parse({
      version: 1, source: 'fie', extractor: 'lote10_fiech', sourceUrl: url, sourceSha256: d.sha256,
      edition: {
        season: p.season, tournamentKey: p.tournamentKey, name: p.editionName, startDate: p.startDate, endDate: p.endDate,
        city: p.city, countryCode: p.countryCode && PAIS.test(p.countryCode) ? p.countryCode : null,
      },
      competition: { competitionKey: p.competitionKey, weapon: p.weapon, gender: p.gender, category: p.category, categoryRaw: p.categoryRaw, format: p.format, date: p.date },
      status: {
        results: 'completo', pools: 'parcial', tableau: 'parcial', publishedParticipants: results.length,
        notes: [
          `Lote 10: clasificación oficial de la web antigua de la FIE (fie.ch, Competitions/ResultsList.aspx?Key=${c.clave}, captura ${c.timestamp} de la Wayback Machine): «${l.competicion}», ${l.lugar}, ${l.fecha}; la API actual de la FIE no la devuelve`,
          p.format === 'INDIVIDUAL'
            ? `${vinculados} de ${results.length} puestos con factKey = ID FIE de la única persona FIE con el mismo nombre, nación y género; el resto, fiech:<licencia FIE publicada>`
            : 'Equipos con factKey team:fiech:<nación>',
        ],
      },
      results,
      bouts: [],
    });
    escribirHechos(salida, h);
    escritos += 1;
    filasEscritas += results.length;
    informe.push({ clave: c.clave, prueba, fie, motivo: 'escrita', filas: results.length });
  }
  const motivos: Record<string, number> = {};
  for (const i of informe) motivos[i.motivo.split(':')[0]] = (motivos[i.motivo.split(':')[0]] ?? 0) + 1;
  writeFileSync(INFORME, `${JSON.stringify({ generado: new Date().toISOString(), escritos, filas: filasEscritas, motivos, paginas: informe }, null, 1)}\n`);
  for (const i of informe.filter((x) => x.motivo !== 'pagina_sin_prueba')) console.log(`${i.clave} ${i.fie ?? '-'} ${i.motivo} ${i.prueba ?? ''}${i.filas ? ` (${i.filas} puestos)` : ''}`);
  console.log(`${escritos} ficheros (${filasEscritas} puestos) en ${salida}; informe en ${INFORME}`);
  console.log(JSON.stringify(motivos));
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await descargar();
  else if (orden === 'hechos') hechos();
  else throw new Error('uso: lote10-fie-fiech.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
