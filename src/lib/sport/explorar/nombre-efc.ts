import { titular } from '@/lib/utils';

/**
 * Nombre en castellano de una edición de la EFC. Sus organizadores escriben el
 * circuito de mil maneras («Cadet Circuit Antalya», «XVI EUROPEAN EFC CIRCUIT
 * SOFIA», «EFC-CC … Budapest», «ECC foil Moedling»): se reduce a «Circuito
 * europeo cadete» seguido de lo que queda (sede o nombre propio del torneo).
 * Un nombre propio sin la palabra «circuit» («Kneipp Cup») se deja tal cual:
 * el tipo ya lo dice la pastilla.
 */

const CATEGORIA: [RegExp, string][] = [
  [/^cadets?$/i, 'cadete'],
  [/^juniors?$/i, 'júnior'],
  [/^u ?23$/i, 'sub-23'],
  [/^u ?14$/i, 'U14'],
  [/^veterans?$/i, 'de veteranos'],
];

const CIRCUITO =
  /\b(?:[ivxl]+\s+)?(?:european\s+)?(?:efc[\s-]*)?(?:european\s+)?(?:(cadets?|juniors?|u ?23|u ?14|veterans?)\s+)?circuit\b/i;
const CIRCUITO_CORTO = /\b(?:efc[\s-]*cc|ecc|circuito europeo(?:\s+cadete)?)\b/i;
const CAMPEONATO = /\b(?:efc\s+)?european\s+(?:(cadets?|juniors?|u ?23|veterans?)\s+)?(?:fencing\s+)?championships?\b/i;

function categoriaDe(palabra: string | undefined): string {
  if (!palabra) return '';
  return CATEGORIA.find(([p]) => p.test(palabra.trim()))?.[1] ?? '';
}

/** Arma, género y formato: los dice el selector de la prueba, no el nombre del torneo. */
const PRUEBA =
  /\b(?:men['’]?s|women['’]?s|men|women|foil|[ée]p[ée]e|sabre|sable|espada|florete|individual|teams?|competition|and)\b/gi;
const FECHA = /\b\d{1,2}(?:\s*[-–]\s*\d{1,2})?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/gi;

function resto(texto: string): string {
  const limpio = texto
    .replace(/\bby the\b.*$/i, ' ')
    .replace(FECHA, ' ')
    .replace(PRUEBA, ' ')
    .replace(/["“”]/g, '')
    .replace(/\s*[-–,:]\s*(?=[-–,:]|$)/g, ' ')
    .replace(/^[\s\-–,:.]+|[\s\-–,:.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio ? ` ${titular(limpio)}` : '';
}

export function nombreEdicionEfc(nombre: string): string {
  const texto = nombre.replace(/\s+/g, ' ').trim();
  const cto = CAMPEONATO.exec(texto);
  if (cto) {
    const cat = categoriaDe(cto[1]);
    return `Campeonato de Europa${cat ? ` ${cat}` : ''}${resto(texto.replace(cto[0], ' '))}`;
  }
  const circuito = CIRCUITO.exec(texto);
  if (circuito) {
    const cat = categoriaDe(circuito[1]) || (/\bcadets?\b/i.test(texto) ? 'cadete' : '');
    const sin = texto.replace(circuito[0], ' ').replace(/\b(?:efc|cadets?)\b/gi, ' ');
    return `Circuito europeo${cat ? ` ${cat}` : ''}${resto(sin)}`;
  }
  if (CIRCUITO_CORTO.test(texto)) {
    return `Circuito europeo cadete${resto(texto.replace(CIRCUITO_CORTO, ' ').replace(/\bcadets?\b/gi, ' '))}`;
  }
  return titular(texto);
}
