import * as cheerio from 'cheerio';
import { normalizeSportName } from '@/lib/identity/resolver';
import { fixDoubleEncodedUtf8 } from '../fetcher';
import {
  AcumuladorAsaltos,
  FusionAsaltos,
  motivoConflictos,
  type ParteAsaltosComplementarios,
} from '../asaltos-complementarios';
import {
  ENGARDE_BASE,
  depsEngardeReales,
  parsearPaginaEngarde,
  type DepsEngarde,
  type EstadoLecturaComplementaria,
  type PaginaEngarde,
  type PruebaEngarde,
} from './engarde';

/**
 * Asaltos individuales del cuadro de Engarde (`tableauNN.htm`).
 *
 * Layout comprobado el 2026-10-01 (Campeonato de Madrid ABS 2019, espada
 * masculina individual): una `table.tableau` cuya fila de cabecera nombra cada
 * ronda (`td.tableTitle`) y cuyas filas llevan los participantes de cada ronda
 * en su columna. Un asalto de la ronda R es un `td.score` («15/1», ganador
 * primero) en la columna de la ronda siguiente; el ganador está en la fila
 * inmediatamente superior de esa misma columna y los dos contendientes son los
 * participantes de la columna R más próximos por encima y por debajo de ese
 * ganador, a la misma distancia. Cualquier celda que no cumple esa geometría
 * (sin ganador, ganador que no es ninguno de los dos, marcador no numérico o
 * con el ganador por debajo) queda excluida y la lectura pasa a parcial.
 *
 * Engarde no publica ID de tirador: la referencia es nombre normalizado +
 * nación/club de la primera ronda, igual que la clave de la clasificación. Un
 * nombre repetido en esa columna es ambiguo y no genera asaltos. Los equipos y
 * los cuadros cuya modalidad no consta como individual no producen H2H.
 */

type Celda = { texto: string; clases: string[] };

const MAX_PAGINAS_CUADRO = 6;
const MARCADOR = /^(\d{1,3})\s*\/\s*(\d{1,3})$/;

