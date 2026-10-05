/**
 * Clasificaciones finales publicadas en Ophardt Online (fencing.ophardt.online,
 * el sistema de inscripción y resultados de la FIE y las confederaciones) para las
 * pruebas del calendario FIE que la FIE no publica.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-huecos-ophardt.ts descargar [--db <sqlite>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/fie-huecos-ophardt.ts hechos [--db <sqlite>] [--salida <dir>]
 *
 * `descargar` busca, por fechas, los torneos de Ophardt de cada campeonato y guarda
 * en caché (`fie-huecos/raw/`) los listados y las páginas de resultados. `hechos`
 * trabaja sólo con la caché: cada prueba FIE se casa con la única sección del torneo
 * con su arma, género, categoría y modalidad, y se escribe con las claves FIE.
 * Ophardt publica la clasificación, no los asaltos.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ficheroHechos } from '../../src/lib/ingest/hechos/formato';
import { argumento, normalizarNombre, NUEVO_POR_DEFECTO } from './comun';
import { CARPETA_HUECOS, desentidad, enCache, limpiar, obtener, SALIDA_HECHOS, texto } from './fie-huecos-comun';
import {
  abrirBase,
  cargarObjetivos,
  construirHechos,
  esMarcadorFie,
  fechaDe,
  grupoDe,
  indicePersonasFie,
  resultadosEquipos,
  resultadosIndividuales,
  type FilaPublicada,
  type Objetivo,
} from './fie-huecos-objetivos';

const BASE = 'https://fencing.ophardt.online';
export const INFORME_OPHARDT = join(CARPETA_HUECOS, 'ophardt-informe.json');

/** Título de torneo que identifica cada campeonato en el listado de Ophardt. */
const TITULOS: Record<string, RegExp | null> = {
  'Europeos cadetes': /European Championships?|Championnats d.Europe/i,
  'Asiáticos cadetes': /Asia/i,
  Africanos: /Africa|Afrique/i,
  'Panamericanos cadetes': /Pan.?Americ|Panameric/i,
  'Mediterráneos cadetes/júnior': /Mediterr/i,
  'Mediterráneos U20/U17/U15': /Mediterr/i,
  'Commonwealth júnior/cadete': /Commonwealth/i,
  'Juegos Mediterráneos': /Mediterr/i,
  'Universiadas/FISU': /Universi|FISU|University/i,
  'Mundiales veteranos equipos': /Veteran/i,
  'SEA Games': /SEA Games|South ?East/i,
  'Mundiales júnior-cadete': /World.*Championship|Championnats du monde/i,
  'Copas del Mundo': /World Cup|Coupe du Monde/i,
  Satélites: /Satellite|satellite/i,
  // Una sola prueba mixta por equipos continentales repartida por la FIE en seis
  // pruebas de arma y género: no tiene correspondencia con ninguna de ellas.
  'JOJ 2018 mixto': null,
};

/**
 * Ventanas de búsqueda fijadas a mano cuando la FIE conserva fechas que no son las
 * celebradas. La FIE sitúa el Mediterráneo U20/U17/U15 de 2022 en Al Salt en enero;
 * Ophardt no tiene ninguno en enero y publica «18 Mediterranean Championships 2022»
 * (U15/U17/U20) en Ammán en mayo, entre el 17.º (2020) y el 19.º (2023).
 */
const VENTANAS: Record<string, [string, string]> = {
  'Mediterranean Fencing Championship U20, U17, U15|2022': ['2022-05-10', '2022-05-16'],
};

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);
const fecha = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

type Instancia = { clave: string; grupo: string; objetivos: Objetivo[]; desde: string; hasta: string; tbd: boolean };

