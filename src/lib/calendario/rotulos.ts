import { nombreDeCircuito } from '@/lib/colores';
import type { EventView } from '@/lib/queries/calendar';
import {
  ORDEN_ARMA,
  ORDEN_GENERO,
  compararCategorias,
  rotuloPrueba,
} from '@/lib/sport/rotulos';
import { CIRCUIT_LABEL, titular } from '@/lib/utils';

/**
 * Los rótulos de un torneo en el calendario: pruebas, circuito, sede y plazo.
 * Funciones normales, para poder probarlas sin navegador.
 */

/** Qué dimensiones de la prueba se escriben: sólo las que el filtro deja con más de un valor. */
export type DimensionesVisibles = {
  arma: boolean;
  genero: boolean;
  categoria: boolean;
};

/** Cuántas pastillas de prueba caben antes de resumir el resto en «+N». */
export const TOPE_PASTILLAS_PRUEBA = 4;

/**
 * Las pruebas de un torneo como rótulos, sin repetir: «Florete Masc.»,
 * «Florete Fem.», «Espada Fem. M17». Con el calendario filtrado por florete
 * femenino, escribir «Florete Fem.» en cada tarjeta no informa, así que cada
 * dimensión sólo entra si el filtro abarca más de un valor.
 *
 * Los dos géneros de un mismo torneo van en la misma tarjeta, como dos
 * rótulos, nunca como dos tarjetas.
 */
export function pruebasDe(evento: EventView, visibles: DimensionesVisibles): string[] {
  if (!visibles.arma && !visibles.genero && !visibles.categoria) return [];
  // Con las tres dimensiones, la forma corta («Espada Fem. M17»); si no, la larga y concordada («Espada femenina»).
  const variante = visibles.arma && visibles.genero && visibles.categoria ? 'corto' : 'largo';
  const ordenadas = [...evento.competitions].sort(
    (a, b) =>
      ORDEN_ARMA.indexOf(a.weapon) - ORDEN_ARMA.indexOf(b.weapon) ||
      ORDEN_GENERO.indexOf(a.gender) - ORDEN_GENERO.indexOf(b.gender) ||
      compararCategorias(a.category, b.category),
  );
  const vistos = new Set<string>();
  for (const c of ordenadas) {
    const rotulo = rotuloPrueba(
      {
        arma: visibles.arma ? c.weapon : undefined,
        genero: visibles.genero ? c.gender : undefined,
        categoria: visibles.categoria ? c.category : undefined,
      },
      { variante, categoria: visibles.categoria ? 'siempre' : 'nunca', formato: 'nunca' },
    );
    if (rotulo) vistos.add(rotulo);
  }
  return [...vistos];
}

/**
 * El circuito, siempre: «Copa del Mundo», «Liga Europea». Es la señal del tipo
 * de competición junto a la insignia del organismo. Nunca un código crudo.
 */
export function pastillaDeCircuito(evento: EventView): string | null {
  return nombreDeCircuito(evento.circuit) ?? CIRCUIT_LABEL[evento.circuit] ?? null;
}

/**
 * Dónde se tira. Sin ciudad se dice «Sede sin publicar»: de los torneos de la
 * base, nueve de cada diez no tienen pabellón, y no se rellena con algo que
 * parezca oficial.
 */
export function sedeDe(evento: Pick<EventView, 'city' | 'country'>, conPais = true): string {
  const ciudad = evento.city ? titular(evento.city) : '';
  if (!ciudad) return 'Sede sin publicar';
  if (!conPais || !evento.country) return ciudad;
  return `${ciudad}, ${evento.country}`;
}

export type TonoPlazo = 'neutro' | 'aviso' | 'peligro';

/**
 * Cuánto queda de plazo, con el tono del semáforo: rojo a tres días o menos,
 * ámbar a diez o menos, neutro el resto.
 *
 * Manda el plazo que antes cierra de todas las pruebas. Si la fuente no
 * publica plazo no se dice nada: un «cierra pronto» inventado hace perder
 * inscripciones.
 *
 * Lee `competition.status` y no `deadlines`: el listado del calendario manda
 * `deadlines` vacío a propósito, y de `status` llegan los escalares.
 */
export function plazoDe(
  evento: EventView,
): { texto: string; tono: TonoPlazo; cerrado: boolean } | null {
  const abiertas = evento.competitions.filter((c) => !c.status.closed);
  const dias = abiertas
    .map((c) => c.status.daysLeft)
    .filter((d): d is number => d !== null && d >= 0)
    .sort((a, b) => a - b)[0];

  if (dias === undefined) {
    if (abiertas.length === 0 && evento.competitions.length > 0) {
      return { texto: 'Inscripción cerrada', tono: 'neutro', cerrado: true };
    }
    return null;
  }

  return { texto: textoDePlazo(dias), tono: tonoDePlazo(dias), cerrado: false };
}

/** «Cierra hoy», «Cierra en 1 día», «Cierra en 9 días». */
export function textoDePlazo(dias: number): string {
  if (dias <= 0) return 'Cierra hoy';
  return `Cierra en ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

export function tonoDePlazo(dias: number): TonoPlazo {
  return dias <= 3 ? 'peligro' : dias <= 10 ? 'aviso' : 'neutro';
}
