/**
 * Lote 8c, Engarde: huecos RFEE de prioridad 1 (`cobertura/huecos-tras-lote8.json`) que no
 * tenían fuente conocida, buscados en torneos de Engarde que los lotes 7 y 8 no leyeron o no
 * pudieron atribuir: organizadores autonómicos y clubes (`fecyl`, `fce`, `clubesgrimalcobendas`),
 * el circuito europeo sub-23 «Fencing For Everyone» que el calendario nacional incluye
 * (`federscherma`, `rousseau`, `zheleznik`, `escrimeinfo`) y pruebas de `rfee` que el lote 7
 * descartó por un índice contradictorio o por divisiones de liga sin nombre.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8c-engarde.ts [--db <nuevo8.sqlite>] \
 *     [--torneos org/evt,...] [--salida <carpeta de hechos>]
 *
 * Para cada prueba del índice que coincide con un hueco (arma, categoría, modalidad, género,
 * fecha a ±2 días, división de liga y tramo de veteranos) se leen sus páginas y se escribe en
 * `hechos/lote8c-engarde/` si aporta alguna fase que al hueco le falta y no existe ya en
 * nuevo8 ni en otra carpeta de hechos. Reglas de escritura, las de `lote7-engarde-rfee.ts`.
 *
 * Validación: los asaltos con marcador imposible se descartan y se anotan; si son más del 10 %
 * de una fase, o el cuadro no es coherente (un tirador dos veces en una ronda, un perdedor que
 * sigue), la fase entera no se escribe. En individual, la clasificación se contrasta con la
 * oficial (Skermo o PDF de la RFEE) cuando existe: con menos del 80 % de puestos iguales entre
 * los tiradores comunes, la prueba no se escribe.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba } from '../../src/lib/ingest/hechos/formato';
import { parsearTorneoEngarde, urlPruebaEngarde, urlTorneoEngarde } from '../../src/lib/ingest/sources/engarde';
import { generoDeTitulo, tipoDocumentoEngarde } from '../../src/lib/ingest/sources/engarde-antiguo';
import { argumento, CARPETA_TRABAJO } from './comun';
import { consistenciaCuadro } from './cuadro-consistencia';
import { convertirPrueba, temporadaRfee, type Paginas, type PruebaIndice } from './engarde-a-hechos';
import { paginasDePrueba } from './engarde-descargar';
import {
  armaGeneroVeteranos, atributosDeCodigo, compatible, equivalentesNuevo7, fasesQueFaltan, fechaDePrueba, grupoEdad,
  repartirPoulesMixtas, solapeNombres, type Cobertura, type Equivalente,
} from './lote7-engarde-rfee';
import { encuentrosEngarde, podioDe, refsEquipos, type Documento } from './lote7-equipos-engarde';
import { abrirNuevo7, dia, EscritorHechos, INVENTARIO_NACIONAL } from './lote7-faltan-comun';
import { armaGeneroDeCodigo, divisionLiga, indice, validarAtributos, type Atributos } from './lote7-faltan-engarde';
import { asaltoValido } from './lote7-skermo-engarde';
import { HECHOS_LOTE8C, HUECOS_LOTE8, NUEVO8, redLote8c } from './lote8c-red';

/** Torneos revisados, con el motivo por el que se buscan aquí. */
export const TORNEOS_LOTE8C: readonly { torneo: string; por: string }[] = [
  { torneo: 'fce/tnrfabs2018', por: 'TNR florete ABS Barcelona 2018: equipos (enlace del catálogo a la exportación de fce)' },
  { torneo: 'rfee/190427tnr17florete', por: 'TNR M-17 Madrid 2019: florete equipos' },
  { torneo: 'fecyl/tnr_liga_tres_cantos_2021', por: 'Liga Nacional de Clubes de espada 2021 (organizada por fecyl en Tres Cantos)' },
  { torneo: 'rfee/tnrfloreteabs1_2021', por: 'Liga de clubes florete 1/5/2021: oro y plata sin división en el título' },
  { torneo: 'fce/tnrfloretamposta', por: 'Liga de clubes florete 22/5/2021 (organizada por fce en Amposta)' },
  { torneo: 'fecyl/tnr_valladolid_21-22', por: 'TNR ABS liga (1/3) 2021: equipos de espada (fecyl)' },
  { torneo: 'clubesgrimalcobendas/tnrfem', por: 'TNR ABS liga (2/3) 2021: espada femenina equipos (club organizador)' },
  { torneo: 'fecyl/tnr_olmedo_22-23', por: 'TNR M-20 equipos 2022 (fecyl en Olmedo)' },
  { torneo: 'rfee/cn2023', por: 'Criterium Nacional M-11 2023: florete y sable con poules mixtas' },
  { torneo: 'rfee/tnr_madrid_florete', por: 'Liga Plata florete masculino 29/4/2023 (Madrid)' },
  { torneo: 'fecyl/tnr_em_abs_medina23', por: 'TNR ABS (1/3) 2023 Liga Plata espada masculina (fecyl en Medina)' },
  { torneo: 'fecyl/tnr_zartan24', por: 'TNR M-20 (2/2) 2024: espada equipos (fecyl en Zaratán)' },
  { torneo: 'federscherma/brindisi2024', por: 'Fencing For Everyone florete, Brindisi 2024' },
  { torneo: 'rousseau/colmar_2024', por: 'Fencing For Everyone espada, Colmar 2024' },
  { torneo: 'fce/ffe24', por: 'Fencing For Everyone florete, Sabadell 2024' },
  { torneo: 'federscherma/udineffe', por: 'Fencing For Everyone sable, Udine 2025' },
  { torneo: 'zheleznik/ffe', por: 'Fencing For Everyone sable y espada, Sofía 2025' },
  { torneo: 'escrimeinfo/ffe2025', por: 'Fencing For Everyone florete, Antony 2025' },
  { torneo: 'rfee/ffe_sg', por: 'Fencing For Everyone sable, Segovia 2025 (índice con género contradictorio)' },
  { torneo: 'fecyl/ctoespsub20sub23', por: 'Campeonato de España M20 2026: equipos de florete y sable (fecyl en Roa)' },
  { torneo: 'fecyl/ce_sr25', por: 'Silla de ruedas 2025 (pruebas femeninas)' },
  { torneo: 'rfee/sr_vigo', por: 'Silla de ruedas 2025 (pruebas femeninas)' },
  { torneo: 'rfee/rsss', por: 'Silla de ruedas 2025 (pruebas femeninas)' },
  { torneo: 'rfee/cespv24', por: 'Campeonato de España de veteranos 2024 (categorías femeninas)' },
  { torneo: 'rfee/tlm_nov', por: 'TLM VET (1/3) 2024 (categorías femeninas)' },
  // Torneos ya leídos cuya lectura anterior dejó sin alguna fase (huecos «fuente sin esos datos»).
  ...[
    'fecyl/open_sr_22-23', 'rfee/rfee', 'rfee/sabadell', 'rfee/flo_mar', 'rfee/almagro', 'rfee/m20_madrid', 'rfee/valencia', 'rfee/tnr_sg', 'rfee/sle',
    'rfee/tnr_sable_bcn', 'rfee/sma_mad_11mar2023', 'rfee/tnrabssablemad2022', 'rfee/tnrabsfloretemad2022', 'rfee/tnrabsmad2021', 'rfee/tnr_ema_madrid',
    'rfee/tnrabsamposta2021', 'rfee/tnrm20madrid2021', 'rfee/tnrm20amposta2021', 'rfee/tnrsanse', 'rfee/crn26', 'rfee/fiberdrola', 'rfee/ceaf', 'fecyl/ctoespm17',
    'rfee/crn2025', 'fecyl/ce17soria25', 'rfee/ef_val', 'rfee/ema_madrid', 'rfee/sable_ss', 'rfee/tnr_flo', 'rfee/tlm_sc', 'rfee/tlm-amposta2022',
    'fce/tnrsm20bcn2019',
  ].map((torneo) => ({ torneo, por: 'Fase que faltaba en la lectura anterior de este torneo' })),
];