function instancias(objetivos: Objetivo[]): Instancia[] {
  const m = new Map<string, Objetivo[]>();
  for (const o of objetivos) {
    if (esMarcadorFie(o)) continue;
    const k = `${o.editionName.trim()}|${o.season}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push(o);
  }
  return [...m].map(([clave, os]) => {
    const fechas = os.map(fechaDe).sort();
    const tbd = os.some((o) => !o.city || /^TBD$/i.test(o.city.trim()));
    const a = dia(fechas[0]);
    const b = dia(fechas[fechas.length - 1]);
    const [desde, hasta] = VENTANAS[clave] ?? [fecha(a - (tbd ? 25 : 7)), fecha(b + (tbd ? 25 : 3))];
    return { clave, grupo: grupoDe(os[0].editionName), objetivos: os, tbd, desde, hasta };
  });
}

// ---------------------------------------------------------------------------
// Listado de torneos con resultados
// ---------------------------------------------------------------------------

export type TorneoOphardt = { id: string; desde: string; nacion: string; ciudad: string; titulo: string; edades: string };

export function parsearListado(html: string): { torneos: TorneoOphardt[]; paginas: number } {
  const torneos: TorneoOphardt[] = [];
  const cuerpo = html.slice(html.indexOf('<tbody>'));
  for (const fila of cuerpo.matchAll(/<tr\s*>([\s\S]*?)<\/tr>/g)) {
    const celdas = [...fila[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    const id = /\/en\/search\/results\/(\d+)/.exec(fila[1])?.[1];
    if (!id || celdas.length < 6) continue;
    const [d, mes, an] = limpiar(celdas[1]).split('.');
    torneos.push({
      id, desde: `${an}-${mes}-${d}`, nacion: limpiar(celdas[2]).split(' ')[0] ?? '', ciudad: limpiar(celdas[3]),
      titulo: limpiar(celdas[4]), edades: limpiar(celdas[5]),
    });
  }
  const paginas = Math.max(1, ...[...html.matchAll(/(?:[?&]|&amp;)page=(\d+)/g)].map((m) => Number(m[1])));
  return { torneos, paginas };
}

const urlListado = (desde: string, hasta: string, pagina: number) =>
  `${BASE}/en/search/results?date-from=${desde}&date-to=${hasta}${pagina > 1 ? `&page=${pagina}` : ''}`;
export const urlResultados = (id: string) => `${BASE}/en/search/results/${id}`;

async function listado(desde: string, hasta: string, red: boolean): Promise<TorneoOphardt[]> {
  const todos: TorneoOphardt[] = [];
  for (let p = 1, max = 1; p <= max && p <= 30; p += 1) {
    const url = urlListado(desde, hasta, p);
    const d = red ? await obtener(url) : enCache(url);
    const html = texto(d);
    if (!html) break;
    const r = parsearListado(html);
    todos.push(...r.torneos);
    max = r.paginas;
  }
  return todos;
}

// ---------------------------------------------------------------------------
// Página de resultados de un torneo
// ---------------------------------------------------------------------------

type Arma = Objetivo['weapon'];
type Categoria = Objetivo['category'];

export type SeccionOphardt = {
  titulo: string;
  weapon: Arma | null;
  gender: Objetivo['gender'] | null;
  category: Categoria | null;
  format: Objetivo['format'] | null;
  individuales: FilaPublicada[];
  equipos: Omit<FilaPublicada, 'birthYear'>[];
  equiposDeducidos?: boolean;
};

export function atributosTitulo(titulo: string): Pick<SeccionOphardt, 'weapon' | 'gender' | 'category' | 'format'> {
  const t = titulo.toLowerCase();
  const weapon: Arma | null = /\b(epee|épée)\b/.test(t) ? 'ESPADA' : /\bfoil\b/.test(t) ? 'FLORETE' : /\bsabre\b|\bsaber\b/.test(t) ? 'SABLE' : null;
  const gender = /\bwomen'?s?\b/.test(t) ? 'F' : /\bmen'?s?\b/.test(t) ? 'M' : /\bmixed\b/.test(t) ? 'MIXTO' : null;
  const format = /\bteam\b/.test(t) ? 'EQUIPOS' : /\bindividual\b/.test(t) ? 'INDIVIDUAL' : null;
  let category: Categoria | null = 'ABS';
  const u = /\bu ?(\d{2})\b/.exec(t);
  if (u) {
    const mapa: Record<string, Categoria> = { '15': 'M15', '17': 'M17', '20': 'M20', '23': 'M23', '13': 'M13', '14': 'M14', '12': 'M12' };
    category = mapa[u[1]] ?? null;
  } else if (/\b(cadet)/.test(t)) category = 'M17';
  else if (/\bjunior/.test(t)) category = 'M20';
  else if (/\bveteran|\bv ?\d0\b|\b\d0\+/.test(t)) category = 'VET';
  return { weapon, gender, category, format };
}

export function parsearResultados(html: string): SeccionOphardt[] {
  const secciones: SeccionOphardt[] = [];
  const cabecera = /<th>([^<]+)<\/th>\s*<th width="200"/g;
  const posiciones = [...html.matchAll(cabecera)];
  for (let i = 0; i < posiciones.length; i += 1) {
    const titulo = limpiar(posiciones[i][1]);
    const trozo = html.slice(posiciones[i].index!, i + 1 < posiciones.length ? posiciones[i + 1].index! : html.length);
    const s: SeccionOphardt = { titulo, ...atributosTitulo(titulo), individuales: [], equipos: [] };
    const cuerpo = trozo.slice(trozo.indexOf('<thead>'));
    for (const fila of cuerpo.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const celdas = [...fila[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
      if (celdas.length < 8) continue;
      const enlace = /\/en\/biography\/(athlete|team)\/([^"]+)"/.exec(celdas[3]);
      const nombre = limpiar(celdas[3]);
      if (!nombre) continue;
      const rango = limpiar(celdas[0]);
      const estado = limpiar(celdas[1]);
      const posicion = /^\d+$/.test(rango) && Number(rango) > 0 ? Number(rango) : null;
      const nacion = limpiar(celdas[7]).toUpperCase();
      const club = limpiar(celdas[8] ?? '') || null;
      // Algunos tiradores clasificados no tienen ficha pública en Ophardt; siguen siendo puestos.
      const ficha = enlace ? enlace[2] : `sin-ficha:${normalizarNombre(nombre).replace(/\s+/g, '-')}:${nacion}`;
      const base = {
        claveFuente: `ophardt:${ficha}`, name: nombre, countryCode: /^[A-Z]{3}$/.test(nacion) ? nacion : null, club,
        position: posicion, positionRaw: [rango, estado && estado !== 'N' ? estado : ''].filter(Boolean).join(' ') || null,
      };
      if (enlace?.[1] === 'team') s.equipos.push({ ...base, club: null });
      else {
        const yob = Number(limpiar(celdas[4]));
        s.individuales.push({ ...base, birthYear: Number.isInteger(yob) && yob > 1900 && yob <= 2030 ? yob : null });
      }
    }
    // Algunas secciones por equipos sólo listan a los integrantes con el puesto de su equipo.
    if (s.format === 'EQUIPOS' && s.equipos.length === 0) {
      const vistos = new Set<string>();
      for (const m of s.individuales) {
        const k = `${m.countryCode}|${m.position}`;
        if (!m.countryCode || m.position === null || vistos.has(k)) continue;
        vistos.add(k);
        s.equipos.push({ claveFuente: `ophardt:team:${m.countryCode}`, name: m.countryCode, countryCode: m.countryCode, club: null, position: m.position, positionRaw: m.positionRaw });
      }
      s.equiposDeducidos = s.equipos.length > 0;
    }
    secciones.push(s);
  }
  return secciones;
}

// ---------------------------------------------------------------------------
// Emparejamiento
// ---------------------------------------------------------------------------

type Candidato = { torneo: TorneoOphardt; secciones: SeccionOphardt[]; url: string; sha256: string };

function candidatosDe(inst: Instancia, torneos: TorneoOphardt[]): TorneoOphardt[] {
  const patron = TITULOS[inst.grupo];
  if (!patron) return [];
  const pais = inst.objetivos[0].countryCode;
  return torneos.filter((t) => {
    if (!patron.test(t.titulo)) return false;
    if (inst.grupo === 'Copas del Mundo' || inst.grupo === 'Satélites') return t.nacion === pais;
    return true;
  });
}

const seccionCasa = (s: SeccionOphardt, o: Objetivo) =>
  s.weapon === o.weapon && s.gender === o.gender && s.category === o.category && s.format === o.format &&
  (o.format === 'EQUIPOS' ? s.equipos.length > 0 : s.individuales.length > 0);

export type Asignacion =
  | { ok: true; candidato: Candidato; seccion: SeccionOphardt }
  | { ok: false; motivo: string };

function asignar(o: Objetivo, candidatos: Candidato[]): Asignacion {
  const casan = candidatos.flatMap((c) => c.secciones.filter((s) => seccionCasa(s, o)).map((s) => ({ c, s })));
  if (casan.length === 0) return { ok: false, motivo: candidatos.length ? 'ninguna_seccion_casa' : 'sin_torneo_ophardt' };
  if (casan.length > 1) {
    const mismoPais = casan.filter((x) => x.c.torneo.nacion === o.countryCode);
    if (mismoPais.length === 1) return { ok: true, candidato: mismoPais[0].c, seccion: mismoPais[0].s };
    return { ok: false, motivo: `ambigua:${casan.map((x) => x.c.torneo.id).join(',')}` };
  }
  return { ok: true, candidato: casan[0].c, seccion: casan[0].s };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function recorrer(red: boolean) {
  const db = abrirBase(argumento('db', NUEVO_POR_DEFECTO));
  const objetivos = cargarObjetivos(db);
  const lista = instancias(objetivos);
  const porInstancia: { inst: Instancia; candidatos: Candidato[] }[] = [];
  for (const inst of lista) {
    const torneos = TITULOS[inst.grupo] ? await listado(inst.desde, inst.hasta, red) : [];
    const candidatos: Candidato[] = [];
    for (const t of candidatosDe(inst, torneos)) {
      const url = urlResultados(t.id);
      const d = red ? await obtener(url) : enCache(url);
      const html = texto(d);
      if (!html || !d?.sha256) continue;
      candidatos.push({ torneo: t, secciones: parsearResultados(html), url, sha256: d.sha256 });
    }
    porInstancia.push({ inst, candidatos });
    if (red) console.log(`${inst.clave}: ${torneos.length} torneos, candidatos ${candidatos.map((c) => `${c.torneo.id} ${c.torneo.titulo}`).join(' / ') || '-'}`);
  }
  return { db, objetivos, porInstancia };
}

async function hechos() {
  const salida = argumento('salida', SALIDA_HECHOS);
  mkdirSync(salida, { recursive: true });
  const { db, objetivos, porInstancia } = await recorrer(false);
  const indice = indicePersonasFie(db);
  db.close();
  const informe: Record<string, unknown>[] = [];
  let escritos = 0;
  for (const { inst, candidatos } of porInstancia) {
    for (const o of inst.objetivos) {
      const a = asignar(o, candidatos);
      if (!a.ok) {
        informe.push({ grupo: inst.grupo, season: o.season, competitionKey: o.competitionKey, motivo: a.motivo });
        continue;
      }
      const notas = [
        `Clasificación final publicada en Ophardt Online, torneo ${a.candidato.torneo.id} «${a.candidato.torneo.titulo}» (${a.candidato.torneo.nacion} ${a.candidato.torneo.ciudad}), sección «${a.seccion.titulo}»; la FIE no publica esta prueba`,
        'Ophardt no publica asaltos',
      ];
      let results;
      if (o.format === 'EQUIPOS') {
        results = resultadosEquipos(a.seccion.equipos, 'ophardt');
        notas.push('Prueba por equipos: factKey team:ophardt:<nación>; sin persona');
        if (a.seccion.equiposDeducidos) notas.push('Ophardt sólo lista a los integrantes con el puesto del equipo: un equipo por nación y puesto, con el código de la nación como nombre');
      } else {
        const r = resultadosIndividuales(a.seccion.individuales, o.gender, indice);
        results = r.results;
        notas.push(`${r.vinculados} de ${results.length} puestos con factKey = ID FIE de la única persona FIE con el mismo nombre, nación y género (vínculo por nombre; fieId vacío porque Ophardt no lo publica); el resto, ophardt:<ficha>`);
      }
      // Con empates el último puesto nunca supera el número de filas; si lo supera, faltan tiradores.
      const ultimo = Math.max(0, ...results.map((r) => r.position ?? 0));
      const completo = ultimo <= results.length;
      if (!completo) notas.push(`Clasificación incompleta: último puesto ${ultimo} con ${results.length} filas publicadas`);
      const h = construirHechos(o, {
        extractor: 'ophardt_resultados',
        sourceUrl: a.candidato.url,
        sourceSha256: a.candidato.sha256,
        results,
        bouts: [],
        status: {
          results: completo ? 'completo' : 'parcial', pools: 'sin_resultados', tableau: 'sin_resultados',
          publishedParticipants: results.length, notes: notas,
        },
      });
      writeFileSync(join(salida, ficheroHechos(h)), `${JSON.stringify(h, null, 1)}\n`);
      escritos += 1;
      informe.push({
        grupo: inst.grupo, season: o.season, competitionKey: o.competitionKey, fechaFie: fechaDe(o), ciudadFie: o.city,
        torneo: a.candidato.torneo.id, fechaTorneo: a.candidato.torneo.desde,
        lugarTorneo: `${a.candidato.torneo.nacion} ${a.candidato.torneo.ciudad}`, tituloTorneo: a.candidato.torneo.titulo,
        seccion: a.seccion.titulo, puestos: results.length, estado: h.status.results,
      });
    }
  }
  const marcadores = objetivos.filter(esMarcadorFie).map((o) => ({ grupo: grupoDe(o.editionName), season: o.season, competitionKey: o.competitionKey, motivo: 'marcador_fie_temporada_siguiente' }));
  writeFileSync(INFORME_OPHARDT, `${JSON.stringify([...informe, ...marcadores], null, 1)}\n`);
  console.log(`${escritos} ficheros de hechos en ${salida}; informe en ${INFORME_OPHARDT}`);
}

async function main() {
  const orden = process.argv[2];
  if (orden === 'descargar') await recorrer(true);
  else if (orden === 'hechos') await hechos();
  else throw new Error('uso: fie-huecos-ophardt.ts descargar|hechos [--db <sqlite>] [--salida <dir>]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { desentidad };