function plano(t: string): string {
  return fixDoubleEncodedUtf8(t)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clave de ronda estable entre fuentes; `null` si el título no es una ronda regular (p. ej. tercer lugar). */
export function claveRondaCuadro(titulo: string): string | null {
  const t = plano(titulo);
  const n = t.match(/^(?:tableau|table|tabla|round)\s+(?:of|de|d)?\s*(\d{1,3})$/);
  if (n) return `T${n[1]}`;
  if (/^semi/.test(t)) return 'SF';
  if (/^final(?:e|es)?$/.test(t)) return 'F';
  return null;
}

export type CuadroEngarde = ParteAsaltosComplementarios & {
  estado: 'leido' | 'sin_cuadro' | 'equipos' | 'layout_no_reconocido';
  rondas: string[];
};

const vacio = (estado: CuadroEngarde['estado']): CuadroEngarde => ({
  estado,
  rondas: [],
  asaltos: [],
  publicado: 0,
  importado: 0,
  completo: false,
  excluidos: new AcumuladorAsaltos().excluidos,
  conflictos: [],
});

export function parsearCuadroEngarde(html: string, opciones: { individual: boolean | null }): CuadroEngarde {
  if (opciones.individual !== true) return vacio('equipos');
  const $ = cheerio.load(html);
  const tabla = $('table.tableau').first();
  if (tabla.length === 0) return vacio('sin_cuadro');
  if (tabla.find('td[colspan], td[rowspan]').length > 0) return vacio('layout_no_reconocido');

  const filas: Celda[][] = [];
  tabla.find('tr').each((_, tr) => {
    const celdas: Celda[] = [];
    $(tr)
      .children('td')
      .each((__, td) => {
        celdas.push({
          texto: fixDoubleEncodedUtf8($(td).text()).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(),
          clases: ($(td).attr('class') ?? '').split(/\s+/).filter(Boolean),
        });
      });
    filas.push(celdas);
  });

  const cabecera = filas.findIndex((f) => f.some((c) => c.clases.includes('tableTitle')));
  if (cabecera < 0) return vacio('layout_no_reconocido');
  const columnas = filas[cabecera]
    .map((c, i) => ({ i, titulo: c.texto, esTitulo: c.clases.includes('tableTitle') && c.texto !== '' }))
    .filter((c) => c.esTitulo)
    .map((c) => ({ columna: c.i, clave: claveRondaCuadro(c.titulo) }));
  if (columnas.length === 0) return vacio('layout_no_reconocido');

  const celda = (f: number, c: number): Celda | undefined => filas[f]?.[c];
  const esParticipante = (f: number, c: number): boolean => {
    const x = celda(f, c);
    return !!x && x.clases.includes('fencer') && x.texto !== '';
  };

  // Nación/club de la primera columna de la página y detección de nombres repetidos.
  const primera = columnas[0].columna;
  const nacionDe = new Map<string, string | null>();
  const ambiguos = new Set<string>();
  for (let f = cabecera + 1; f < filas.length; f += 1) {
    if (!esParticipante(f, primera)) continue;
    const nombre = celda(f, primera)!.texto;
    const nacion = celda(f, primera + 1)?.clases.includes('nation') ? celda(f, primera + 1)!.texto || null : null;
    if (nacionDe.has(nombre)) ambiguos.add(nombre);
    else nacionDe.set(nombre, nacion);
  }
  const refDe = (nombre: string): string | null =>
    nacionDe.has(nombre) && !ambiguos.has(nombre)
      ? `engarde:${normalizeSportName(nombre)}|${nacionDe.get(nombre) ?? ''}`
      : null;

  const acumulador = new AcumuladorAsaltos();
  const rondas: string[] = [];
  let regular = true;

  columnas.forEach(({ columna, clave }, k) => {
    const siguiente = columnas[k + 1];
    const salida = siguiente ? siguiente.columna : columna + 1;
    // Una columna intermedia irreconocible (tercer lugar…) impide ubicar el ganador de la ronda anterior.
    const salidaValida = !siguiente || siguiente.clave !== null;
    const marcadores: number[] = [];
    for (let f = cabecera + 1; f < filas.length; f += 1) {
      if (celda(f, salida)?.clases.includes('score') && celda(f, salida)!.texto !== '') marcadores.push(f);
    }
    if (clave === null || !salidaValida) {
      if (clave === null) regular = false;
      else if (marcadores.length > 0) regular = false;
      marcadores.forEach(() => acumulador.excluir('rondaDesconocida'));
      return;
    }
    rondas.push(clave);

    for (const s of marcadores) {
      const w = s - 1;
      if (!esParticipante(w, salida)) {
        acumulador.excluir('sinGanador');
        continue;
      }
      let arriba = -1;
      for (let f = w - 1; f > cabecera; f -= 1) {
        if (esParticipante(f, columna)) {
          arriba = f;
          break;
        }
      }
      let abajo = -1;
      for (let f = w + 1; f < filas.length; f += 1) {
        if (esParticipante(f, columna)) {
          abajo = f;
          break;
        }
      }
      if (arriba < 0 || abajo < 0 || w - arriba !== abajo - w) {
        acumulador.excluir('incoherente');
        continue;
      }
      const a = celda(arriba, columna)!.texto;
      const b = celda(abajo, columna)!.texto;
      const ganador = celda(w, salida)!.texto;
      if (ganador !== a && ganador !== b) {
        acumulador.excluir('incoherente');
        continue;
      }
      const m = celda(s, salida)!.texto.match(MARCADOR);
      const [pg, pp] = m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
      if (!m || !(pg > pp)) {
        acumulador.excluir('sinMarcador');
        continue;
      }
      const perdedor = ganador === a ? b : a;
      const refG = refDe(ganador);
      const refP = refDe(perdedor);
      if (!refG || !refP) {
        acumulador.excluir('sinParticipante');
        continue;
      }
      acumulador.anadir({
        fase: 'TABLEAU',
        ronda: clave,
        a: { ref: refG, nombre: ganador, puntos: pg },
        b: { ref: refP, nombre: perdedor, puntos: pp },
      });
    }
  });

  const parte = acumulador.resumen(regular);
  return { ...parte, estado: 'leido', rondas };
}

// ---------------------------------------------------------------------------
// Lectura de red
// ---------------------------------------------------------------------------

export type LecturaCuadroEngarde = {
  estado: EstadoLecturaComplementaria;
  urls: string[];
  /** Cabecera de la primera página leída: sirve para cotejar fecha y edición. */
  pagina: PaginaEngarde | null;
  parte: ParteAsaltosComplementarios | null;
  /** Texto corto y sin nombres. */
  motivo: string | null;
};

/** URLs de cuadro que la página de la prueba ofrece y que cuelgan de ESA prueba. */
export function urlsCuadroDePrueba(prueba: PruebaEngarde, pagina: Pick<PaginaEngarde, 'cuadros'> | null): string[] {
  const raiz = `/competition/${prueba.org}/${prueba.evt}/${prueba.compe}/`;
  return (pagina?.cuadros ?? [])
    .filter((r) => r.toLowerCase().startsWith(raiz.toLowerCase()))
    .slice(0, MAX_PAGINAS_CUADRO)
    .map((r) => `${ENGARDE_BASE}${r}`);
}

/**
 * Lee las páginas de cuadro ofrecidas por una prueba individual. 404 = no
 * publicado, 5xx o red = error; si una página falla y otra se lee, el
 * resultado es parcial y lo leído no se descarta.
 */
export async function leerCuadroEngarde(
  prueba: PruebaEngarde,
  urls: readonly string[],
  deps: Pick<DepsEngarde, 'get'> = depsEngardeReales,
): Promise<LecturaCuadroEngarde> {
  const base = { urls: [...urls], pagina: null, parte: null };
  if (prueba.individual !== true) {
    return { ...base, estado: 'no_publicado', motivo: 'Prueba por equipos o sin modalidad verificada: no hay asaltos individuales' };
  }
  if (urls.length === 0) {
    return { ...base, estado: 'no_publicado', motivo: 'La prueba no ofrece página de cuadro' };
  }

  const fusion = new FusionAsaltos();
  let pagina: PaginaEngarde | null = null;
  let fallos = 0;
  let noPublicados = 0;
  let ilegibles = 0;
  let ultimoError: string | null = null;

  for (const url of urls) {
    let r;
    try {
      r = await deps.get(url);
    } catch (e) {
      fallos += 1;
      ultimoError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      continue;
    }
    if (r.status === 404) {
      noPublicados += 1;
      continue;
    }
    if (r.status !== 200) {
      fallos += 1;
      ultimoError = `HTTP ${r.status}`;
      continue;
    }
    const cuadro = parsearCuadroEngarde(r.body, { individual: true });
    if (cuadro.estado !== 'leido') {
      ilegibles += 1;
      continue;
    }
    pagina ??= parsearPaginaEngarde(r.body);
    fusion.anadir(cuadro, url);
  }

  const leidas = urls.length - fallos - noPublicados - ilegibles;
  if (leidas === 0) {
    const estado: EstadoLecturaComplementaria = fallos > 0 || ilegibles > 0 ? 'error' : 'no_publicado';
    return {
      ...base,
      estado,
      motivo:
        fallos > 0
          ? (ultimoError ?? 'Error al leer el cuadro')
          : ilegibles > 0
            ? 'El cuadro publicado no tiene un layout reconocido'
            : 'El cuadro no tiene página publicada (HTTP 404)',
    };
  }
  const parte = fusion.resumen(fallos === 0 && noPublicados === 0 && ilegibles === 0);
  const estado: EstadoLecturaComplementaria = parte.completo ? 'completo' : 'parcial';
  return {
    ...base,
    estado,
    pagina,
    parte,
    motivo: parte.completo
      ? null
      : [`Se importaron ${parte.importado} de ${parte.publicado} cruces publicados`, motivoConflictos(parte.conflictos)]
          .filter(Boolean)
          .join('; '),
  };
}
