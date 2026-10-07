/**
 * Prueba de Engarde -> hechos `engarde` (formato común). La usan el lote manual
 * (`scripts/indexado/engarde-a-hechos.ts` y los lotes que lo reutilizan) y la ingesta
 * automática. Sin red ni disco: recibe el HTML ya descargado.
 *
 * Claves: edición `engarde:{org}/{evt}`, prueba `engarde:{org}/{evt}/{compe}`,
 * participante `engarde:<nombre normalizado>|<nación o club>` (la misma de
 * `puestosDeEngarde`). Engarde no publica licencia ni ID: nunca se infieren.
 */
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import { normalizeSportName } from '@/lib/identity/resolver';
import { FusionAsaltos } from '../asaltos-complementarios';
import { mapCategory } from '../mappers';
import { parsearPaginaEngarde, puestosDeEngarde, urlPruebaEngarde, type PaginaEngarde, type PruebaEngarde } from '../sources/engarde';
import { parsearCuadroEngarde } from '../sources/engarde-cuadro';
import { parsearPoulesEngarde } from '../sources/engarde-poules';
import { hechosPrueba, type AsaltoHecho, type HechosPrueba, type ResultadoHecho } from './formato';
import { nombresEnComun, prepararNombre, type NombrePreparado } from './nombres-prueba';

