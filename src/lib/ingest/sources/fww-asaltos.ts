import * as cheerio from 'cheerio';
import { fixDoubleEncodedUtf8 } from '../fetcher';
import {
  AcumuladorAsaltos,
  type ParteAsaltosComplementarios,
} from '../asaltos-complementarios';
import { claveRondaCuadro } from './engarde-cuadro';
import { depsEngardeReales, type DepsEngarde, type EstadoLecturaComplementaria } from './engarde';
import { destinoFww, parsearResultadosFww, parsearUrlFww, type DestinoFww, type PaginaFww } from './fww';

/**
 * Asaltos individuales de Fencing Worldwide: rondas de poules (`pools/N`) y
 * cuadro de eliminación directa (`direct/N`).
 *
 * Layouts comprobados el 2026-10-01 en una prueba pública (World Cup of
 * Switzerland, espada masculina U17 individual):
 *  - `pools/N`: un `table.pool` por poule con la matriz de resultados. La celda
 *    de la fila i, columna j es «V5»/«D3» desde la perspectiva de i. Sólo se
 *    admite un asalto si AMBAS perspectivas están publicadas y son recíprocas
 *    (V x frente a D y con x > y); una sola celda, dos V o dos D no lo son.
 *  - `direct/N`: un `.fullmatch` por cruce con dos filas de participante
 *    (seed, nombre enlazado a `/athlete/{id}/`, nación, V/D y tanteo). Un BYE
 *    no es un asalto. La ronda sale del título («Table of 32: 1», «Semi-Final»,
 *    «Finale»); un título no reconocido deja el cruce excluido.
 *
 * El ID FWW del atleta es la referencia estable del participante; sin él no
 * hay asalto. Nunca se confirma una persona deportiva por nombre.
 */

const CELDA = /^([VD])\s*(\d{1,3})?$/i;

function limpio(s: string): string {
  return fixDoubleEncodedUtf8(s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

const refFww = (id: string) => `fww:athlete:${id}`;

type Celda = { resultado: 'V' | 'D'; puntos: number | null } | 'vacia' | 'ilegible';

function leerCelda(texto: string): Celda {
  const t = limpio(texto);
  if (t === '') return 'vacia';
  const m = t.match(CELDA);
  if (!m) return 'ilegible';
  return { resultado: m[1].toUpperCase() as 'V' | 'D', puntos: m[2] === undefined ? null : Number(m[2]) };
}

export function parsearPoulesFww(html: string, ronda: number): ParteAsaltosComplementarios {
  const $ = cheerio.load(html);
  const acumulador = new AcumuladorAsaltos();
  let completo = true;

  $('table.pool').each((indice, tabla) => {
    const t = $(tabla);
    const numero =
      t.prevAll('p').first().find('a[name^="pool-"]').attr('name')?.match(/^pool-(\d{1,3})$/)?.[1] ?? String(indice + 1);
    const claveRonda = `R${ronda}P${numero}`;
    const cabeceras = t
      .find('th')
      .map((_, th) => limpio($(th).text()))
      .get();
    const n = cabeceras.filter((h) => /^\d{1,2}$/.test(h)).length;
    const participantes: { id: string | null; nombre: string; celdas: Celda[] }[] = [];
    let legible = n >= 2;

    t.find('tr').each((_, tr) => {
      const tds = $(tr).children('td');
      const nombreCelda = $(tr).find('td.name').first();
      if (nombreCelda.length === 0) return;
      if (tds.length < 3 + n) {
        legible = false;
        return;
      }
      const enlace = nombreCelda.find('a[href^="/athlete/"]').first();
      const id = enlace.attr('href')?.match(/^\/athlete\/(\d+)\/?$/)?.[1] ?? null;
      participantes.push({
        id,
        nombre: limpio(enlace.length > 0 ? enlace.text() : nombreCelda.text()),
        celdas: Array.from({ length: n }, (_, j) => leerCelda(tds.eq(3 + j).text())),
      });
    });
    if (!legible || participantes.length !== n) {
      completo = false;
      return;
    }
    const ids = participantes.map((p) => p.id);
    const repetido = new Set(ids.filter((id, i) => id !== null && ids.indexOf(id) !== i));

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const x = participantes[i].celdas[j];
        const y = participantes[j].celdas[i];
        if (x === 'vacia' && y === 'vacia') continue;
        const a = participantes[i];
        const b = participantes[j];
        if (!a.id || !b.id || repetido.has(a.id) || repetido.has(b.id)) {
          acumulador.excluir('sinParticipante');
          continue;
        }
        if (x === 'vacia' || y === 'vacia') {
          acumulador.excluir('noReciproco');
          continue;
        }
        if (x === 'ilegible' || y === 'ilegible' || x.puntos === null || y.puntos === null) {
          acumulador.excluir('sinMarcador');
          continue;
        }
        if (x.resultado === y.resultado) {
          acumulador.excluir('incoherente');
          continue;
        }
        const [g, p, ganaA] = x.resultado === 'V' ? [x, y, true] : [y, x, false];
        if (!(g.puntos! > p.puntos!)) {
          acumulador.excluir('incoherente');
          continue;
        }
        acumulador.anadir({
          fase: 'POULE',
          ronda: claveRonda,
          a: { ref: refFww(a.id), nombre: a.nombre, puntos: ganaA ? g.puntos! : p.puntos! },
          b: { ref: refFww(b.id), nombre: b.nombre, puntos: ganaA ? p.puntos! : g.puntos! },
        });
      }
    }
  });

  return acumulador.resumen(completo);
}