export type Hueco = {
  id: string; prioridad: number; fuente: string; temporada: string; fecha: string; nombre: string; arma: string; genero: string;
  categoria: string; formato: string; faltan: string[]; estadoBusqueda: string; categoriaOriginal: string | null;
};

const FASE_DE: Record<string, keyof Cobertura> = { clasificacion: 'resultados', poules: 'poules', cuadro: 'cuadro' };

/** División de liga del título o del código de la prueba («fmoro», «ema_liga_plata», «ef_eq_iber»). */
export function divisionDePrueba(titulo: string | null, compe: string): string | null {
  const t = divisionLiga(titulo);
  if (t) return t;
  const c = compe.toLowerCase();
  if (/4_?div|_4$|eq_4\b/.test(c)) return '4DIV';
  if (/oro/.test(c)) return 'ORO';
  if (/plata|_pla$|_pt$/.test(c)) return 'PLATA';
  if (/bronc/.test(c)) return 'BRONCE';
  if (/iber/.test(c)) return 'IBERDROLA';
  return divisionLiga(compe);
}

/** Tramo de veteranos de la fila del catálogo («VET70» → 70), o null. */
export const tramoVet = (categoriaOriginal: string | null): string | null => /VET\s*-?\+?(\d0)\b/i.exec(categoriaOriginal ?? '')?.[1] ?? null;

/**
 * La prueba de Engarde es la del hueco: mismo arma, categoría y modalidad, mismo género (una
 * prueba mixta no es la femenina ni la masculina), fecha a ±2 días, misma división de liga si
 * las dos la nombran y, en veteranos, un tramo de Engarde que contenga el de la fila.
 */
export function cubreHueco(h: Pick<Hueco, 'arma' | 'genero' | 'categoria' | 'formato' | 'fecha' | 'nombre' | 'categoriaOriginal'>, a: Atributos, grupo: string | null): boolean {
  if (h.arma !== a.weapon || h.categoria !== a.category || h.formato !== a.format || h.genero !== a.gender) return false;
  if (Math.abs(dia(h.fecha) - dia(a.fecha)) > 2) return false;
  const dh = divisionLiga(h.nombre);
  if (dh && a.division && dh !== a.division) return false;
  const v = h.categoria === 'VET' ? tramoVet(h.categoriaOriginal) : null;
  if (v && grupo?.startsWith('V') && !grupo.slice(1).split('-').includes(v)) return false;
  return true;
}

// ------------------------------------------------------------------ validación

const maxMarcador = (fase: AsaltoHecho['phase'], equipos: boolean) => (equipos ? 45 : fase === 'POULE' ? 5 : 15);

