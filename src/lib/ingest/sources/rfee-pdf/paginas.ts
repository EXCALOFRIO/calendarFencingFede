import { agruparFilas, fusionarFragmentos, limpiarItems, normalizar, textoFila, type Fila } from './geometria';
import type { ItemTexto, PaginaTexto, TipoPagina } from './tipos';

/**
 * Clasificación de páginas de un PDF de Engarde. Una página se atribuye por
 * su ENCABEZADO de sección y su cabecera de prueba, nunca por su posición en
 * el texto aplanado del documento.
 */

export type PaginaAnalizada = {
  numero: number;
  ancho: number;
  alto: number;
  tipo: TipoPagina;
  motivo: string | null;
  /** Filas del cuerpo, desde el primer encabezado de sección hacia abajo. */
  filas: Fila[];
  /** Ítems del cuerpo (mismo contenido que `filas`, ya fusionados). */
  items: ItemTexto[];
  /** Líneas de cabecera de la prueba, encima del primer encabezado. */
  cabecera: string[];
  /** Cabecera normalizada: igual firma = misma prueba. */
  firma: string;
  /** `y` de la fila del primer encabezado de sección. */
  yEncabezado: number | null;
};

// Engarde imprime los títulos en el idioma del equipo: castellano, catalán o inglés.
export const RE_FINAL = /^(CLASIFICACI.{1,3}N GENERAL|CLASSIFICACI.{1,3} GENERAL|OVERALL RANKING)\b/;
const RE_POULES = /^POULES?, (VUELTA|VOLTA|ROUND)\b/;
export const RE_POULE_N = /^POULE\s*N(?:[^\d\s]{0,2}\.?)?\s*(\d+)/;
const RE_INTERMEDIA =
  /^(CLASIFICACI.{1,3}N (DE POULES|DESPU.S DE POULES|DE LAS? POULES)|CLASSIFICACI.{1,3} (DELS? POULES|DESPR?.S|AL? ACABAR)|RANKING (OF|AT THE END OF|AFTER) (THE )?POULES)/;