type Fase = 'POULE' | 'TABLEAU';
const FASES: readonly Fase[] = ['POULE', 'TABLEAU'];
const diaIso = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** Páginas de la prueba enlazadas desde su portada (clasificación final, poules, cuadros). */
export function paginasDePrueba(html: string, org: string, evt: string, compe: string): string[] {
  const raiz = `/competition/${org}/${evt}/${compe}/`.toLowerCase();
  const vistas = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const ruta = m[1].replace(/^https?:\/\/(www\.)?engarde-service\.com/i, '').replace(/^\/\/(www\.)?engarde-service\.com/i, '');
    if (!ruta.toLowerCase().startsWith(raiz)) continue;
    const pagina = ruta.slice(raiz.length).split(/[?#]/)[0];
    if (/^(clasfinal|poules\d{1,2}|tableau[\w-]{1,20})\.htm$/i.test(pagina)) vistas.add(pagina);
  }
  return [...vistas].sort();
}
type Genero = HechosPrueba['competition']['gender'];
type Categoria = HechosPrueba['competition']['category'];
type Estado = HechosPrueba['status']['results'];

const dia = (f: string) => Math.round(Date.parse(`${f}T00:00:00Z`) / 86_400_000);

/** Temporada RFEE (septiembre-agosto) de una fecha ISO. */
export function temporadaRfee(fecha: string): string {
  const a = Number(fecha.slice(0, 4));
  const m = Number(fecha.slice(5, 7));
  return m >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}

/** Engarde marca el sexo `n` (o `x`) en las pruebas mixtas, que `mapGender` no reconoce. */
export function generoEngarde(p: Pick<PruebaEngarde, 'genero'>, sexe: string | null): Genero | null {
  if (p.genero) return p.genero;
  return sexe && /^(n|x|mixte?|mixed|mixto)$/i.test(sexe.trim()) ? 'MIXTO' : null;
}

const CATEGORIA_TITULO: [RegExp, Categoria][] = [
  [/\bveteran|\bvet\b/, 'VET'],
  [/\babsolut|\bsenior/, 'ABS'],
  [/\bjunior|\bm-?20\b|\bu-?20\b|\bsub-?20\b/, 'M20'],
  [/\bcadet|\bm-?17\b|\bu-?17\b|\bsub-?17\b/, 'M17'],
  [/\binfantil|\bm-?15\b|\bu-?15\b|\bsub-?15\b/, 'M15'],
  [/\bm-?14\b|\bu-?14\b/, 'M14'],
  [/\balevin|\bm-?13\b|\bu-?13\b/, 'M13'],
  [/\bsub-?23\b|\bm-?23\b|\bu-?23\b/, 'M23'],
];

/** Categoría de la prueba: la del índice; si falta, una única que nombre el título. */
export function categoriaEngarde(categorie: string | null, titulo: string): Categoria | null {
  const delIndice = mapCategory(categorie);
  if (delIndice) return delIndice;
  if (categorie && categorie.trim()) return null;
  const t = titulo.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const halladas = new Set(CATEGORIA_TITULO.filter(([re]) => re.test(t)).map(([, c]) => c));
  return halladas.size === 1 ? [...halladas][0] : null;
}

export type PruebaIndice = PruebaEngarde & { sexe: string | null; categoriaFinal: Categoria | null; generoFinal: Genero | null };

/** `null` = nombre vacío o repetido en la clasificación (ambiguo). */
type Referencias = { deNombre: (nombre: string) => string | null };

/** Referencia de un tirador de poule o cuadro: el `factKey` de su puesto, por nombre normalizado único. */
export function referencias(puestos: readonly { clave: string; nombre: string }[]): Referencias {
  const porNombre = new Map<string, string | null>();
  for (const p of puestos) {
    const n = normalizeSportName(p.nombre);
    porNombre.set(n, porNombre.has(n) ? null : p.clave);
  }
  return {
    deNombre(nombre) {
      const n = normalizeSportName(nombre);
      if (!n) return null;
      if (porNombre.has(n)) return porNombre.get(n) ?? null;
      return `engarde:${n}|`;
    },
  };
}

/**
 * La plantilla catalana titula la clasificación final «Classificació general»,
 * sin «final». Se acepta como final sólo si el índice da la prueba por
 * terminada y el título no es el de una fase (después de poules, de una ronda…).
 */
export function esGeneralDePruebaTerminada(encabezado: string | null, estadoIndice: string): boolean {
  if (estadoIndice !== 'completed' || !encabezado) return false;
  const t = encabezado.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /\b(general|overall)\b/.test(t) && !/poule|ronda|tour|round|despues|after|apres|despres|provisional|provisoire/.test(t);
}

const SIN_PUESTO = /\b(abandon\w*|retirad[oa]|retir[eé]e?|withdrawn|exclu\w*|expulsad[oa]|descalificad[oa]|disqualifi\w*|dnf|dns|dsq|abs|absent\w*|ausente|forfait|scratch|no presentad[oa]|no se presenta)\b/i;

/**
 * Engarde deja vacía la celda de puesto de los tiradores que abandonan o son
 * excluidos y anota el motivo en otra columna; el lector de clasificaciones
 * descarta esas filas como ilegibles. Se copia el motivo a la celda de puesto
 * para que la fila se lea con puesto nulo.
 */
export function marcarFilasSinPuesto(html: string): string {
  const $ = cheerio.load(html);
  let cambios = 0;
  $('table.liste tr').each((_, tr) => {
    const celdas = $(tr).children('td');
    if (celdas.length < 2) return;
    const primera = celdas.eq(0);
    if (primera.text().replace(/\s+/g, '').length > 0) return;
    const motivo = celdas
      .toArray()
      .slice(1)
      .map((c) => $(c).text().replace(/\s+/g, ' ').trim())
      .map((t) => t.match(SIN_PUESTO)?.[0])
      .find(Boolean);
    if (!motivo) return;
    primera.text(motivo.toLowerCase());
    cambios += 1;
  });
  return cambios > 0 ? $.html() : html;
}

export type Paginas = { prueba: string; clasfinal?: string | null; poules: { pagina: number; html: string }[]; cuadros: { url: string; html: string }[]; faltan: string[] };

export type Conversion =
  | { ok: true; hechos: HechosPrueba }
  | { ok: false; motivo: string };

export function convertirPrueba(
  p: PruebaIndice,
  paginas: Paginas,
  ctx: { season: string; nombreTorneo: string; inicio: string | null; fin: string | null; ciudad: string | null },
): Conversion {
  if (!p.arma || !p.generoFinal || !p.categoriaFinal || p.individual === null) {
    return { ok: false, motivo: 'atributos_incompletos' };
  }
  let pagina: PaginaEngarde = parsearPaginaEngarde(marcarFilasSinPuesto(paginas.prueba));
  // La portada de la prueba muestra el último documento publicado (a veces las poules);
  // la clasificación final, si existe, está en `clasfinal.htm`.
  if (pagina.tipo !== 'clasificacion' && paginas.clasfinal) {
    const final = parsearPaginaEngarde(marcarFilasSinPuesto(paginas.clasfinal));
    if (final.tipo !== 'desconocida') pagina = { ...final, cuadros: pagina.cuadros };
  }
  if (pagina.tipo === 'clasificacion_provisional' && esGeneralDePruebaTerminada(pagina.encabezado, p.estado)) {
    pagina.tipo = 'clasificacion';
  }
  const notas: string[] = [];
  const individual = p.individual === true;

  // Puestos.
  let estadoResultados: Estado;
  let resultados: ResultadoHecho[] = [];
  const puestos = pagina.tipo === 'clasificacion' ? puestosDeEngarde(pagina) : [];
  if (pagina.tipo !== 'clasificacion') {
    estadoResultados = 'sin_resultados';
    notas.push(
      pagina.tipo === 'clasificacion_provisional'
        ? 'Engarde sólo publica una clasificación provisional, no la final'
        : 'Engarde no publica clasificación final para esta prueba',
    );
  } else {
    resultados = puestos.map((x) => ({
      factKey: x.clave,
      name: x.nombre,
      countryCode: x.pais && /^[A-Z]{3}$/.test(x.pais) ? x.pais : null,
      club: x.club ?? (x.pais && !/^[A-Z]{3}$/.test(x.pais) ? x.pais : null),
      position: x.posicion,
      positionRaw: x.posicionRaw,
      points: null,
      fieId: null,
      license: null,
      birthYear: null,
    }));
    const total = pagina.publicado ?? resultados.length;
    if (resultados.length === 0 && pagina.anomalias === 0) estadoResultados = 'sin_resultados';
    else if (resultados.length === total && pagina.anomalias === 0) estadoResultados = 'completo';
    else {
      estadoResultados = 'parcial';
      notas.push(`Clasificación: se leyeron ${resultados.length} de ${total} filas publicadas`);
    }
  }
  const refs = referencias(puestos);
  const asaltos: AsaltoHecho[] = [];

  // Poules.
  let estadoPoules: Estado;
  if (!individual) {
    estadoPoules = 'sin_resultados';
    notas.push('Prueba por equipos: no se importan asaltos individuales');
  } else if (paginas.poules.length === 0) {
    estadoPoules = 'sin_resultados';
    notas.push('Engarde no publica poules para esta prueba');
  } else {
    let esperados = 0;
    let importados = 0;
    let ilegibles = 0;
    for (const { pagina: n, html } of paginas.poules) {
      const r = parsearPoulesEngarde(html, { pagina: n });
      if (r.estado !== 'leido') {
        ilegibles += 1;
        continue;
      }
      esperados += r.esperados;
      for (const b of r.asaltos) {
        const aRef = refs.deNombre(b.a.nombre);
        const bRef = refs.deNombre(b.b.nombre);
        if (!aRef || !bRef || aRef === bRef) continue;
        asaltos.push({
          phase: 'POULE', roundKey: b.ronda, aRef, bRef, aName: b.a.nombre, bName: b.b.nombre,
          scoreA: b.a.tocados, scoreB: b.b.tocados, winner: b.ganador,
        });
        importados += 1;
      }
    }
    if (importados === 0) {
      estadoPoules = ilegibles > 0 ? 'ilegible' : 'sin_resultados';
      notas.push(ilegibles > 0 ? 'Las poules publicadas no tienen un formato reconocido' : 'Las poules publicadas no traen asaltos legibles');
    } else if (importados === esperados && ilegibles === 0 && paginas.faltan.every((f) => !f.startsWith('poules'))) {
      estadoPoules = 'completo';
    } else {
      estadoPoules = 'parcial';
      notas.push(`Poules: se importaron ${importados} de ${esperados} asaltos esperados${ilegibles ? `; ${ilegibles} página(s) sin formato reconocido` : ''}`);
    }
  }

  // Cuadro.
  let estadoCuadro: Estado;
  if (!individual) estadoCuadro = 'sin_resultados';
  else if (paginas.cuadros.length === 0) {
    estadoCuadro = 'sin_resultados';
    notas.push('Engarde no publica cuadro para esta prueba');
  } else {
    const fusion = new FusionAsaltos();
    let ilegibles = 0;
    for (const { url, html } of paginas.cuadros) {
      const c = parsearCuadroEngarde(html, { individual: true });
      if (c.estado !== 'leido') {
        ilegibles += 1;
        continue;
      }
      fusion.anadir(c, url);
    }
    const parte = fusion.resumen(ilegibles === 0 && paginas.faltan.every((f) => !f.startsWith('tableau')));
    let sinRef = 0;
    for (const b of parte.asaltos) {
      const ra = refs.deNombre(b.nombreA);
      const rb = refs.deNombre(b.nombreB);
      if (!ra || !rb || ra === rb) {
        sinRef += 1;
        continue;
      }
      const ronda = b.ronda === 'SF' ? 'T4' : b.ronda === 'F' ? 'T2' : b.ronda;
      asaltos.push({
        phase: 'TABLEAU', roundKey: ronda, aRef: ra, bRef: rb, aName: b.nombreA, bName: b.nombreB,
        scoreA: Math.min(b.puntosA, 45), scoreB: Math.min(b.puntosB, 45), winner: null,
      });
    }
    const importados = parte.importado - sinRef;
    if (importados <= 0) {
      estadoCuadro = ilegibles > 0 ? 'ilegible' : 'sin_resultados';
      notas.push(ilegibles > 0 ? 'El cuadro publicado no tiene un formato reconocido' : 'El cuadro publicado no trae asaltos legibles');
    } else if (parte.completo && sinRef === 0) estadoCuadro = 'completo';
    else {
      estadoCuadro = 'parcial';
      notas.push(`Cuadro: se importaron ${importados} de ${parte.publicado} cruces publicados`);
    }
  }

  if (resultados.length === 0 && asaltos.length === 0) return { ok: false, motivo: 'sin_hechos' };

  const fecha = p.fecha ?? pagina.fecha;
  const h: HechosPrueba = {
    version: 1,
    source: 'engarde',
    extractor: 'lector_engarde',
    sourceUrl: urlPruebaEngarde(p.org, p.evt, p.compe),
    sourceSha256: createHash('sha256').update(paginas.prueba).digest('hex'),
    edition: {
      season: ctx.season,
      tournamentKey: `engarde:${p.org}/${p.evt}`,
      name: ctx.nombreTorneo,
      startDate: ctx.inicio,
      endDate: ctx.fin,
      city: ctx.ciudad,
      countryCode: p.pais && /^[A-Z]{3}$/.test(p.pais) ? p.pais : null,
    },
    competition: {
      competitionKey: `engarde:${p.org}/${p.evt}/${p.compe}`,
      weapon: p.arma,
      gender: p.generoFinal,
      category: p.categoriaFinal,
      categoryRaw: (p.categoriaOriginal ?? p.titulo) || null,
      format: individual ? 'INDIVIDUAL' : 'EQUIPOS',
      date: fecha,
    },
    status: {
      results: estadoResultados,
      pools: estadoPoules,
      tableau: estadoCuadro,
      publishedParticipants: pagina.tipo === 'clasificacion' ? (pagina.publicado ?? resultados.length) : null,
      notes: notas,
    },
    results: resultados,
    bouts: asaltos,
  };
  return { ok: true, hechos: hechosPrueba.parse(h) };
}


// ------------------------------------------------------------------ validación y emparejado con Skermo

/** Asalto con marcador coherente: ganador determinable y con más tocados, poule ≤ 5, cuadro ≤ 15. */
export function asaltoValido(b: Pick<AsaltoHecho, 'phase' | 'scoreA' | 'scoreB' | 'winner'>): boolean {
  const max = b.phase === 'POULE' ? 5 : 15;
  if (b.scoreA > max || b.scoreB > max) return false;
  if (b.winner === null) return b.scoreA !== b.scoreB;
  return b.winner === 'A' ? b.scoreA >= b.scoreB : b.scoreB >= b.scoreA;
}

export function validarMarcadores(h: HechosPrueba): { hechos: HechosPrueba; descartados: Record<Fase, number> } {
  const descartados: Record<Fase, number> = { POULE: 0, TABLEAU: 0 };
  const bouts = h.bouts.filter((b) => {
    if (asaltoValido(b)) return true;
    descartados[b.phase] += 1;
    return false;
  });
  const status = { ...h.status, notes: [...h.status.notes] };
  for (const f of FASES) {
    if (descartados[f] === 0) continue;
    const clave = f === 'POULE' ? 'pools' : 'tableau';
    const quedan = bouts.some((b) => b.phase === f);
    status[clave] = quedan ? 'parcial' : 'ilegible';
    status.notes.push(`${f === 'POULE' ? 'Poules' : 'Cuadro'}: ${descartados[f]} asalto(s) descartado(s) por marcador incoherente`);
  }
  return { hechos: hechosPrueba.parse({ ...h, status, bouts }), descartados };
}

export function nombresDeHechos(h: HechosPrueba): NombrePreparado[] {
  const vistos = new Set<string>();
  const out: NombrePreparado[] = [];
  const fuente = h.results.length > 0 ? h.results.map((r) => r.name) : h.bouts.flatMap((b) => [b.aName, b.bName]);
  for (const n of fuente) {
    const p = prepararNombre(n);
    if (!p.norm || vistos.has(p.norm)) continue;
    vistos.add(p.norm);
    out.push(p);
  }
  return out;
}


/** Lo mínimo de una prueba de Skermo para casarla con una de Engarde. */
export type PruebaSkermoCasable = { id: string; source: string; weapon: string; gender: string; fecha: string; nombres: readonly NombrePreparado[] };

export type Casamiento<T extends PruebaSkermoCasable = PruebaSkermoCasable> = { casan: T[]; cobertura: number };

/**
 * Pruebas de Skermo que son esta prueba de Engarde: cada una con al menos el 80 % de sus
 * tiradores en Engarde y, entre todas, al menos el 60 % de los tiradores de Engarde.
 */
export function casarConSkermo<T extends PruebaSkermoCasable>(
  e: { weapon: string; gender: string; fecha: string; nombres: readonly NombrePreparado[] },
  skermo: readonly T[],
): Casamiento<T> {
  if (e.nombres.length === 0) return { casan: [], cobertura: 0 };
  const casan = skermo.filter((s) => {
    if (s.source !== 'skermo_rfee' || s.weapon !== e.weapon || s.nombres.length === 0) return false;
    if (e.gender !== 'MIXTO' && s.gender !== 'MIXTO' && s.gender !== e.gender) return false;
    if (Math.abs(diaIso(s.fecha) - diaIso(e.fecha)) > 1) return false;
    return nombresEnComun(s.nombres, e.nombres) >= Math.max(1, Math.ceil(0.8 * s.nombres.length));
  });
  const union = casan.flatMap((s) => s.nombres);
  const cobertura = casan.length ? nombresEnComun(e.nombres, union) / e.nombres.length : 0;
  // Un TNR abierto a extranjeros: Skermo sólo clasifica a los licenciados, que están todos en la
  // prueba de Engarde, pero son menos del 60 % de sus tiradores.
  const contenida = casan.some((s) => s.nombres.length >= 10 && nombresEnComun(s.nombres, e.nombres) >= Math.ceil(0.95 * s.nombres.length));
  return cobertura >= 0.6 || (contenida && cobertura >= 0.3) ? { casan, cobertura } : { casan: [], cobertura };
}