/** Motivo por el que un marcador es imposible, o null si es posible. */
export function marcadorImposible(b: Pick<AsaltoHecho, 'phase' | 'scoreA' | 'scoreB' | 'winner'>, equipos: boolean): string | null {
  const max = maxMarcador(b.phase, equipos);
  if (b.scoreA > max || b.scoreB > max) return `marcador por encima de ${max}`;
  if (equipos) {
    if (b.winner === null) return b.scoreA === b.scoreB ? 'empate sin ganador' : null;
    return (b.winner === 'A' ? b.scoreA >= b.scoreB : b.scoreB >= b.scoreA) ? null : 'gana quien tiene menos tocados';
  }
  if (asaltoValido(b)) return null;
  return b.winner === null ? 'empate sin ganador' : 'gana quien tiene menos tocados';
}

export type Validacion = { hechos: HechosPrueba; descartes: { fase: AsaltoHecho['phase']; ronda: string; a: string; b: string; marcador: string; motivo: string }[]; fasesRetiradas: string[] };

/**
 * Descarta los asaltos imposibles; si pasan del 10 % de una fase o el cuadro no es coherente,
 * retira la fase entera (no se puede leer con seguridad).
 */
export function validarPrueba(h: HechosPrueba): Validacion {
  const equipos = h.competition.format === 'EQUIPOS';
  const descartes: Validacion['descartes'] = [];
  const fasesRetiradas: string[] = [];
  let bouts = h.bouts.filter((b) => {
    const m = marcadorImposible(b, equipos);
    if (m) descartes.push({ fase: b.phase, ronda: b.roundKey, a: b.aName, b: b.bName, marcador: `${b.scoreA}-${b.scoreB}${b.winner ? ` (${b.winner})` : ''}`, motivo: m });
    return !m;
  });
  const status = { ...h.status, notes: [...h.status.notes] };
  for (const [fase, clave] of [['POULE', 'pools'], ['TABLEAU', 'tableau']] as const) {
    const total = h.bouts.filter((b) => b.phase === fase).length;
    const malos = descartes.filter((d) => d.fase === fase).length;
    if (total === 0) continue;
    let retirar = malos > total * 0.1;
    if (fase === 'TABLEAU' && !retirar) {
      const cuadro = bouts.filter((b) => b.phase === 'TABLEAU');
      const c = consistenciaCuadro(cuadro);
      if (c.incoherentes.size > 0) {
        retirar = true;
        status.notes.push(`Cuadro retirado por incoherente: ${JSON.stringify(c.motivos)}`);
      }
    }
    if (retirar) {
      bouts = bouts.filter((b) => b.phase !== fase);
      status[clave] = 'ilegible';
      fasesRetiradas.push(fase);
      status.notes.push(`${fase === 'POULE' ? 'Poules' : 'Cuadro'} no escrito: ${malos} de ${total} asaltos con marcador imposible o cuadro incoherente`);
    } else if (malos > 0) {
      status[clave] = 'parcial';
      status.notes.push(`${fase === 'POULE' ? 'Poules' : 'Cuadro'}: ${malos} asalto(s) descartado(s) por marcador imposible`);
    }
  }
  return { hechos: hechosPrueba.parse({ ...h, status, bouts }), descartes, fasesRetiradas };
}

/** Fracción de tiradores comunes con el mismo puesto en las dos clasificaciones; null si hay menos de 4 comunes. */
export function acuerdoClasificacion(a: readonly { name: string; position: number | null }[], b: readonly { name: string; position: number | null }[]): { comunes: number; iguales: number; acuerdo: number | null } {
  const pb = new Map<string, number | null>();
  for (const r of b) pb.set(normalizeSportName(r.name), r.position);
  let comunes = 0;
  let iguales = 0;
  for (const r of a) {
    const n = normalizeSportName(r.name);
    if (!pb.has(n) || r.position === null || pb.get(n) === null) continue;
    comunes += 1;
    if (pb.get(n) === r.position) iguales += 1;
  }
  return { comunes, iguales, acuerdo: comunes >= 4 ? iguales / comunes : null };
}

// ------------------------------------------------------------------ existentes

function* ficherosJson(carpeta: string): Generator<string> {
  for (const f of readdirSync(carpeta)) {
    const ruta = join(carpeta, f);
    if (statSync(ruta).isDirectory()) yield* ficherosJson(ruta);
    else if (f.endsWith('.json') && !f.startsWith('_')) yield ruta;
  }
}

/** Hechos de todas las carpetas `hechos/lote7-*`, `lote8-*`, `lote8b-*` y `lote8c-*` salvo `excluir` (sólo lectura). */
export function equivalentesHechos(raiz: string, excluir: readonly string[]): Equivalente[] {
  const out: Equivalente[] = [];
  if (!existsSync(raiz)) return out;
  for (const c of readdirSync(raiz)) {
    if (!/^lote(7|8|8b|8c)-/.test(c) || excluir.includes(c) || !statSync(join(raiz, c)).isDirectory()) continue;
    for (const ruta of ficherosJson(join(raiz, c))) {
      let h: HechosPrueba;
      try {
        h = JSON.parse(readFileSync(ruta, 'utf8')) as HechosPrueba;
      } catch {
        continue;
      }
      const comp = h?.competition;
      const fecha = comp?.date ?? h?.edition?.startDate;
      if (!comp || !fecha) continue;
      const nombres = [...new Set([...h.results.map((r) => r.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])].map(normalizeSportName).filter(Boolean))];
      out.push({
        origen: c, source: h.source, key: comp.competitionKey, weapon: comp.weapon, gender: comp.gender, category: comp.category, format: comp.format,
        d: dia(fecha), division: comp.format === 'EQUIPOS' ? divisionLiga(`${h.edition.name} ${comp.categoryRaw ?? ''} ${comp.competitionKey}`) : null,
        resultados: h.results.length, poules: h.bouts.filter((b) => b.phase === 'POULE').length, cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length,
        nombres: () => nombres,
      });
    }
  }
  return out;
}