export function parsearDirectaFww(html: string): ParteAsaltosComplementarios {
  const $ = cheerio.load(html);
  const acumulador = new AcumuladorAsaltos();
  let completo = true;

  $('.fullmatch').each((_, cruce) => {
    const c = $(cruce);
    const titulo = limpio(c.find('div.d-block.d-lg-none.small').first().contents().first().text()).replace(/:\s*\d+$/, '');
    const ronda = claveRondaCuadro(titulo);
    const filas = c.find('.derow').filter((__, r) => $(r).children('div.col-7').length > 0);
    if (filas.length !== 2) {
      completo = false;
      return;
    }
    const lado = filas.toArray().map((r) => {
      const hijos = $(r).children('div');
      const nombreCelda = hijos.eq(1);
      const enlace = nombreCelda.find('a[href^="/athlete/"]').first();
      return {
        bye: /bye/i.test(limpio(nombreCelda.text())) && enlace.length === 0,
        id: enlace.attr('href')?.match(/^\/athlete\/(\d+)\/?$/)?.[1] ?? null,
        nombre: limpio(enlace.length > 0 ? enlace.text() : nombreCelda.text()),
        resultado: limpio(hijos.eq(3).text()).toUpperCase(),
        puntos: limpio(hijos.eq(4).text()),
        columnas: hijos.length,
      };
    });
    if (lado.some((l) => l.columnas < 5)) {
      completo = false;
      return;
    }
    if (lado.some((l) => l.bye)) {
      acumulador.excluir('bye');
      return;
    }
    const sinResultado = lado.every((l) => l.resultado === '' && l.puntos === '');
    // Cruce aún sin disputar o sin participantes: no hay hecho publicado.
    if (sinResultado) {
      if (lado.some((l) => l.id === null)) return;
      acumulador.excluir('sinMarcador');
      return;
    }
    if (ronda === null) {
      acumulador.excluir('rondaDesconocida');
      return;
    }
    const [x, y] = lado;
    if (!x.id || !y.id || x.id === y.id) {
      acumulador.excluir('sinParticipante');
      return;
    }
    const px = /^\d{1,3}$/.test(x.puntos) ? Number(x.puntos) : null;
    const py = /^\d{1,3}$/.test(y.puntos) ? Number(y.puntos) : null;
    if (px === null || py === null || !['V', 'D'].includes(x.resultado) || !['V', 'D'].includes(y.resultado)) {
      acumulador.excluir('sinMarcador');
      return;
    }
    if (x.resultado === y.resultado || (x.resultado === 'V' ? !(px > py) : !(py > px))) {
      acumulador.excluir('incoherente');
      return;
    }
    acumulador.anadir({
      fase: 'TABLEAU',
      ronda,
      a: { ref: refFww(x.id), nombre: x.nombre, puntos: px },
      b: { ref: refFww(y.id), nombre: y.nombre, puntos: py },
    });
  });

  return acumulador.resumen(completo);
}

// ---------------------------------------------------------------------------
// Lectura del destino exacto
// ---------------------------------------------------------------------------

export type LecturaDestinoFww = {
  /** La URL que se pidió: la misma que se ofrece, nunca otra sección de la prueba. */
  url: string;
  destino: DestinoFww;
  estado: 'ok' | 'no_publicado' | 'error';
  httpStatus: number | null;
  /** Contexto (miga de pan) de la propia página pedida. */
  pagina: PaginaFww | null;
  parte: ParteAsaltosComplementarios | null;
  motivo: string | null;
};

