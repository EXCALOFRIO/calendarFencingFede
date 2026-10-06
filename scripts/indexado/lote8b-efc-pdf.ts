/**
 * PDF de resultados del circuito EFC que el lote 8 dejó como `pdf_sin_lector`
 * (`hechos/lote8-efc/_informe.json`). Sólo lee la caché del lote 8: no descarga.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote8b-efc-pdf.ts
 *
 * Tres generadores:
 * - Engarde (francés, italiano o inglés): se traducen los títulos de sección y las etiquetas de
 *   columna al inglés que reconoce el lector de PDF de la RFEE, se sustituye la cabecera de cada
 *   página por una sintética con arma, género, categoría y fecha (un PDF de la EFC es una sola
 *   prueba) y se usa ese lector: clasificación, poules validadas por los totales de la matriz y
 *   cuadro.
 * - FencingTime: sólo la clasificación final (FE_FIE_0012). Sus hojas de poule salen sin marcador
 *   y el cuadro no trae nombres ni tocados en la capa de texto.
 * - Ophardt: clasificación final («Final placement») y poules (FE_FIE_0007) cuando cada fila cuadra
 *   con sus V, TD y TR publicados. El cuadro no se lee.
 * Toda la prueba pasa además por comprobaciones propias: puestos 1, 2, 3T… sin saltos imposibles,
 * nombre y país en cada fila, marcadores posibles y cuadro coherente con la clasificación. Lo que
 * no las pasa no se escribe y queda anotado en `_informe.json`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSportName } from '../../src/lib/identity/resolver';
import { ficheroHechos, hechosPrueba, type AsaltoHecho, type HechosPrueba, type ResultadoHecho } from '../../src/lib/ingest/hechos/formato';
import { agruparFilas, fusionarFragmentos, limpiarItems, normalizar, textoFila, type Fila } from '../../src/lib/ingest/sources/rfee-pdf/geometria';
import { extraerPaginas } from '../../src/lib/ingest/sources/rfee-pdf/lectura';
import { leerClasificacion } from '../../src/lib/ingest/sources/rfee-pdf/clasificacion';
import { analizarPagina } from '../../src/lib/ingest/sources/rfee-pdf/paginas';
import { leerResultadosPdf } from '../../src/lib/ingest/sources/rfee-pdf/resultados';
import type { ItemTexto, PaginaTexto, PruebaPdf } from '../../src/lib/ingest/sources/rfee-pdf/tipos';
import { CARPETA_TRABAJO } from './comun';
import { especieEfcPendiente, type Especie } from './cobertura';
import { temporadaRfee } from './engarde-a-hechos';
import { claveEvento, clavePrueba, slug } from './lote7-efc';
import { edicionesEfc, sedeDeTorneo } from './lote8-efc';
import { RedLote8 } from './lote8-red';

const HECHOS = join(CARPETA_TRABAJO, 'hechos');
export const SALIDA_EFC_PDF = join(HECHOS, 'lote8b-efc-pdf');

export type Generador = 'engarde' | 'fencingtime' | 'ophardt' | 'desconocido';

/** Puesto leído de una clasificación. */
export type PuestoLeido = { posicion: number; raw: string; nombre: string; pais: string | null; club: string | null; nacimiento: number | null };
/** Asalto leído, con los tiradores por nombre y país. */
export type AsaltoLeido = {
  phase: 'POULE' | 'TABLEAU';
  roundKey: string;
  a: { nombre: string; pais: string | null };
  b: { nombre: string; pais: string | null };
  scoreA: number;
  scoreB: number;
  winner: 'A' | 'B' | null;
};

export function generadorDe(textos: readonly string[]): Generador {
  const t = textos.join('\n');
  if (/ophardt/i.test(t)) return 'ophardt';
  // Engarde imprime a veces el código FIE del documento: sus títulos de sección mandan.
  if (/engarde|poules?, (tour|round)|gironi, turno|tableau (de|of) \d+|classement g.n.ral|classifica generale|overall ranking/i.test(t)) return 'engarde';
  if (/FE_FIE_00\d\d/.test(t)) return 'fencingtime';
  return 'desconocido';
}

// ---------------------------------------------------------------------------
// Comprobaciones comunes
// ---------------------------------------------------------------------------

/** Puestos 1, 2, 3, 3, 5…: cada uno repite el anterior (empate) o es su orden en la lista. */
export function puestosCoherentes(posiciones: readonly number[]): string | null {
  if (posiciones.length === 0) return 'sin_puestos';
  if (posiciones[0] !== 1) return 'primer_puesto_no_es_1';
  for (let i = 1; i < posiciones.length; i += 1) {
    const p = posiciones[i];
    if (p !== posiciones[i - 1] && p !== i + 1) return `salto_de_puesto_${posiciones[i - 1]}_${p}`;
  }
  return null;
}

/** Motivo por el que un marcador es imposible, o `null`. */
export function marcadorImposible(b: Pick<AsaltoLeido, 'phase' | 'scoreA' | 'scoreB' | 'winner'>, equipos: boolean): string | null {
  const max = equipos ? 45 : b.phase === 'POULE' ? 5 : 15;
  if (![b.scoreA, b.scoreB].every((s) => Number.isInteger(s) && s >= 0)) return 'tocado_no_entero';
  if (Math.max(b.scoreA, b.scoreB) > max) return `mas_de_${max}_tocados`;
  if (!b.winner) return 'sin_ganador';
  const [g, p] = b.winner === 'A' ? [b.scoreA, b.scoreB] : [b.scoreB, b.scoreA];
  if (g < p) return 'ganador_con_menos_tocados';
  return null;
}

const tamRonda = (k: string): number | null => {
  const m = /^T(\d+)$/.exec(k);
  return m ? Number(m[1]) : null;
};

/**
 * Cuadro de eliminación directa frente a la clasificación: el ganador de la final es el 1 y el
 * perdedor el 2, el perdedor de la tabla de N queda entre N/2+1 y N, y nadie pierde dos veces ni
 * gana después de perder.
 */