/** Huecos RFEE de prioridad 1 con el tramo de veteranos de su fila del catálogo. */
export function leerHuecos(ruta = HUECOS_LOTE8, inventario = INVENTARIO_NACIONAL): Hueco[] {
  const j = JSON.parse(readFileSync(ruta, 'utf8')) as { huecos: Omit<Hueco, 'categoriaOriginal'>[] };
  const inv = existsSync(inventario)
    ? (JSON.parse(readFileSync(inventario, 'utf8')) as { ownRfeeCatalog: { claveCatalogo: string; categoriaOriginal?: string | null }[]; catalog: { claveCatalogo: string; categoriaOriginal?: string | null }[] })
    : { ownRfeeCatalog: [], catalog: [] };
  const propia = new Map(inv.ownRfeeCatalog.map((f) => [f.claveCatalogo, f.categoriaOriginal ?? null]));
  const ajena = new Map(inv.catalog.map((f) => [f.claveCatalogo, f.categoriaOriginal ?? null]));
  return j.huecos
    .filter((h) => h.prioridad === 1 && h.fuente === 'RFEE')
    .map((h) => {
      const clave = h.id.replace(/^rfee:(owa:)?/, '');
      return { ...h, categoriaOriginal: (h.id.startsWith('rfee:owa:') ? ajena : propia).get(clave) ?? null };
    });
}

// ------------------------------------------------------------------ lectura

type Prueba = { p: PruebaIndice; k: string; atributos: Atributos; grupo: string | null; nota: string | null; mixta: boolean };

/** Atributos de una prueba del índice con las mismas correcciones que `lote7-engarde-rfee.ts`. */
export function atributosDePrueba(p: PruebaIndice, tituloTorneo: string): { ok: true; x: Omit<Prueba, 'k'> } | { ok: false; motivo: string } {
  const legado = !p.titulo?.trim() && p.fecha ? atributosDeCodigo(p.compe, tituloTorneo) : null;
  if (legado && p.fecha) {
    const a: Atributos = { weapon: legado.weapon, gender: legado.gender, category: legado.category, format: legado.individual ? 'INDIVIDUAL' : 'EQUIPOS', fecha: p.fecha, division: null };
    return {
      ok: true,
      x: {
        p: { ...p, arma: a.weapon as PruebaIndice['arma'], generoFinal: a.gender as PruebaIndice['generoFinal'], categoriaFinal: a.category as PruebaIndice['categoriaFinal'], individual: legado.individual },
        atributos: a, grupo: grupoEdad(p.compe, a.category), mixta: false,
        nota: `Arma, género, categoría y modalidad deducidos del código «${p.compe}»`,
      },
    };
  }
  const v = validarAtributos(p);
  if (!v.ok) {
    // El índice de Engarde copia a veces el género de otra prueba («MEN´S SABRE», código «smind», con sexo femenino).
    const g = (generoDeTitulo(p.titulo ?? '') ?? armaGeneroDeCodigo(p.compe)?.gender ?? null) as PruebaIndice['generoFinal'];
    if (v.motivo !== 'atributos_contradictorios' || !g || g === p.generoFinal) return v;
    const v2 = validarAtributos({ ...p, generoFinal: g });
    if (!v2.ok) return v;
    return {
      ok: true,
      x: {
        p: { ...p, generoFinal: g as PruebaIndice['generoFinal'] }, atributos: { ...v2.atributos, division: divisionDePrueba(p.titulo, p.compe) },
        grupo: grupoEdad(p.titulo ?? p.compe, v2.atributos.category), mixta: g === 'MIXTO',
        nota: `Género según el título «${p.titulo}»; el índice de Engarde decía ${p.generoFinal}`,
      },
    };
  }
  let a: Atributos = { ...v.atributos, division: divisionDePrueba(p.titulo, p.compe) };
  let nota = v.corregido ? `Arma, género y categoría según el título publicado «${p.titulo}»; el índice de Engarde decía ${p.arma} ${p.generoFinal} ${p.categoriaFinal}` : null;
  const vet = a.category === 'VET' ? armaGeneroVeteranos(p.titulo ?? '', p.compe) : null;
  if (vet && (vet.weapon !== a.weapon || vet.gender !== a.gender)) {
    nota = `Arma y género según la abreviatura del título «${p.titulo}» o del código «${p.compe}»; el índice de Engarde decía ${p.arma} ${p.generoFinal}`;
    a = { ...a, ...vet };
  }
  if (a.division && a.format === 'INDIVIDUAL' && /liga|clubes|iberdrola/i.test(p.titulo ?? '')) {
    nota = [nota, 'Prueba de liga por equipos marcada como individual en el índice de Engarde'].filter(Boolean).join('; ');
    a = { ...a, format: 'EQUIPOS' };
  }
  const mixta = a.gender === 'MIXTO' || /\bmixt/i.test(p.titulo ?? '');
  return {
    ok: true,
    x: {
      p: { ...p, arma: a.weapon as PruebaIndice['arma'], generoFinal: a.gender as PruebaIndice['generoFinal'], categoriaFinal: a.category as PruebaIndice['categoriaFinal'], individual: a.format === 'INDIVIDUAL' },
      atributos: mixta ? { ...a, gender: 'MIXTO' } : a, grupo: grupoEdad(p.titulo?.trim() ? p.titulo : p.compe, a.category), nota, mixta,
    },
  };
}