/** `pools/N` y `direct/N` devuelven 200 aun sin contenido (ronda inexistente): el contenido decide. */
export async function leerDestinoFww(
  entrada: string,
  deps: Pick<DepsEngarde, 'get'> = depsEngardeReales,
): Promise<LecturaDestinoFww> {
  const u = parsearUrlFww(entrada);
  const destino: DestinoFww = u ? destinoFww(u) : { tipo: 'otro', numero: null };
  const falla = (estado: LecturaDestinoFww['estado'], httpStatus: number | null, motivo: string): LecturaDestinoFww => ({
    url: entrada,
    destino,
    estado,
    httpStatus,
    pagina: null,
    parte: null,
    motivo,
  });
  if (!u) return falla('error', null, 'La URL no es una prueba de Fencing Worldwide');

  let r;
  try {
    r = await deps.get(entrada);
  } catch (e) {
    return falla('error', null, (e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
  if (r.status === 404) return falla('no_publicado', 404, 'El destino no tiene página publicada (HTTP 404)');
  if (r.status !== 200) return falla('error', r.status, `HTTP ${r.status}`);

  const pagina = parsearResultadosFww(r.body);
  let parte: ParteAsaltosComplementarios | null = null;
  let hayContenido: boolean;
  switch (destino.tipo) {
    case 'pools':
      parte = parsearPoulesFww(r.body, destino.numero!);
      hayContenido = cheerio.load(r.body)('table.pool').length > 0;
      break;
    case 'direct':
      parte = parsearDirectaFww(r.body);
      hayContenido = cheerio.load(r.body)('.fullmatch').length > 0;
      break;
    case 'results':
      hayContenido = pagina.hayTabla;
      break;
    default:
      hayContenido = true;
  }
  if (!hayContenido) {
    return { ...falla('no_publicado', 200, 'La página no publica contenido en este destino'), pagina };
  }
  return { url: entrada, destino, estado: 'ok', httpStatus: 200, pagina, parte, motivo: null };
}

export type LecturaAsaltosFww = {
  estado: EstadoLecturaComplementaria;
  lecturas: LecturaDestinoFww[];
  fase: 'POULE' | 'TABLEAU';
  parte: ParteAsaltosComplementarios | null;
  motivo: string | null;
};

/** Agrega las lecturas de un mismo tipo (rondas de poules, o cuadro) en un estado de cobertura. */
export function agregarLecturasFww(
  fase: 'POULE' | 'TABLEAU',
  lecturas: readonly LecturaDestinoFww[],
): LecturaAsaltosFww {
  const base = { fase, lecturas: [...lecturas] };
  if (lecturas.length === 0) {
    return { ...base, estado: 'no_publicado', parte: null, motivo: 'La prueba no ofrece este destino' };
  }
  const buenas = lecturas.filter((l) => l.estado === 'ok' && l.parte);
  const fallos = lecturas.filter((l) => l.estado === 'error');
  if (buenas.length === 0) {
    return fallos.length > 0
      ? { ...base, estado: 'error', parte: null, motivo: fallos[0].motivo }
      : { ...base, estado: 'no_publicado', parte: null, motivo: lecturas[0].motivo };
  }
  const asaltos = new Map<string, ParteAsaltosComplementarios['asaltos'][number]>();
  let publicado = 0;
  let completo = fallos.length === 0 && buenas.length === lecturas.length;
  const excluidos = { ...buenas[0].parte!.excluidos };
  buenas.forEach((l, i) => {
    const p = l.parte!;
    publicado += p.publicado;
    completo &&= p.completo;
    if (i > 0) for (const k of Object.keys(excluidos) as (keyof typeof excluidos)[]) excluidos[k] += p.excluidos[k];
    for (const a of p.asaltos) asaltos.set(`${a.ronda}|${a.refA}|${a.refB}`, { ...a, url: l.url });
  });
  const parte: ParteAsaltosComplementarios = {
    asaltos: [...asaltos.values()],
    publicado,
    importado: asaltos.size,
    excluidos,
    completo: completo && asaltos.size === publicado,
  };
  return {
    ...base,
    estado: parte.completo ? 'completo' : 'parcial',
    parte,
    motivo: parte.completo ? null : `Se importaron ${parte.importado} de ${parte.publicado} cruces publicados`,
  };
}
