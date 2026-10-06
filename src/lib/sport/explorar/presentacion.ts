import { titular, titularTorneo } from '@/lib/utils';
import { nombreEdicionEfc } from './nombre-efc';

/**
 * Nombres cortos y uniformes para pintar Explorar. Las fuentes escriben la
 * misma categoría de mil formas («S», «SENIOR», «Absoluto», «ABS») y ya llegan
 * normalizadas en `sport_competition.category`: en pantalla sólo se usa ese
 * código, nunca el literal original.
 *
 * No lee la base ni la sesión: sirve también en componentes cliente.
 */

const CATEGORIA: Record<string, string> = {
  ABS: 'Absoluto',
  M23: 'M23',
  M20: 'M20',
  M17: 'M17',
  M15: 'M15',
  M14: 'M14',
  M13: 'M13',
  M12: 'M12',
  M11: 'M11',
  M10: 'M10',
  M9: 'M9',
  M7: 'M7',
  VET: 'Veteranos',
};

const ORDEN_CATEGORIA = Object.keys(CATEGORIA);

/** Literales de las fuentes que a veces llegan sin normalizar (rankings, calendario). */
const ALIAS_CATEGORIA: Record<string, string> = {
  S: 'ABS', SENIOR: 'ABS', SENIORS: 'ABS', ABSOLUTO: 'ABS', ABSOLUTA: 'ABS', ABSOLUTOS: 'ABS',
  J: 'M20', JUNIOR: 'M20', JUNIORS: 'M20', U20: 'M20', SUB20: 'M20', 'M-20': 'M20',
  C: 'M17', CADETE: 'M17', CADETES: 'M17', CADET: 'M17', U17: 'M17', SUB17: 'M17', 'M-17': 'M17',
  U23: 'M23', SUB23: 'M23', 'SUB-23': 'M23', 'M-23': 'M23',
  V: 'VET', VETERANO: 'VET', VETERANOS: 'VET', VETERAN: 'VET', VETERANS: 'VET',
};

function codigoCategoria(codigo: string): string {
  const limpio = codigo.trim().toUpperCase();
  if (CATEGORIA[limpio]) return limpio;
  return ALIAS_CATEGORIA[limpio] ?? ALIAS_CATEGORIA[limpio.replace(/\s+/g, '')] ?? codigo;
}

export function categoriaVisible(codigo: string | null | undefined): string {
  if (!codigo) return 'Sin categoría';
  return CATEGORIA[codigoCategoria(codigo)] ?? codigo;
}

export function ordenCategoriaVisible(codigo: string | null | undefined): number {
  const i = codigo ? ORDEN_CATEGORIA.indexOf(codigoCategoria(codigo)) : -1;
  return i < 0 ? ORDEN_CATEGORIA.length : i;
}

/** Tono de la medalla de un puesto final; `null` fuera del podio. */
export type Medalla = 'oro' | 'plata' | 'bronce';

export function medallaDe(puesto: number | null | undefined): Medalla | null {
  if (puesto === 1) return 'oro';
  if (puesto === 2) return 'plata';
  if (puesto === 3) return 'bronce';
  return null;
}

/** Clases Tailwind de cada medalla (fondo suave, texto y borde) en claro y oscuro. */
export const CLASES_MEDALLA: Record<Medalla, string> = {
  oro: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40',
  plata: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/40',
  bronce: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-600/15 dark:text-orange-300 dark:border-orange-600/40',
};

/** Sólo borde y texto de cada medalla, para hitos que recuerdan a ella (títulos) sin ser una. */
export const CONTORNO_MEDALLA: Record<Medalla, string> = {
  oro: 'border-amber-300 text-amber-800 dark:border-amber-500/40 dark:text-amber-300',
  plata: 'border-slate-300 text-slate-700 dark:border-slate-400/40 dark:text-slate-200',
  bronce: 'border-orange-300 text-orange-800 dark:border-orange-600/40 dark:text-orange-300',
};

/** Color sólido de cada medalla, para puntos, anillos y cifras grandes. */
export const COLOR_MEDALLA: Record<Medalla, string> = {
  oro: '#D4A017',
  plata: '#A8A9AD',
  bronce: '#CD7F32',
};

/**
 * La FIE guarda en una sola edición la prueba individual y la de equipos, y
 * la edición se llama como la de equipos («Coupe du Monde par équipes»). Al
 * pintar una prueba individual ese sufijo confunde, así que se quita.
 */