/**
 * Cuadros de torneos internacionales: la primera columna separa nombre y nación
 * (`td.fencer` + `td.nation`), pero las siguientes escriben «WALTON Thomas GBR» en una sola
 * celda, y el lector de cuadros no reconoce al ganador. Se quita la nación final sólo si lo
 * que queda es un nombre de la primera columna.
 */
export function quitarNacionEnCuadro(html: string): string {
  if (!/country-container|class="[^"]*\bnation\b/.test(html)) return html;
  const $ = cheerio.load(html);
  const nombres = new Set<string>();
  $('table.tableau td.fencer').each((_, td) => {
    if ($(td).next('td').hasClass('nation')) nombres.add($(td).text().replace(/\s+/g, ' ').trim());
  });
  let cambios = 0;
  $('table.tableau td.fencer').each((_, td) => {
    const t = $(td).text().replace(/\s+/g, ' ').trim();
    const m = /^(.+) ([A-Z]{3})$/.exec(t);
    if (m && !nombres.has(t) && nombres.has(m[1])) {
      $(td).text(` ${m[1]} `);
      cambios += 1;
    }
  });
  return cambios > 0 ? $.html() : html;
}

/**
 * Páginas de Engarde en italiano (organizador `federscherma`): los lectores reconocen la
 * clasificación final y las poules por sus rótulos en español, francés o inglés. Sólo se
 * cambian los rótulos, nunca los datos.
 */
export function traducirRotulosItalianos(html: string): string {
  if (!/Classifica generale|Girone n/i.test(html)) return html;
  return html
    .replace(/Classifica generale/g, 'Classement général final')
    .replace(/(<th[^>]*>(?:&nbsp;|\s)*)Denominazione\/cognome((?:&nbsp;|\s)*<\/th>)/g, '$1Nom$2')
    .replace(/(<th[^>]*>(?:&nbsp;|\s)*)Nome((?:&nbsp;|\s)*<\/th>)/g, '$1Prénom$2')
    .replace(/(<th[^>]*>(?:&nbsp;|\s)*)Sigla\/zona\/interreg\.((?:&nbsp;|\s)*<\/th>)/g, '$1Nation$2')
    .replace(/Girone n°/g, 'Poule n°')
    .replace(/<th>V\/A<\/th>/g, '<th>V/M</th>');
}

/** Un grupo de edad de una poule mixta que cabe en el de un tablón («N2012» en «N2012-2013»). */
export const grupoContenido = (mixta: string | null, tablon: string | null): boolean =>
  !mixta || !tablon || mixta === tablon || mixta.slice(1).split('-').every((x) => tablon.slice(1).split('-').includes(x));

function equiposSinClasificacion(p: PruebaIndice, portada: string, ctx: { season: string; nombreTorneo: string; inicio: string | null; fin: string | null; ciudad: string | null }): HechosPrueba {
  return {
    version: 1, source: 'engarde', extractor: 'lector_engarde', sourceUrl: urlPruebaEngarde(p.org, p.evt, p.compe),
    sourceSha256: createHash('sha256').update(portada).digest('hex'),
    edition: { season: ctx.season, tournamentKey: `engarde:${p.org}/${p.evt}`, name: ctx.nombreTorneo, startDate: ctx.inicio, endDate: ctx.fin, city: ctx.ciudad, countryCode: p.pais && /^[A-Z]{3}$/.test(p.pais) ? p.pais : null },
    competition: { competitionKey: `engarde:${p.org}/${p.evt}/${p.compe}`, weapon: p.arma!, gender: p.generoFinal!, category: p.categoriaFinal!, categoryRaw: (p.categoriaOriginal ?? p.titulo) || null, format: 'EQUIPOS', date: p.fecha },
    status: { results: 'sin_resultados', pools: 'sin_resultados', tableau: 'sin_resultados', publishedParticipants: null, notes: ['Engarde no publica clasificación final para esta prueba'] },
    results: [],
    bouts: [],
  };
}

const coberturaDe = (h: HechosPrueba): Cobertura => ({
  resultados: h.results.length, poules: h.bouts.filter((b) => b.phase === 'POULE').length, cuadro: h.bouts.filter((b) => b.phase === 'TABLEAU').length,
});
const FUSIONA_CON_ENGARDE = new Set(['skermo_rfee', 'rfee_pdf']);