export function cuadroCoherente(bouts: readonly AsaltoHecho[], puesto: ReadonlyMap<string, number | null>): string | null {
  const main = bouts.filter((b) => b.phase === 'TABLEAU' && tamRonda(b.roundKey) !== null);
  if (main.length === 0) return null;
  const derrota = new Map<string, number>();
  for (const b of main) {
    const n = tamRonda(b.roundKey)!;
    const perdedor = b.winner === 'A' ? b.bRef : b.aRef;
    if (derrota.has(perdedor)) return 'tirador_pierde_dos_veces';
    derrota.set(perdedor, n);
    const p = puesto.get(perdedor);
    if (p == null) return 'perdedor_sin_puesto';
    if (n === 2 ? p !== 2 : p <= n / 2 || p > n) return `perdedor_de_T${n}_con_puesto_${p}`;
  }
  for (const b of main) {
    const n = tamRonda(b.roundKey)!;
    const ganador = b.winner === 'A' ? b.aRef : b.bRef;
    const d = derrota.get(ganador);
    if (d !== undefined && d >= n) return 'ganador_ya_eliminado';
    if (n === 2 && puesto.get(ganador) !== 1) return 'ganador_de_la_final_no_es_1';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Engarde: traducción al inglés que lee el lector de la RFEE
// ---------------------------------------------------------------------------

const TRADUCCIONES: [RegExp, string][] = [
  [/^classement g.n.ral\b/i, 'Overall ranking'],
  [/^classifica generale\b/i, 'Overall ranking'],
  [/^classement (des|de la) poules?\b/i, 'Ranking of poules'],
  [/^classement (apr.s|.\s?l'issue des|a la fin des) (les )?poules?\b/i, 'Ranking after the poules'],
  [/^classifica (dei )?gironi\b/i, 'Ranking of poules'],
  [/^classifica parziale al termine dei gironi\b/i, 'Ranking after the poules'],
  [/^poules, tour\b/i, 'Poules, round'],
  [/^gironi, turno\b/i, 'Poules, round'],
  [/^girone\b/i, 'Poule'],
  [/^tireu(r|se)s \(pr.sent/i, 'Fencers (present'],
  [/^tirat(ori|rici) \(present/i, 'Fencers (present'],
  [/^.quipes \(pr.sent/i, 'Teams (present'],
  [/^squadre \(present/i, 'Teams (present'],
  [/^formule de la comp.tition\b/i, 'Formula of the competition'],
  [/^formula di gara\b/i, 'Formula of the competition'],
  [/^activit. des arbitres\b/i, 'Referees activity'],
  [/^attivit. (degli )?arbitri\b/i, 'Referees activity'],
  [/^tableau de (\d+)$/i, 'Tableau of $1'],
  [/^tabellone da (\d+)$/i, 'Tableau of $1'],
  [/^demi-?finales?$/i, 'Semifinals'],
  [/^semifinali$/i, 'Semifinals'],
  // El lector reconoce «Semifinals» y «Semi-finales», no «Semi-finals»: sin esto la columna de
  // semifinales se toma por la final.
  [/^semi-finals?$/i, 'Semifinals'],
  [/^finale$/i, 'Final'],
  [/^quarts de finale$/i, 'Quarts de final'],
  // Cabecera de la matriz de poule en italiano («V/A alq. SD pos.»).
  [/^V\/A$/, 'V/M'],
];

const PAISES_EQUIPO: Record<string, string> = {
  ALBANIA: 'ALB', ARMENIA: 'ARM', AUSTRIA: 'AUT', AUTRICHE: 'AUT', AZERBAIJAN: 'AZE', BELARUS: 'BLR', BELGIUM: 'BEL', BELGIQUE: 'BEL',
  BELGIO: 'BEL', BULGARIA: 'BUL', BULGARIE: 'BUL', CROATIA: 'CRO', CROATIE: 'CRO', CROAZIA: 'CRO', CYPRUS: 'CYP', CZECHREPUBLIC: 'CZE',
  CZECHIA: 'CZE', REPUBLIQUETCHEQUE: 'CZE', REPUBBLICACECA: 'CZE', DENMARK: 'DEN', DANEMARK: 'DEN', ESTONIA: 'EST', ESTONIE: 'EST',
  FINLAND: 'FIN', FINLANDE: 'FIN', FRANCE: 'FRA', FRANCIA: 'FRA', GEORGIA: 'GEO', GERMANY: 'GER', ALLEMAGNE: 'GER', GERMANIA: 'GER',
  GREATBRITAIN: 'GBR', GRANDEBRETAGNE: 'GBR', GRANBRETAGNA: 'GBR', GREECE: 'GRE', GRECE: 'GRE', GRECIA: 'GRE', HUNGARY: 'HUN',
  HONGRIE: 'HUN', UNGHERIA: 'HUN', ICELAND: 'ISL', IRELAND: 'IRL', ISRAEL: 'ISR', ITALY: 'ITA', ITALIE: 'ITA', ITALIA: 'ITA',
  KAZAKHSTAN: 'KAZ', LATVIA: 'LAT', LETTONIE: 'LAT', LITHUANIA: 'LTU', LUXEMBOURG: 'LUX', MALTA: 'MLT', MOLDOVA: 'MDA', MONACO: 'MON',
  MONTENEGRO: 'MNE', NETHERLANDS: 'NED', PAYSBAS: 'NED', OLANDA: 'NED', NORTHMACEDONIA: 'MKD', MACEDONIA: 'MKD', NORWAY: 'NOR',
  NORVEGE: 'NOR', POLAND: 'POL', POLOGNE: 'POL', POLONIA: 'POL', PORTUGAL: 'POR', PORTOGALLO: 'POR', ROMANIA: 'ROU', ROUMANIE: 'ROU',
  RUSSIA: 'RUS', RUSSIE: 'RUS', SERBIA: 'SRB', SERBIE: 'SRB', SLOVAKIA: 'SVK', SLOVAQUIE: 'SVK', SLOVACCHIA: 'SVK', SLOVENIA: 'SLO',
  SLOVENIE: 'SLO', SPAIN: 'ESP', ESPAGNE: 'ESP', SPAGNA: 'ESP', SWEDEN: 'SWE', SUEDE: 'SWE', SVEZIA: 'SWE', SWITZERLAND: 'SUI',
  SUISSE: 'SUI', SVIZZERA: 'SUI', TURKEY: 'TUR', TURKIYE: 'TUR', TURQUIE: 'TUR', TURCHIA: 'TUR', UKRAINE: 'UKR', UCRAINA: 'UKR',
  USA: 'USA', UNITEDSTATES: 'USA', ETATSUNIS: 'USA', STATIUNITI: 'USA', JAPAN: 'JPN', JAPON: 'JPN', GIAPPONE: 'JPN', CHINA: 'CHN',
  KOREA: 'KOR', HONGKONG: 'HKG', SINGAPORE: 'SGP', AUSTRALIA: 'AUS', CANADA: 'CAN', EGYPT: 'EGY', KUWAIT: 'KUW', SAUDIARABIA: 'KSA',
  BRAZIL: 'BRA', ARGENTINA: 'ARG', MEXICO: 'MEX', INDIA: 'IND', UZBEKISTAN: 'UZB', KYRGYZSTAN: 'KGZ', BOSNIAANDHERZEGOVINA: 'BIH',
};

/** País de una selección publicada por su nombre («RUSSIA 1», «HONGRIE», «ITA 2»), o `null`. */
export function paisDeEquipo(nombre: string): string | null {
  const base = normalizar(nombre).replace(/(\s+(\d+|[IVX]+|[A-D]))+$/, '').trim();
  if (/^[A-Z]{3}$/.test(base)) return base;
  return PAISES_EQUIPO[base.replace(/[^A-Z]/g, '')] ?? null;
}

/** Etiquetas de columna de las tablas de clasificación de Engarde en francés e italiano. */
const COLUMNAS: [RegExp, string][] = [
  [/^(rg|rang|ran|ranking)\.?(?=\s|$)/i, 'RANK'],
  [/^cl(t|assement)\.?(?=\s|$)/i, 'RANK'],
  [/^nom pr.nom\b/i, 'NAME'],
  [/^nome cognome\b/i, 'NAME'],
  [/^cognome nome\b/i, 'NAME'],
  [/^(nom|nome|denominazione(\/cogn\w*)?)(?=\s|$)/i, 'NAME'],
  [/^(nation|nat\.|naz\.?|nazione)(?=\s|$)/i, 'NATION'],
  [/^(statut|stato)(?=\s|$)/i, 'STATUS'],
  [/^(drapeau|drap\.|bandiera|band\.)(?=\s|$)/i, 'FLAG'],
  [/^(club|soci.t.)(?=\s|$)/i, 'CLUB'],
];

/** «(ordre des rangs - 178 tireuses)» → «- 178 fencers)» para que el lector lea el total publicado. */
function traducirTotales(s: string): string {
  return s.replace(/-\s*(\d+)\s+(tireu(r|se)s|tirat(ori|rici)|fencers)\)/i, '- $1 fencers)').replace(/-\s*(\d+)\s+(.quipes|squadre|teams)\)/i, '- $1 teams)');
}

/** Sin tildes: algunos PDF traen la «é» descompuesta en dos caracteres. */
const sinTildes = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function traducirItem(s: string): string {
  const t = s.trim();
  const n = sinTildes(t);
  for (const [re, en] of TRADUCCIONES) if (re.test(n)) return traducirTotales(n.replace(re, en));
  return traducirTotales(t);
}

/** Traduce una fila de etiquetas («rg nom prénom nation date nais») si es una cabecera de tabla. */
function traducirEtiquetas(items: ItemTexto[]): ItemTexto[] {
  const primero = normalizar(items[0]?.s ?? '');
  // Una fila de etiquetas no lleva paréntesis ni comas: «Ranking of poules, round No 1 (…)» es un título.
  if (!/^(RG|RANG|RAN|RANKING|CLT|POS\.?|RANK)( |$)/.test(primero) || items.some((i) => /[(),]/.test(i.s))) return items;
  return items.map((it) => {
    let resto = sinTildes(it.s.trim());
    const partes: string[] = [];
    while (resto) {
      const hit = COLUMNAS.find(([re]) => re.test(resto));
      if (hit) {
        const m = hit[0].exec(resto)!;
        partes.push(hit[1]);
        resto = resto.slice(m[0].length).trim();
      } else {
        const sp = resto.indexOf(' ');
        partes.push(sp < 0 ? resto : resto.slice(0, sp));
        resto = sp < 0 ? '' : resto.slice(sp + 1).trim();
      }
    }
    return { ...it, s: partes.join(' ') };
  });
}

const RE_ETIQUETA_CONOCIDA = /^(RANK|POS\.?|NAME|AND|FIRST|NATION|FLAG|CLUB|STATUS|TEAM|TEAMS)$/;

/**
 * El lector de la RFEE sólo acepta una cabecera de tabla si reconoce todas sus etiquetas. Las
 * columnas de fecha de nacimiento o licencia («d.o.b.», «date nais», «FIE lic.») no aportan nada
 * a la clasificación: se quitan su etiqueta y todo lo que cae en su franja horizontal.
 */
export function sinColumnasAjenas(items: readonly ItemTexto[], yEncabezado: number): ItemTexto[] {
  const filas = agruparFilas(items).filter((f) => f.y < yEncabezado - 1.6);
  const cab = filas.find((f) => /^(RANK|POS\.?)( |$)/.test(normalizar(f.items[0]?.s ?? '')));
  if (!cab) return [...items];
  const orden = [...cab.items].sort((a, b) => a.x - b.x);
  const franjas: [number, number][] = [];
  orden.forEach((it, k) => {
    const conocida = normalizar(it.s).split(' ').every((t) => RE_ETIQUETA_CONOCIDA.test(t));
    if (!conocida) franjas.push([it.x - 8, k + 1 < orden.length ? orden[k + 1].x - 8 : Infinity]);
  });
  // PDF.js junta a veces país y club en un texto («HUN VASAS»): se parte en las dos columnas.
  const xPais = orden.find((it) => /^(NATION|NAT\.)$/.test(normalizar(it.s)))?.x;
  const xClub = orden.find((it) => normalizar(it.s) === 'CLUB')?.x;
  const partidos = items.flatMap((i): ItemTexto[] => {
    const m = /^([A-Z]{3}) (.+)$/.exec(i.s.trim());
    if (i.y > cab.y - 1.6 || !m || xPais === undefined || xClub === undefined || Math.abs(i.x - xPais) > 6) return [i];
    return [{ ...i, s: m[1], w: 15 }, { ...i, s: m[2], x: Math.max(xClub, i.x + 16), w: Math.max(1, i.w - 16) }];
  });
  if (franjas.length === 0) return partidos;
  // Las fechas van alineadas a la derecha y pueden empezar antes que su etiqueta.
  const ajeno = (i: ItemTexto) => franjas.some(([a, b]) => i.x >= a && i.x < b) || /^(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{6,})$/.test(i.s.trim());
  return partidos.filter((i) => i.y > cab.y + 1.6 || (i.y >= cab.y - 1.6 ? !franjas.some(([a, b]) => i.x >= a + 7 && i.x < b) : !ajeno(i)));
}

const MESES_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const ARMA_ES: Record<string, string> = { ESPADA: 'ESPADA', FLORETE: 'FLORETE', SABLE: 'SABLE' };
const CATEGORIA_ES: Record<string, string> = { M17: 'CADETE', M20: 'JUNIOR', M23: 'SUB-23', ABS: 'ABSOLUTO', M14: 'M-14', M15: 'M-15' };

/** Cabecera sintética que el lector de la RFEE atribuye sin dudas. */
export function cabeceraSintetica(e: Especie): string[] | null {
  if (!e.weapon || !e.gender || !e.category || !e.format || !e.fecha || !CATEGORIA_ES[e.category]) return null;
  const genero = e.gender === 'M' ? 'MASCULINO' : e.gender === 'F' ? 'FEMENINO' : 'MIXTO';
  const [y, m, d] = e.fecha.split('-');
  return [`${ARMA_ES[e.weapon]} ${genero} ${e.format === 'EQUIPOS' ? 'EQUIPOS' : 'INDIVIDUAL'}`, CATEGORIA_ES[e.category], `${d}-${MESES_ES[Number(m) - 1]}-${y}`];
}

/**
 * Traduce las páginas y sustituye su cabecera (todo lo que queda encima del primer título de
 * sección) por la sintética. En los cuadros el nombre del torneo puede ir debajo de la fila de
 * rondas: se quita del cuerpo si coincide con una línea de cabecera de otra página.
 */
export function prepararEngarde(paginas: readonly PaginaTexto[], cabecera: readonly string[]): PaginaTexto[] {
  const traducidas = paginas.map((p) => {
    const filas = agruparFilas(limpiarItems(p.items).map((i) => ({ ...i, s: traducirItem(i.s) })));
    return { ...p, items: filas.flatMap((f) => traducirEtiquetas(f.items)) };
  });
  const analizadas = traducidas.map(analizarPagina);
  const lineasCabecera = new Set(analizadas.flatMap((a) => a.cabecera.map(normalizar)));
  return traducidas.map((p, k) => {
    const a = analizadas[k];
    if (a.yEncabezado === null) return p;
    const y0 = a.yEncabezado;
    let cuerpo = p.items.filter((i) => i.y <= y0 + 1.6);
    if (a.tipo === 'clasificacion_final') cuerpo = sinColumnasAjenas(cuerpo, y0);
    if (a.tipo === 'cuadro') {
      const filasCab = new Set(
        agruparFilas(cuerpo.filter((i) => i.y < y0 - 1.6 && i.y > y0 - 60))
          .filter((f) => lineasCabecera.has(normalizar(textoFila(f))))
          .flatMap((f) => f.items),
      );
      cuerpo = cuerpo.filter((i) => !filasCab.has(i));
    }
    const sinteticos = cabecera.map((s, n) => ({ s, x: 30, y: y0 + 12 * (cabecera.length - n), w: s.length * 5, h: 8 }));
    return { ...p, items: [...sinteticos, ...cuerpo] };
  });
}

/**
 * País por nombre según las clasificaciones tras las poules, para las clasificaciones finales que
 * no publican la columna de nación. Un nombre con dos países distintos queda fuera.
 */
export function paisesIntermedios(preparadas: readonly PaginaTexto[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const p of preparadas) {
    const a = analizarPagina(p);
    if (a.tipo !== 'clasificacion_intermedia' || a.yEncabezado === null) continue;
    const limpia = analizarPagina({ ...p, items: sinColumnasAjenas(p.items, a.yEncabezado) });
    for (const x of leerClasificacion([limpia]).puestos) {
      if (!x.pais) continue;
      const k = normalizeSportName(x.nombre);
      m.set(k, m.has(k) && m.get(k) !== x.pais ? null : x.pais);
    }
  }
  return m;
}

export type LecturaPdfEfc = {
  puestos: PuestoLeido[];
  asaltos: AsaltoLeido[];
  /** Estado de cada parte según el propio lector, antes de las comprobaciones propias. */
  estados: { puestos: string; poules: string; cuadro: string };
  publicados: number | null;
  notas: string[];
};

const rondaEfc = (r: string) => r.replace(/^A(\d+)$/, 'T$1');

export function lecturaEngarde(p: PruebaPdf): LecturaPdfEfc {
  const porRef = new Map(p.puestos.map((x) => [x.ref, x]));
  const asaltos: AsaltoLeido[] = [];
  for (const a of p.asaltos) {
    const x = porRef.get(a.refA);
    const y = porRef.get(a.refB);
    asaltos.push({
      phase: a.fase, roundKey: a.fase === 'TABLEAU' ? rondaEfc(a.ronda) : a.ronda,
      a: { nombre: x?.nombre ?? a.nombreA, pais: x?.pais ?? null }, b: { nombre: y?.nombre ?? a.nombreB, pais: y?.pais ?? null },
      scoreA: a.puntosA, scoreB: a.puntosB, winner: a.puntosA > a.puntosB ? 'A' : a.puntosB > a.puntosA ? 'B' : null,
    });
  }
  const notas: string[] = [];
  const ex = Object.entries(p.excluidos).filter(([, n]) => n > 0);
  if (ex.length) notas.push(`Asaltos excluidos por el lector: ${ex.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  const motivos = [...new Set(p.rechazos.map((r) => `${r.seccion}: ${r.motivo}`))];
  if (motivos.length) notas.push(`Rechazos del lector (${p.rechazos.length}): ${motivos.slice(0, 6).join('; ')}`);
  return {
    puestos: p.puestos.filter((x) => x.posicion !== null).map((x) => ({ posicion: x.posicion!, raw: String(x.posicion), nombre: x.nombre, pais: x.pais ?? null, club: x.club, nacimiento: null })),
    asaltos,
    estados: { puestos: p.cobertura.puestos.estado, poules: p.cobertura.poules.estado, cuadro: p.cobertura.cuadro.estado },
    publicados: p.cobertura.puestos.publicado,
    notas,
  };
}

// ---------------------------------------------------------------------------
// FencingTime y Ophardt: tablas por columnas
// ---------------------------------------------------------------------------

type ColumnaTabla = 'puesto' | 'nombre' | 'club' | 'pais' | 'nacimiento' | 'otra';

const ETIQUETA_TABLA: [RegExp, ColumnaTabla][] = [
  [/^place$/i, 'puesto'], [/^name$/i, 'nombre'], [/^clubs?$/i, 'club'], [/^(country|nation)$/i, 'pais'],
  [/^(birthdate|yob)$/i, 'nacimiento'], [/^(rank|division)$/i, 'otra'],
];

function columnasDeFila(f: Fila): { tipo: ColumnaTabla; x: number }[] | null {
  const cols = f.items.flatMap((it) => {
    // FencingTime a veces junta etiquetas contiguas («Name Clubs»): se reparten por anchura.
    const partes = it.s.trim().split(/\s+/);
    const paso = it.w / Math.max(1, it.s.trim().length);
    let off = 0;
    return partes.map((s) => {
      const x = it.x + off * paso;
      off += s.length + 1;
      return { s, x };
    });
  });
  const tipos = cols.map((c) => ({ tipo: ETIQUETA_TABLA.find(([re]) => re.test(c.s))?.[1] ?? null, x: c.x }));
  if (tipos.some((t) => t.tipo === null)) return null;
  const t = tipos as { tipo: ColumnaTabla; x: number }[];
  if (t[0]?.tipo !== 'puesto' || !t.some((c) => c.tipo === 'nombre') || !t.some((c) => c.tipo === 'pais')) return null;
  return t;
}

const RE_PUESTO_FT = /^(\d{1,3})T?\.?$/;

/**
 * Clasificación de una tabla «Place Name [Clubs] Country [Birthdate]» (FencingTime) o
 * «Place Nation Name yob» (Ophardt). Cada texto se asigna a la columna cuya etiqueta tiene a su
 * izquierda más cerca; una fila sin puesto, nombre o país de tres letras se rechaza.
 */
export function leerTablaClasificacion(
  paginas: readonly PaginaTexto[],
  esPaginaRanking: (textos: string[]) => boolean,
  equipos = false,
): { puestos: PuestoLeido[]; rechazadas: string[] } {
  const puestos: PuestoLeido[] = [];
  const rechazadas: string[] = [];
  for (const p of paginas) {
    const filas = agruparFilas(limpiarItems(p.items).map((i) => ({ ...i, s: i.s.trim() }))).map((f) => ({ y: f.y, items: fusionarFragmentos(f.items) }));
    if (!esPaginaRanking(filas.map(textoFila))) continue;
    const iCab = filas.findIndex((f) => columnasDeFila(f) !== null);
    if (iCab < 0) {
      rechazadas.push(`p${p.numero}:sin_cabecera_de_tabla`);
      continue;
    }
    const cols = columnasDeFila(filas[iCab])!;
    const columnaDe = (x: number) => [...cols].reverse().find((c) => x >= c.x - 6)?.tipo ?? null;
    for (const f of filas.slice(iCab + 1)) {
      const texto = textoFila(f);
      if (!RE_PUESTO_FT.test((f.items[0]?.s ?? '').split(/\s+/)[0]) || columnaDe(f.items[0].x) !== 'puesto') {
        // Separadores («Table of 8»), pie de página y totales.
        if (/^\d/.test(texto) && !/^\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(texto) && !/^\d+ \/ \d+$/.test(texto)) rechazadas.push(`p${p.numero}:${texto.slice(0, 60)}`);
        continue;
      }
      const por: Record<ColumnaTabla, string[]> = { puesto: [], nombre: [], club: [], pais: [], nacimiento: [], otra: [] };
      for (const it of f.items) {
        const c = columnaDe(it.x);
        if (c) por[c].push(it.s);
      }
      // Ophardt añade el código del abandono junto al puesto o al país («20 MED GER») y la fase al
      // nombre («(Direct elimination)»).
      const RE_ABANDONO = /^(MED|ABD|ABA|EXC|DNF|DNS|WD)$/;
      const puestoSolo = por.puesto.flatMap((s) => s.split(/\s+/)).filter((s) => !RE_ABANDONO.test(s));
      const raw = puestoSolo.join(' ');
      const nombre = por.nombre.join(' ').replace(/\s*\([^)]*\)/g, '').replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
      const textoPais = por.pais.join(' ').split(/\s+/).filter((s) => !RE_ABANDONO.test(s)).join(' ');
      const pais = /^[A-Z]{3}$/.test(textoPais) ? textoPais : null;
      // Equipos mixtos de FencingTime («NED-BEL»), a veces sin nada en la columna de país.
      const mixto = /^[A-Z]{3}(-[A-Z]{3})+$/.test(textoPais) || (!textoPais && /^[A-Z]{3}(-[A-Z]{3})+$/.test(nombre));
      // Una selección puede salir sin código de país («12 JAPAN 2»): el país sale de su nombre.
      if (puestoSolo.length !== 1 || !RE_PUESTO_FT.test(raw) || nombre.length < 2 || (!pais && !mixto && !(equipos && !textoPais))) {
        rechazadas.push(`p${p.numero}:${texto.slice(0, 60)}`);
        continue;
      }
      const anio = /(19|20)\d{2}/.exec(por.nacimiento.join(' '))?.[0];
      puestos.push({
        posicion: Number(RE_PUESTO_FT.exec(raw)![1]), raw, nombre, pais, club: por.club.join(' ').trim() || null,
        nacimiento: anio ? Number(anio) : null,
      });
    }
  }
  return { puestos, rechazadas };
}

export const esRankingFencingTime = (lineas: string[]) => lineas.some((l) => /\bFE_FIE_0012\b/.test(l));
export const esRankingOphardt = (lineas: string[]) => lineas.some((l) => /^Final placement\b/i.test(l)) || (lineas.some((l) => /FE_FIE_0012/.test(l)) && lineas.some((l) => /^Place Nation Name\b/.test(l)));

const RE_CELDA = /^(V\d?|\d{1,2}|\/)$/;

type FilaPoule = { nombre: string; pais: string; celdas: string[]; v: number; td: number; tr: number };

/**
 * Fila «NOMBRE Nombre NAT [club] n celdas… V TD TR I1 [I2] Puesto.» de una poule de Ophardt. El
 * número de la fila se busca por la derecha: lo que le sigue tiene que ser exactamente la matriz
 * y los totales. El nombre puede faltar si el PDF lo partió en otra línea (`nombre` vacío).
 */
export function filaPouleOphardt(texto: string, numero: number, tam: number, paises: ReadonlySet<string>, conocidos: ReadonlySet<string>): FilaPoule | null {
  const t = texto.split(/\s+/);
  for (let k = t.length - 1; k >= 1; k -= 1) {
    if (t[k] !== String(numero)) continue;
    const resto = t.length - k - 1;
    if (resto !== tam - 1 + 5 && resto !== tam - 1 + 6) continue;
    const celdas = t.slice(k + 1, k + tam);
    const tot = t.slice(k + tam, k + tam + 3);
    if (!celdas.every((c) => RE_CELDA.test(c)) || !tot.every((x) => /^\d+$/.test(x)) || !/^\d+\.?$/.test(t[t.length - 1])) continue;
    // El país es un código de la clasificación; entre varios (apellido «TIM», club «UTE») manda el
    // que deja un nombre y país que la clasificación conoce.
    const candidatos = [...Array(k).keys()].filter((i) => paises.has(t[i]));
    if (candidatos.length === 0) return null;
    const exacto = candidatos.find((i) => conocidos.has(`${normalizeSportName(t.slice(0, i).join(' '))}|${t[i]}`));
    const ip = exacto ?? candidatos.find((i) => i >= 1) ?? candidatos[0];
    return { nombre: t.slice(0, ip).join(' '), pais: t[ip], celdas, v: Number(tot[0]), td: Number(tot[1]), tr: Number(tot[2]) };
  }
  return null;
}

const tocados = (c: string, max: number) => (c === 'V' ? max : c.startsWith('V') ? Number(c.slice(1)) : Number(c));

/**
 * Asaltos de una poule de Ophardt (la diagonal no se imprime). Sólo si cada fila cuadra con sus
 * victorias, tocados dados y recibidos, y cada pareja tiene exactamente un ganador. «/» es un
 * asalto no disputado (abandono) y no se escribe.
 */
export function asaltosPouleOphardt(filas: readonly FilaPoule[], max: number, ronda: string): { asaltos: AsaltoLeido[]; motivo: string | null } {
  const n = filas.length;
  const celda = (i: number, j: number) => filas[i].celdas[j < i ? j : j - 1];
  const asaltos: AsaltoLeido[] = [];
  for (let i = 0; i < n; i += 1) {
    let v = 0;
    let td = 0;
    let tr = 0;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      const a = celda(i, j);
      const b = celda(j, i);
      if (a === '/' || b === '/') {
        if (a !== '/' || b !== '/') {
          // Un lado anulado y el otro con marcador: Ophardt cuenta los tocados del lado vivo.
          if (a !== '/') td += tocados(a, max);
          if (b !== '/') tr += tocados(b, max);
          if (a.startsWith('V')) v += 1;
        }
        continue;
      }
      if (a.startsWith('V') === b.startsWith('V')) return { asaltos: [], motivo: 'pareja_sin_un_ganador' };
      if (a.startsWith('V')) v += 1;
      td += tocados(a, max);
      tr += tocados(b, max);
      if (j > i) {
        const sa = tocados(a, max);
        const sb = tocados(b, max);
        asaltos.push({
          phase: 'POULE', roundKey: ronda, a: { nombre: filas[i].nombre, pais: filas[i].pais }, b: { nombre: filas[j].nombre, pais: filas[j].pais },
          scoreA: sa, scoreB: sb, winner: a.startsWith('V') ? 'A' : 'B',
        });
      }
    }
    if (v !== filas[i].v || td !== filas[i].td || tr !== filas[i].tr) return { asaltos: [], motivo: 'totales_no_cuadran' };
  }
  return { asaltos, motivo: null };
}

/** Poules de Ophardt (FE_FIE_0007): «Pool N», fila de columnas «Name Nation No. 1 … n V TD TR …» y n filas. */
export function poulesOphardt(
  paginas: readonly PaginaTexto[],
  max: number,
  clasificacion: readonly PuestoLeido[],
): { asaltos: AsaltoLeido[]; poules: number; descartadas: Record<string, number> } {
  const asaltos: AsaltoLeido[] = [];
  const descartadas: Record<string, number> = {};
  const paises = new Set(clasificacion.flatMap((x) => (x.pais ? [x.pais] : [])));
  const conocidos = new Set(clasificacion.map((x) => `${normalizeSportName(x.nombre)}|${x.pais}`));
  let poules = 0;
  let vuelta = 0;
  let ultimoNumero = Infinity;
  for (const p of paginas) {
    const lineas = agruparFilas(limpiarItems(p.items)).map(textoFila);
    if (!lineas.some((l) => /FE_FIE_0007/.test(l))) continue;
    for (let k = 0; k < lineas.length; k += 1) {
      const m = /^(?:Pool|Poule) (\d+)\b/.exec(lineas[k]);
      if (!m) continue;
      const num = Number(m[1]);
      if (num <= ultimoNumero) vuelta += 1;
      ultimoNumero = num;
      const iCols = lineas.slice(k + 1, k + 4).findIndex((l) => /^Name Nation No\./.test(l));
      if (iCols < 0) {
        descartadas.sin_columnas = (descartadas.sin_columnas ?? 0) + 1;
        continue;
      }
      const tam = Math.max(...[...lineas[k + 1 + iCols].matchAll(/\b(\d+)\b/g)].map((x) => Number(x[1])).filter((x) => x <= 12));
      // Filas de la matriz en orden. Un nombre partido en varias líneas deja la fila de la matriz
      // sin nombre y sus trozos en las líneas de encima.
      const filas: FilaPoule[] = [];
      let sueltas: string[] = [];
      for (let j = k + 2 + iCols; j < lineas.length && filas.length < tam; j += 1) {
        if (/^(?:Pool|Poule) \d+\b/.test(lineas[j])) break;
        const f = filaPouleOphardt(lineas[j], filas.length + 1, tam, paises, conocidos);
        if (!f) {
          sueltas.push(lineas[j]);
          continue;
        }
        if (sueltas.length) f.nombre = `${sueltas.join(' ')} ${f.nombre}`.trim();
        sueltas = [];
        filas.push(f);
      }
      if (!(tam >= 3) || filas.length !== tam || filas.some((f) => !f.nombre)) {
        descartadas.fila_ilegible = (descartadas.fila_ilegible ?? 0) + 1;
        continue;
      }
      const r = asaltosPouleOphardt(filas, max, vuelta > 1 ? `V${vuelta}P${num}` : `P${num}`);
      if (r.motivo) {
        descartadas[r.motivo] = (descartadas[r.motivo] ?? 0) + 1;
        continue;
      }
      poules += 1;
      asaltos.push(...r.asaltos);
    }
  }
  return { asaltos, poules, descartadas };
}

// ---------------------------------------------------------------------------
// Hechos
// ---------------------------------------------------------------------------

const claveNombre = (nombre: string) => normalizeSportName(nombre.replace(/,/g, ' ')).replace(/ /g, '-');

/**
 * Hechos de una prueba: claves de tirador `efc:<NAT>:<nombre>` como el lote 7 (equipos
 * `team:efc:<NAT>`, o con el nombre si el país tiene varios), puestos tal cual y asaltos con
 * los tiradores de la clasificación. Devuelve lo que se descarta para el informe.
 */
export function construirHechos(
  l: LecturaPdfEfc,
  e: Especie,
  equipos: boolean,
): { results: ResultadoHecho[]; bouts: AsaltoHecho[]; descartes: Record<string, number>; partes: { puestos: string; poules: string; cuadro: string } } {
  const descartes: Record<string, number> = {};
  const anotar = (m: string, n = 1) => (descartes[m] = (descartes[m] ?? 0) + n);
  const porPais = new Map<string, number>();
  for (const x of l.puestos) if (x.pais) porPais.set(x.pais, (porPais.get(x.pais) ?? 0) + 1);
  const results: ResultadoHecho[] = [];
  const usadas = new Set<string>();
  const refDe = new Map<string, string | null>();
  for (const x of l.puestos) {
    let factKey = equipos
      ? `team:efc:${x.pais && porPais.get(x.pais) === 1 ? x.pais : slug(x.nombre)}`
      : `efc:${x.pais ?? 'XXX'}:${claveNombre(x.nombre)}`;
    if (usadas.has(factKey)) factKey = `${factKey}:${results.length + 1}`;
    usadas.add(factKey);
    results.push({
      factKey, name: x.nombre.replace(/\s*,\s*/g, ' ').trim(), countryCode: x.pais, club: x.club, position: x.posicion, positionRaw: null,
      points: null, fieId: null, license: null, birthYear: x.nacimiento,
    });
    const k = `${normalizeSportName(x.nombre.replace(/,/g, ' '))}|${x.pais ?? ''}`;
    refDe.set(k, refDe.has(k) ? null : factKey);
  }
  const nombreDe = new Map(results.map((r) => [r.factKey, r.name]));
  const normalizados = results.map((r) => ({ k: r.factKey, n: normalizeSportName(r.name), pais: r.countryCode ?? '' }));
  // Nombres truncados por el ancho de columna o partidos en dos líneas: vale un único prefijo del mismo país.
  const ref = (t: { nombre: string; pais: string | null }) => {
    const n = normalizeSportName(t.nombre.replace(/,/g, ' '));
    const exacto = refDe.get(`${n}|${t.pais ?? ''}`);
    if (exacto !== undefined) return exacto;
    if (n.length < 6) return null;
    const c = normalizados.filter((r) => r.pais === (t.pais ?? '') && (r.n.startsWith(n) || n.startsWith(r.n)));
    return c.length === 1 ? c[0].k : null;
  };
  const bouts: AsaltoHecho[] = [];
  const vistos = new Set<string>();
  for (const b of l.asaltos) {
    const imposible = marcadorImposible(b, equipos);
    if (imposible) {
      anotar(`${b.phase.toLowerCase()}:${imposible}`);
      continue;
    }
    const a = ref(b.a);
    const c = ref(b.b);
    if (!a || !c || a === c) {
      anotar(`${b.phase.toLowerCase()}:tirador_fuera_de_la_clasificacion`);
      continue;
    }
    const k = `${b.phase}|${b.roundKey}|${[a, c].sort().join('|')}`;
    if (vistos.has(k)) {
      anotar(`${b.phase.toLowerCase()}:repetido`);
      continue;
    }
    vistos.add(k);
    bouts.push({ phase: b.phase, roundKey: b.roundKey, aRef: a, bRef: c, aName: nombreDe.get(a)!, bName: nombreDe.get(c)!, scoreA: b.scoreA, scoreB: b.scoreB, winner: b.winner });
  }
  const puesto = new Map(results.map((r) => [r.factKey, r.position]));
  const motivoCuadro = cuadroCoherente(bouts, puesto);
  let salida = bouts;
  if (motivoCuadro) {
    const n = bouts.filter((b) => b.phase === 'TABLEAU').length;
    anotar(`cuadro_descartado:${motivoCuadro}`, n);
    salida = bouts.filter((b) => b.phase !== 'TABLEAU');
  }
  const perdio = (fase: string) => Object.keys(descartes).some((k) => k.startsWith(fase));
  const partes = {
    puestos: results.length === 0 ? 'sin_resultados' : results.some((r) => !r.countryCode) && !equipos ? 'parcial' : l.estados.puestos,
    poules: salida.some((b) => b.phase === 'POULE') ? (perdio('poule:') ? 'parcial' : l.estados.poules) : 'sin_resultados',
    cuadro: salida.some((b) => b.phase === 'TABLEAU') ? (perdio('tableau:') ? 'parcial' : l.estados.cuadro) : 'sin_resultados',
  };
  return { results, bouts: salida, descartes, partes };
}

function lecturaTablas(paginas: readonly PaginaTexto[], gen: 'fencingtime' | 'ophardt', equipos: boolean): LecturaPdfEfc {
  const notas: string[] = [];
  const t = leerTablaClasificacion(paginas, gen === 'ophardt' ? esRankingOphardt : esRankingFencingTime, equipos);
  const po = gen === 'ophardt' && !equipos ? poulesOphardt(paginas, 5, t.puestos) : { asaltos: [], poules: 0, descartadas: {} };
  if (t.rechazadas.length) notas.push(`Filas de clasificación rechazadas: ${t.rechazadas.length} (${t.rechazadas.slice(0, 3).join('; ')})`);
  const descP = Object.entries(po.descartadas);
  if (descP.length) notas.push(`Poules descartadas: ${descP.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (gen === 'fencingtime') notas.push('FencingTime: las hojas de poule no publican marcador y el cuadro no trae nombres ni tocados en la capa de texto');
  if (gen === 'ophardt') notas.push('Ophardt: el cuadro no se lee');
  return {
    puestos: t.puestos, asaltos: po.asaltos,
    estados: { puestos: t.rechazadas.length ? 'parcial' : 'completo', poules: descP.length ? 'parcial' : 'completo', cuadro: 'sin_resultados' },
    publicados: null, notas,
  };
}

const estadoValido = (s: string) => (s === 'completo' || s === 'parcial' ? s : s === 'sin_resultados' ? 'sin_resultados' : 'parcial');

async function main(): Promise<void> {
  const inf = JSON.parse(readFileSync(join(HECHOS, 'lote8-efc', '_informe.json'), 'utf8')) as { detalle: Record<string, string>[] };
  const pendientes = inf.detalle.filter((d) => d.motivo === 'pdf_sin_lector' || d.motivo === 'xml_ilegible');
  const ediciones = edicionesEfc();
  const red = new RedLote8();
  mkdirSync(SALIDA_EFC_PDF, { recursive: true });
  const motivos: Record<string, number> = {};
  const anotar = (m: string) => (motivos[m] = (motivos[m] ?? 0) + 1);
  const descartesTotales: Record<string, number> = {};
  const detalle: Record<string, unknown>[] = [];
  const porGenerador: Record<string, Record<string, number>> = {};
  let puestos = 0;
  let poules = 0;
  let cuadro = 0;
  for (const d of pendientes) {
    const base = { tid: d.tid, xid: d.xid, torneo: d.torneo, prueba: d.prueba, fecha: d.fecha, url: d.url };
    const fin = (motivo: string, extra: Record<string, unknown> = {}, gen = 'desconocido') => {
      anotar(motivo);
      ((porGenerador[gen] ??= {})[motivo] = (porGenerador[gen][motivo] ?? 0) + 1);
      detalle.push({ ...base, generador: gen, motivo, ...extra });
    };
    const url = d.url ? encodeURI(d.url) : null;
    const doc = url ? red.enCache(url) : null;
    if (!url || !doc?.bytes) {
      fin('sin_copia_en_cache');
      continue;
    }
    const s = especieEfcPendiente(d.prueba, d.fecha);
    const cab = cabeceraSintetica(s);
    if (!cab) {
      fin('prueba_sin_atributos', { especie: s });
      continue;
    }
    const equipos = s.format === 'EQUIPOS';
    let paginas: PaginaTexto[];
    try {
      paginas = (await extraerPaginas(new Uint8Array(doc.bytes), { maxPaginas: 200, maxBytes: 50e6 })).paginas;
    } catch (e) {
      fin('pdf_ilegible', { error: (e as Error).message });
      continue;
    }
    const textos = paginas.map((p) => agruparFilas(limpiarItems(p.items)).map(textoFila).join('\n'));
    let lectura: LecturaPdfEfc | null = null;
    let gen = generadorDe(textos);
    if (gen === 'engarde') {
      const prep = prepararEngarde(paginas, cab);
      const l = leerResultadosPdf(prep, { url, docId: `efc-${d.xid}` });
      const conPuestos = l.pruebas.filter((p) => p.puestos.length > 0);
      if (conPuestos.length === 1) {
        const p = conPuestos[0];
        const faltan = p.puestos.filter((x) => !x.pais);
        let rellenos = 0;
        if (faltan.length && !equipos) {
          const paises = paisesIntermedios(prep);
          for (const x of faltan) {
            const pais = paises.get(normalizeSportName(x.nombre));
            if (pais) {
              x.pais = pais;
              rellenos += 1;
            }
          }
        }
        lectura = lecturaEngarde(p);
        if (rellenos) lectura.notas.push(`País de ${rellenos} tiradores tomado de la clasificación tras las poules (la final no publica la nación)`);
      } else if (conPuestos.length > 1) {
        fin('engarde_varias_pruebas', { pruebas: l.pruebas.length }, gen);
        continue;
      } else if (paginas.some((p) => esRankingFencingTime(agruparFilas(limpiarItems(p.items)).map(textoFila)))) {
        // Documentos de FencingTime que mencionan «Tableau»: se leen como FencingTime.
        gen = 'fencingtime';
      } else {
        fin('engarde_sin_clasificacion', { paginas: l.paginas.map((p) => `${p.pagina}:${p.tipo}`) }, gen);
        continue;
      }
    }
    if (gen === 'fencingtime' || gen === 'ophardt') lectura = lecturaTablas(paginas, gen, equipos);
    if (!lectura) {
      fin('generador_desconocido', {}, gen);
      continue;
    }
    const coherencia = puestosCoherentes(lectura.puestos.map((x) => x.posicion));
    if (coherencia) {
      fin(`clasificacion_incoherente:${coherencia}`, { puestos: lectura.puestos.length }, gen);
      continue;
    }
    if (equipos) for (const x of lectura.puestos) x.pais ??= paisDeEquipo(x.nombre);
    const sinPais = equipos ? 0 : lectura.puestos.filter((x) => !x.pais).length;
    // Sin país la clave del tirador es `efc:XXX:…`: se tolera en casos sueltos (la clasificación
    // queda parcial), no cuando falta la columna.
    if (sinPais > Math.max(1, Math.floor(lectura.puestos.length * 0.02))) {
      fin('clasificacion_sin_pais', { sinPais }, gen);
      continue;
    }
    if (sinPais) lectura.notas.push(`${sinPais} tiradores sin país publicado`);
    if (lectura.publicados !== null && lectura.publicados !== lectura.puestos.length) lectura.estados.puestos = 'parcial';
    const h0 = construirHechos(lectura, s, equipos);
    for (const [k, n] of Object.entries(h0.descartes)) descartesTotales[k] = (descartesTotales[k] ?? 0) + n;
    const notasDescartes = Object.entries(h0.descartes).map(([k, n]) => `${k} ${n}`);
    const previa = ediciones.get(d.tid);
    const season = previa?.season ?? temporadaRfee(s.fecha!);
    const tournamentKey = previa?.tournamentKey ?? `efc:${season}:${claveEvento(sedeDeTorneo(d.torneo), s.fecha!)}`;
    const evento = tournamentKey.split(':').slice(2).join(':');
    const atributos = { weapon: s.weapon!, gender: s.gender!, category: s.category!, format: s.format! } as const;
    const h = hechosPrueba.parse({
      version: 1, source: 'efc', extractor: `lector_efc_pdf_${gen}`, sourceUrl: url, sourceSha256: doc.sha256,
      edition: previa ?? { season, tournamentKey, name: d.torneo, startDate: s.fecha, endDate: s.fecha, city: sedeDeTorneo(d.torneo), countryCode: null },
      competition: {
        competitionKey: clavePrueba(season, evento, atributos), ...atributos, categoryRaw: d.prueba ?? null, date: s.fecha,
      },
      status: {
        results: estadoValido(h0.partes.puestos), pools: estadoValido(h0.partes.poules), tableau: estadoValido(h0.partes.cuadro),
        publishedParticipants: lectura.publicados ?? h0.results.length,
        notes: [
          `Lote 8b: PDF de la EFC (id ${d.xid}, ${gen}) del almacén público de la EFC; torneo ${d.tid} de eurofencing.info`,
          ...lectura.notas,
          ...(notasDescartes.length ? [`Descartes propios: ${notasDescartes.join(', ')}`] : []),
        ],
      },
      results: h0.results,
      bouts: h0.bouts,
    });
    writeFileSync(join(SALIDA_EFC_PDF, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
    const nP = h.bouts.filter((b) => b.phase === 'POULE').length;
    const nT = h.bouts.filter((b) => b.phase === 'TABLEAU').length;
    puestos += h.results.length;
    poules += nP;
    cuadro += nT;
    fin('escrita', { clave: h.competition.competitionKey, puestos: h.results.length, poules: nP, cuadro: nT, estados: { ...h.status, notes: undefined }, descartes: h0.descartes }, gen);
  }
  const informe = { generado: new Date().toISOString(), pendientes: pendientes.length, motivos, porGenerador, puestos, poules, cuadro, descartes: descartesTotales, detalle };
  writeFileSync(join(SALIDA_EFC_PDF, '_informe.json'), `${JSON.stringify(informe, null, 1)}\n`);
  console.log(JSON.stringify({ ...informe, detalle: undefined }, null, 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