const SUFIJO_EQUIPOS =
  /\s*[-–,(]?\s*\b(par [ée]quipes?|team( event)?s?|teams?|por equipos|equipos)\b\)?\s*/gi;

/** Nombres de la FIE en francés o inglés → castellano (la forma, no la sede). */
const FIE_ES: [RegExp, string][] = [
  [/^jeux olympiques de la jeunesse\b/i, 'Juegos Olímpicos de la Juventud'],
  [/^jeux olympiques\b/i, 'Juegos Olímpicos'],
  [/^championnats? du monde juniors?[- ]cadets?\b/i, 'Campeonato del Mundo Júnior y Cadete'],
  [/^championnats? du monde v[ée]t[ée]rans?\b/i, 'Campeonato del Mundo de Veteranos'],
  [/^championnats? du monde\b/i, 'Campeonato del Mundo'],
  [/^championnats? d'europe cadets?\b/i, 'Campeonato de Europa Cadete'],
  [/^championnats? d'europe juniors?\b/i, 'Campeonato de Europa Júnior'],
  [/^championnats? d'europe\b/i, 'Campeonato de Europa'],
  [/^championnats? d'afrique\b/i, 'Campeonato de África'],
  [/^championnats? asiatiques? cadets?\b/i, 'Campeonato de Asia Cadete'],
  [/^championnats? asiatiques?\b/i, 'Campeonato de Asia'],
  [/^championnats? panam[ée]ricains? cadets?\b/i, 'Campeonato Panamericano Cadete'],
  [/^championnats? panam[ée]ricains?\b/i, 'Campeonato Panamericano'],
  [/^[сc]hampionnats? de la m[ée]diterran[ée]e\b/i, 'Campeonato del Mediterráneo'],
  [/^jeux m[ée]diterran[ée]ens\b/i, 'Juegos Mediterráneos'],
  [/^coupe du monde\b/i, 'Copa del Mundo'],
  [/^grand prix\b/i, 'Gran Premio'],
  [/^tournoi satellite\b/i, 'Torneo Satélite'],
];

export type DatosNombrePrueba = {
  nombre: string;
  /** `INDIVIDUAL` o `EQUIPOS`. */
  formato?: string | null;
  fuente?: string | null;
};

/**
 * Formas cortas de los nombres de competición, sólo al principio del nombre
 * (el nombre del evento): «Campeonato del Mundo de Veteranos» → «Mundial de
 * Veteranos», pero un «… del Campeonato del Mundo» en medio se queda igual.
 */
const CORTOS: [RegExp, string][] = [
  [/^campeonatos? de españa\b/i, 'Cto. España'],
  [/^torneo nacional de ranking\b/i, 'TNR'],
  [/^campeonato de europa\b/i, 'Europeo'],
  [/^circuito europeo\b/i, 'Circ. europeo'],
  [/^campeonato del mundo\b/i, 'Mundial'],
];

/**
 * Nombre de una prueba para filas estrechas (393 px): el de `nombrePrueba`
 * con la forma corta del evento. El nombre entero va en `title`/`aria-label`.
 */
export function nombrePruebaCorto(datos: DatosNombrePrueba): string {
  const largo = nombrePrueba(datos);
  for (const [patron, corto] of CORTOS) {
    if (patron.test(largo)) return largo.replace(patron, corto).replace(/\s+/g, ' ').trim();
  }
  return largo;
}

/** Nombre de una prueba listo para pintar: en castellano, sin el sufijo de equipos si es individual. */
export function nombrePrueba({ nombre, formato, fuente }: DatosNombrePrueba): string {
  let texto = nombre.replace(/\s+/g, ' ').trim();
  if (formato !== 'EQUIPOS') {
    const sin = texto.replace(SUFIJO_EQUIPOS, ' ').replace(/\s+/g, ' ').trim();
    if (sin) texto = sin;
  }
  if (fuente === 'fie') {
    for (const [patron, es] of FIE_ES) {
      if (patron.test(texto)) {
        const resto = texto.replace(patron, '').replace(/\b(par [ée]quipes?|teams?( events?)?)\b/i, 'por equipos');
        return `${es}${resto}`.replace(/\s+/g, ' ').trim();
      }
    }
    return titularTorneo(texto);
  }
  if (fuente === 'efc') return nombreEdicionEfc(texto);
  return titular(texto);
}