async function main(): Promise<void> {
  const hoy = new Date().toISOString().slice(0, 10);
  const salida = argumento('salida', HECHOS_LOTE8C('engarde'));
  const huecos = leerHuecos();
  const db = abrirNuevo7(argumento('db', NUEVO8));
  const base = equivalentesNuevo7(db);
  const porId = new Map<string, Equivalente[]>();
  const lotes = equivalentesHechos(join(CARPETA_TRABAJO, 'hechos'), ['lote8c-engarde']);
  // Una prueba FIE o EFC del mismo fin de semana (Copa del Mundo júnior...) no es la prueba nacional.
  const todos = [...base, ...lotes].filter((e) => e.source !== 'fie' && e.source !== 'efc');
  for (const e of todos) (porId.get(e.key) ?? porId.set(e.key, []).get(e.key)!).push(e);
  // Puestos de las clasificaciones oficiales, para contrastar.
  const puestosOficiales = db.prepare(`SELECT r.source_name name, r.position FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id WHERE c.competition_key = ? AND c.source = ?`);
  const red = redLote8c('engarde');
  const escritor = new EscritorHechos('lector_engarde_lote8c', salida);
  const pedidos = argumento('torneos', '').split(',').map((s) => s.trim()).filter(Boolean);
  const torneos = pedidos.length ? TORNEOS_LOTE8C.filter((t) => pedidos.includes(t.torneo)) : TORNEOS_LOTE8C;

  const porHueco = new Map<string, { hueco: Hueco; lecturas: Record<string, unknown>[] }>();
  const anotarHueco = (h: Hueco, x: Record<string, unknown>) => (porHueco.get(h.id) ?? porHueco.set(h.id, { hueco: h, lecturas: [] }).get(h.id)!).lecturas.push(x);
  const informeTorneos: Record<string, unknown>[] = [];
  const escritos: Record<string, unknown>[] = [];
  const descartesMarcador: Record<string, unknown>[] = [];

  for (const { torneo, por } of torneos) {
    const [org, evt] = torneo.split('/');
    const it: Record<string, unknown> = { torneo, por, pruebas: [] as unknown[] };
    informeTorneos.push(it);
    const ps = await indice(red, org, evt);
    if (ps.length === 0) {
      it.resultado = 'sin_indice';
      continue;
    }
    const torHtml = await red.get(urlTorneoEngarde(org, evt));
    const tituloLista = torHtml.status === 200 ? parsearTorneoEngarde(torHtml.body.toString('utf8')).nombre : null;
    const nombreTorneo = tituloLista ?? torneo;
    const pruebas: Prueba[] = [];
    const portadas = new Map<string, string | null>();
    for (const p0 of ps) {
      const r = await red.get(urlPruebaEngarde(org, evt, p0.compe));
      const portada = r.status === 200 ? traducirRotulosItalianos(r.body.toString('utf8')) : null;
      portadas.set(p0.compe, portada);
      const p = { ...p0, fecha: fechaDePrueba(p0.fecha, portada, null) };
      const a = atributosDePrueba(p, nombreTorneo);
      if (!a.ok) {
        (it.pruebas as unknown[]).push({ compe: p0.compe, titulo: p0.titulo, motivo: a.motivo });
        continue;
      }
      pruebas.push({ ...a.x, k: `engarde:${org}/${evt}/${p0.compe}` });
    }
    const fechas = pruebas.map((x) => x.atributos.fecha).sort();
    const fin = fechas.at(-1) ?? null;
    if (fin && fin >= hoy) {
      it.resultado = 'torneo_sin_terminar';
      continue;
    }

    const objetivo = pruebas.map((x) => ({ x, huecos: x.mixta ? [] : huecos.filter((h) => cubreHueco(h, x.atributos, x.grupo)) }));
    // Poules mixtas que alimentan un tablón por género que cubre un hueco (Criterium Nacional).
    const leer = new Set(objetivo.filter((o) => o.huecos.length > 0).map((o) => o.x.k));
    for (const o of objetivo) {
      if (!o.x.mixta || o.x.atributos.format !== 'INDIVIDUAL') continue;
      if (objetivo.some((t) => leer.has(t.x.k) && t.x.atributos.weapon === o.x.atributos.weapon && t.x.atributos.category === o.x.atributos.category &&
        Math.abs(dia(t.x.atributos.fecha) - dia(o.x.atributos.fecha)) <= 1 && grupoContenido(o.x.grupo, t.x.grupo))) leer.add(o.x.k);
    }
    for (const o of objetivo) {
      if (!leer.has(o.x.k)) (it.pruebas as unknown[]).push({ compe: o.x.p.compe, titulo: o.x.p.titulo, atributos: `${o.x.atributos.weapon} ${o.x.atributos.gender} ${o.x.atributos.category} ${o.x.atributos.format}`, motivo: o.x.mixta ? 'prueba_mixta' : 'sin_hueco' });
    }

    const leidas = new Map<string, { x: Prueba; h: HechosPrueba | null; motivo?: string }>();
    for (const o of objetivo) {
      if (!leer.has(o.x.k)) continue;
      const { p, k, atributos } = o.x;
      const portada = portadas.get(p.compe) ?? null;
      if (portada === null || /currently has no data/i.test(portada)) {
        leidas.set(k, { x: o.x, h: null, motivo: portada === null ? 'sin_pagina_de_prueba' : 'engarde_sin_datos' });
        continue;
      }
      const paginas: Paginas = { prueba: portada, clasfinal: null, poules: [], cuadros: [], faltan: [] };
      const docs: Documento[] = [];
      for (const f of paginasDePrueba(portada, org, evt, p.compe).slice(0, 24)) {
        const url = `${urlPruebaEngarde(org, evt, p.compe)}/${f}`;
        const r = await red.get(url);
        if (r.status !== 200) {
          paginas.faltan.push(f);
          continue;
        }
        const np = f.match(/^poules(\d+)\.htm$/i);
        const leido = traducirRotulosItalianos(r.body.toString('utf8'));
        const cuerpo = !np && /^tableau/i.test(f) ? quitarNacionEnCuadro(leido) : leido;
        if (/^clasfinal\.htm$/i.test(f)) paginas.clasfinal = cuerpo;
        else if (np) paginas.poules.push({ pagina: Number(np[1]), html: cuerpo });
        else paginas.cuadros.push({ url, html: cuerpo });
        const tipo = tipoDocumentoEngarde(f);
        if (tipo === 'poules' || tipo === 'cuadro') docs.push({ url, html: cuerpo, tipo, pagina: np ? Number(np[1]) : 1, antiguo: false });
      }
      const ctx = { season: temporadaRfee(atributos.fecha), nombreTorneo, inicio: fechas[0] ?? atributos.fecha, fin: fin ?? atributos.fecha, ciudad: p.ciudad };
      const r = convertirPrueba(o.x.mixta ? { ...p, generoFinal: 'MIXTO' } : p, paginas, ctx);
      let h: HechosPrueba | null = r.ok ? r.hechos : null;
      if (atributos.format === 'EQUIPOS' && docs.length > 0) {
        const refs = h && h.results.length > 0 ? refsEquipos(h.results) : (n: string) => (normalizeSportName(n) ? `engarde:equipo:${normalizeSportName(n)}` : null);
        const eq = encuentrosEngarde(docs, paginas.faltan, refs, podioDe(h?.results ?? []));
        if (eq.bouts.length > 0) {
          h ??= equiposSinClasificacion(p, portada, ctx);
          h.bouts = eq.bouts as AsaltoHecho[];
          h.status.pools = eq.pools;
          h.status.tableau = eq.tableau;
          h.status.notes = h.status.notes.filter((n) => !/no se importan asaltos individuales/.test(n)).concat(eq.notas);
        }
      }
      if (h && o.x.nota) h.status.notes.push(o.x.nota);
      leidas.set(k, { x: o.x, h, motivo: h ? undefined : r.ok ? 'sin_hechos' : r.motivo });
    }

    for (const o of objetivo) {
      if (o.huecos.length === 0) continue;
      const l = leidas.get(o.x.k)!;
      const { x } = l;
      const fila: Record<string, unknown> = { compe: x.p.compe, titulo: x.p.titulo, atributos: `${x.atributos.weapon} ${x.atributos.gender} ${x.atributos.category} ${x.atributos.format}${x.grupo ? ` ${x.grupo}` : ''}${x.atributos.division ? ` ${x.atributos.division}` : ''}`, fecha: x.atributos.fecha, huecos: o.huecos.map((h) => h.id) };
      (it.pruebas as unknown[]).push(fila);
      const cerrar = (motivo: string, extra: Record<string, unknown> = {}) => {
        Object.assign(fila, { motivo, ...extra });
        for (const h of o.huecos) anotarHueco(h, { prueba: x.k, url: urlPruebaEngarde(org, evt, x.p.compe), motivo, ...extra });
      };
      if (!l.h) {
        cerrar(l.motivo ?? 'sin_hechos');
        continue;
      }
      let h: HechosPrueba = l.h;
      // Poules mixtas del mismo arma y grupo de edad (Criterium Nacional).
      if (x.atributos.format === 'INDIVIDUAL' && h.bouts.every((b) => b.phase !== 'POULE')) {
        const mixtas = objetivo.filter((m) => m.x.mixta && leidas.get(m.x.k)?.h && m.x.atributos.weapon === x.atributos.weapon && m.x.atributos.category === x.atributos.category &&
          Math.abs(dia(m.x.atributos.fecha) - dia(x.atributos.fecha)) <= 1 && grupoContenido(m.x.grupo, x.grupo));
        if (mixtas.length > 0) {
          const union: HechosPrueba = structuredClone(leidas.get(mixtas[0].x.k)!.h!);
          union.bouts = mixtas.flatMap((m) => leidas.get(m.x.k)!.h!.bouts.filter((b) => b.phase === 'POULE').map((b) => ({ ...b, roundKey: mixtas.length > 1 ? `${m.x.p.compe}:${b.roundKey}` : b.roundKey })));
          union.competition.competitionKey = mixtas.map((m) => m.x.k).join('+');
          h = repartirPoulesMixtas(union, [h])[0];
        }
      }
      const val = validarPrueba(h);
      h = val.hechos;
      if (val.descartes.length > 0) descartesMarcador.push({ prueba: x.k, descartes: val.descartes, fasesRetiradas: val.fasesRetiradas });
      const e = coberturaDe(h);
      const necesita = [...new Set(o.huecos.flatMap((g) => g.faltan.map((f) => FASE_DE[f]).filter(Boolean)))];
      if (!necesita.some((f) => e[f] > 0)) {
        cerrar('fuente_sin_esos_datos', { engarde: e, faltan: o.huecos.map((g) => g.faltan.join('+')) });
        continue;
      }
      const nombresE = [...new Set([...h.results.map((y) => y.name), ...h.bouts.flatMap((b) => [b.aName, b.bName])].map(normalizeSportName).filter(Boolean))];
      const mismaClave = porId.get(x.k) ?? [];
      // Un campeonato por equipos sin división no es la jornada de liga (oro, plata, Iberdrola) del mismo fin de semana.
      const campeonato = !x.atributos.division && /campeonato|\bcto\b|\bcesp\b/i.test(`${x.p.titulo ?? ''} ${nombreTorneo}`);
      const mismos = todos.filter((c) => c.key !== x.k && compatible(x.atributos, c) && !(campeonato && x.atributos.format === 'EQUIPOS' && c.division))
        .map((c) => ({ c, s: x.atributos.format === 'INDIVIDUAL' ? solapeNombres(nombresE, c.nombres()) : null }))
        .filter((y) => y.s === null || y.s >= 0.3);
      const equivalentes = [...mismaClave, ...mismos.map((y) => y.c)];
      const ex: Cobertura = {
        resultados: Math.max(0, ...equivalentes.map((y) => y.resultados)), poules: Math.max(0, ...equivalentes.map((y) => y.poules)), cuadro: Math.max(0, ...equivalentes.map((y) => y.cuadro)),
      };
      const faltan = fasesQueFaltan(e, ex);
      const info = { engarde: e, existente: ex, equivalentes: equivalentes.map((y) => `${y.origen}:${y.source}:${y.key}`).slice(0, 5) };
      if (equivalentes.length > 0 && faltan.length === 0) {
        cerrar('ya_cubierta', info);
        continue;
      }
      if (equivalentes.length > 0) {
        const fusionable = mismaClave.length > 0 ||
          (x.atributos.format === 'INDIVIDUAL' && mismos.some((y) => y.c.origen === 'nuevo7' && FUSIONA_CON_ENGARDE.has(y.c.source) && y.s !== null && y.s >= 0.5));
        if (!fusionable) {
          cerrar(x.atributos.format === 'INDIVIDUAL' ? 'fase_falta_sin_fusion_segura' : 'fase_falta_equipos_otra_fuente', { ...info, faltan });
          continue;
        }
      }
      // Contraste con la clasificación oficial que ya está en la base.
      let contraste: Record<string, unknown> | null = null;
      const oficial = mismos.find((y) => y.c.origen === 'nuevo7' && FUSIONA_CON_ENGARDE.has(y.c.source) && y.c.resultados > 0);
      if (oficial && h.results.length > 0) {
        const filas = puestosOficiales.all(oficial.c.key, oficial.c.source) as { name: string; position: number | null }[];
        const ac = acuerdoClasificacion(h.results, filas);
        contraste = { oficial: `${oficial.c.source}:${oficial.c.key}`, ...ac };
        if (ac.acuerdo !== null && ac.acuerdo < 0.8) {
          cerrar('clasificacion_discrepa_de_la_oficial', { ...info, contraste });
          continue;
        }
      }
      h.extractor = 'lector_engarde_lote8c';
      h.status.notes.push(`Lote 8c: ${por}`);
      if (contraste) h.status.notes.push(`Clasificación contrastada con ${contraste.oficial}: ${contraste.iguales}/${contraste.comunes} puestos iguales`);
      else if (h.results.length > 0) h.status.notes.push('Sin clasificación oficial en la base con la que contrastar');
      const fichero = escritor.escribir(h);
      todos.push({ origen: 'lote8c-engarde', source: 'engarde', key: x.k, weapon: x.atributos.weapon, gender: x.atributos.gender, category: x.atributos.category, format: x.atributos.format, d: dia(x.atributos.fecha), division: x.atributos.division ?? null, ...e, nombres: () => nombresE });
      escritos.push({ fichero, prueba: x.k, ...e, huecos: o.huecos.map((g) => g.id) });
      cerrar(equivalentes.length === 0 ? 'escrita_falta_entera' : `escrita_fases_${faltan.join('_')}`, { fichero, ...info, contraste, descartes: val.descartes.length });
    }
  }
  db.close();
  escritor.limpiarAntiguos();
  const resumen = {
    generado: new Date().toISOString(), torneos: torneos.length, ficheros: escritor.total, peticiones: red.peticiones, cacheBytes: red.tamano(),
    asaltos: { POULE: escritos.reduce((s, x) => s + Number(x.poules), 0), TABLEAU: escritos.reduce((s, x) => s + Number(x.cuadro), 0) },
    puestos: escritos.reduce((s, x) => s + Number(x.resultados), 0),
    escritos, huecos: [...porHueco.values()].map(({ hueco, lecturas }) => ({ id: hueco.id, fecha: hueco.fecha, nombre: hueco.nombre, prueba: `${hueco.arma} ${hueco.genero} ${hueco.categoria}${hueco.categoriaOriginal && hueco.categoriaOriginal !== hueco.categoria ? ` (${hueco.categoriaOriginal})` : ''} ${hueco.formato}`, estado: hueco.estadoBusqueda, faltan: hueco.faltan, lecturas })),
    descartesMarcador, torneosDetalle: informeTorneos,
  };
  escritor.informe('lote8c-engarde', resumen);
  console.log(JSON.stringify({ ...resumen, huecos: resumen.huecos.length, torneosDetalle: undefined, escritos: escritos.map((x) => `${x.prueba} r${x.resultados} p${x.poules} c${x.cuadro}`) }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