const RE_PARTICIPANTES = /^(TIRADOR(ES|AS|S)|EQUIPOS|EQUIPS|CLUBS?|FENCERS|TEAMS) \((PRESENT|RESPECT|ABOUT)/;
const RE_FORMULA = /^(F.RMULA DE LA COMPET(ENCI|ICI)|FORMULA OF THE COMPETITION)/;
const RE_ARBITROS = /^(ACTIVIDAD DE (LOS )?.RBITROS|ACTIVITAT DELS .RBITRES|REFEREES? ACTIVIT)/;
const RE_ESTADISTICAS = /^(NUMERO TOTAL DE (PARTICIPANT|TIRADOR|EQUIP)|OVERALL NUMBER OF)/;
const RE_RONDA =
  /^(TABLEAU OF \d+|TABLA DE \d+|SEMI-?FINALES?|SEMIFINALS?|QUARTS DE FINAL|CUARTOS DE FINAL|FINAL|TERCER LUGAR|TERCER PUESTO)$/;

// El número del contador va en la esquina que se descarta: a veces queda sólo «Página».
const RE_CONTADOR = /^(P.GINA|PAGE)( \d+( ?\/ ?\d+)?)?$/;

export const esItemRonda = (s: string): boolean => RE_RONDA.test(normalizar(s));

const MIN_CARACTERES = 12;

/**
 * Franja inferior donde Engarde imprime su pie: generador, fecha y hora de
 * impresión, página y la leyenda de abreviaturas («V/D = Victoria/Derrota = …»),
 * que ninguna fila de datos contiene.
 */
const Y_PIE = 55;
const RE_PIE = /ENGARDE|ESCRIME|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b|\b(PAGE|PAGINA|PAG\.?) ?\d+|\S = \S/;

function tipoDeEncabezado(f: Fila): TipoPagina | null {
  const t = normalizar(textoFila(f));
  if (RE_FINAL.test(t)) return 'clasificacion_final';
  if (RE_POULES.test(t) || RE_POULE_N.test(t)) return 'poules';
  if (RE_INTERMEDIA.test(t)) return 'clasificacion_intermedia';
  if (RE_PARTICIPANTES.test(t)) return 'participantes';
  if (RE_FORMULA.test(t)) return 'formula';
  if (RE_ARBITROS.test(t)) return 'arbitros';
  if (RE_ESTADISTICAS.test(t)) return 'estadisticas';
  // Los encabezados del cuadro son las rondas, a lo ancho de la página.
  if (f.items.some((i) => esItemRonda(i.s))) return 'cuadro';
  return null;
}

/** Prueba de legibilidad: cuenta caracteres y letras, y los reemplazos de PDF.js. */
export function legibilidad(items: readonly ItemTexto[]): { chars: number; letras: number; perdidos: number } {
  let chars = 0;
  let letras = 0;
  let perdidos = 0;
  for (const i of items) {
    for (const c of i.s) {
      if (/\s/.test(c)) continue;
      chars += 1;
      if (c === '\uFFFD') perdidos += 1;
      else if (/\p{L}/u.test(c)) letras += 1;
    }
  }
  return { chars, letras, perdidos };
}

export function analizarPagina(pagina: PaginaTexto): PaginaAnalizada {
  const base = {
    numero: pagina.numero,
    ancho: pagina.ancho,
    alto: pagina.alto,
    filas: [] as Fila[],
    items: [] as ItemTexto[],
    cabecera: [] as string[],
    firma: '',
    yEncabezado: null as number | null,
  };

  const crudos = limpiarItems(pagina.items);
  const { chars, letras, perdidos } = legibilidad(crudos);
  if (chars < MIN_CARACTERES) {
    return { ...base, tipo: 'sin_texto', motivo: `La página no tiene texto extraíble (${chars} caracteres): necesita OCR o revisión` };
  }
  if (letras < 8 || perdidos / chars > 0.25) {
    return {
      ...base,
      tipo: 'ilegible',
      motivo: `El texto extraído es ilegible (letras=${letras}, perdidos=${perdidos}): necesita OCR o revisión`,
    };
  }

  // Número de página arriba a la derecha y pie del generador: ruido de maquetación.
  // El pie se reconoce por su texto, no por la altura: en una página llena la
  // última fila de datos queda a pocos puntos encima de él.
  const sinContador = crudos.filter((i) => !(i.x > pagina.ancho * 0.85 && i.y > pagina.alto - 40));
  const pie = new Set(
    agruparFilas(sinContador.filter((i) => i.y <= Y_PIE))
      .filter((f) => RE_PIE.test(normalizar(textoFila(f))))
      .flatMap((f) => f.items),
  );
  const utiles = sinContador.filter((i) => !pie.has(i));
  const filas = agruparFilas(utiles).map((f) => {
    const items = fusionarFragmentos(f.items);
    return { y: f.y, items };
  });

  let tipo: TipoPagina = 'desconocida';
  let corte = -1;
  for (let k = 0; k < filas.length; k += 1) {
    const t = tipoDeEncabezado(filas[k]);
    if (t) {
      tipo = t;
      corte = k;
      break;
    }
  }

  // «Página 2/3» encabeza las secciones largas y no forma parte de la prueba.
  const cabecera = corte > 0 ? filas.slice(0, corte).map(textoFila).filter((l) => !RE_CONTADOR.test(normalizar(l))) : [];
  const cuerpo = corte >= 0 ? filas.slice(corte) : filas;
  return {
    ...base,
    tipo,
    motivo: tipo === 'desconocida' ? 'Ninguna cabecera de sección reconocida en la página' : null,
    filas: cuerpo,
    items: cuerpo.flatMap((f) => f.items),
    cabecera,
    firma: cabecera.map(normalizar).join(' | '),
    yEncabezado: corte >= 0 ? filas[corte].y : null,
  };
}
