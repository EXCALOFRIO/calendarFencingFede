import {
  compararCategorias,
  normalizarArma,
  normalizarCategoria,
  normalizarFormato,
  normalizarGenero,
  ORDEN_ARMA,
  ORDEN_FORMATO,
  ORDEN_GENERO,
  rotuloArma,
  rotuloCategoria,
  rotuloFormato,
  rotuloGenero,
} from './rotulos';

/**
 * Selector de pruebas por niveles: una fila por dimensión (arma, género,
 * modalidad, categoría) que tenga al menos dos valores, y cada opción apunta a
 * una prueba que existe. Cambiar una dimensión lleva a la prueba que conserva
 * más de las otras, por prioridad arma > género > modalidad > categoría; nunca
 * se ofrece una combinación inexistente.
 *
 * Generaliza `selectorDePruebas` de `explorar/edicion-modelo.ts` a cualquier
 * lista (calendario, resultados, ranking) y le pone los rótulos comunes.
 */

export type DimensionSelector = 'arma' | 'genero' | 'formato' | 'categoria';

export type ElementoSelector = {
  id: string;
  href?: string;
  arma?: string | null;
  genero?: string | null;
  categoria?: string | null | { codigo: string | null | undefined };
  formato?: string | null;
};

export type OpcionNivel = {
  valor: string;
  etiqueta: string;
  destinoId: string;
  destinoHref?: string;
  activa: boolean;
};

export type FilaNivel = {
  dimension: DimensionSelector;
  /** «Arma», «Género», «Modalidad», «Categoría»: nombre accesible de la fila. */
  etiqueta: string;
  opciones: OpcionNivel[];
};

export const DIMENSIONES_SELECTOR: readonly DimensionSelector[] = ['arma', 'genero', 'formato', 'categoria'];

export const ETIQUETA_DIMENSION: Record<DimensionSelector, string> = {
  arma: 'Arma',
  genero: 'Género',
  formato: 'Modalidad',
  categoria: 'Categoría',
};

const PESO: Record<DimensionSelector, number> = { arma: 8, genero: 4, formato: 2, categoria: 1 };

export function valorDe(e: ElementoSelector, d: DimensionSelector): string {
  switch (d) {
    case 'arma':
      return normalizarArma(e.arma) ?? '';
    case 'genero':
      return normalizarGenero(e.genero) ?? '';
    case 'formato':
      return normalizarFormato(e.formato) ?? '';
    case 'categoria': {
      const c = e.categoria && typeof e.categoria === 'object' ? e.categoria.codigo : e.categoria;
      return normalizarCategoria(c) ?? '';
    }
  }
}

function comparar(d: DimensionSelector, x: string, y: string): number {
  const posicion = (orden: readonly string[], v: string) => {
    const i = orden.indexOf(v);
    return i < 0 ? orden.length : i;
  };
  if (d === 'arma') return posicion(ORDEN_ARMA, x) - posicion(ORDEN_ARMA, y);
  if (d === 'genero') return posicion(ORDEN_GENERO, x) - posicion(ORDEN_GENERO, y);
  if (d === 'formato') return posicion(ORDEN_FORMATO, x) - posicion(ORDEN_FORMATO, y);
  return compararCategorias(x, y);
}

/** Rótulo de una opción del selector: «Florete», «Masc.», «Equipos», «Absoluto». */
export function etiquetaOpcion(d: DimensionSelector, valor: string): string {
  switch (d) {
    case 'arma':
      return rotuloArma(valor);
    case 'genero':
      return rotuloGenero(valor, { variante: 'corto' });
    case 'formato':
      return rotuloFormato(valor);
    case 'categoria':
      return rotuloCategoria(valor);
  }
}

export function filasSelectorPruebas(
  elementos: readonly ElementoSelector[],
  actualId: string | null | undefined,
): FilaNivel[] {
  const actual = elementos.find((e) => e.id === actualId) ?? elementos[0];
  if (!actual) return [];
  const filas: FilaNivel[] = [];
  for (const d of DIMENSIONES_SELECTOR) {
    const valores = [...new Set(elementos.map((e) => valorDe(e, d)).filter(Boolean))];
    if (valores.length < 2) continue;
    valores.sort((x, y) => comparar(d, x, y));
    const propio = valorDe(actual, d);
    filas.push({
      dimension: d,
      etiqueta: ETIQUETA_DIMENSION[d],
      opciones: valores.map((valor) => {
        const destino = valor === propio ? actual : masParecido(elementos, actual, d, valor);
        return {
          valor,
          etiqueta: etiquetaOpcion(d, valor),
          destinoId: destino.id,
          ...(destino.href !== undefined ? { destinoHref: destino.href } : {}),
          activa: valor === propio,
        };
      }),
    });
  }
  return filas;
}

function masParecido(
  elementos: readonly ElementoSelector[],
  actual: ElementoSelector,
  d: DimensionSelector,
  valor: string,
): ElementoSelector {
  let mejor: ElementoSelector | undefined;
  let puntos = -1;
  for (const e of elementos) {
    if (valorDe(e, d) !== valor) continue;
    let parecido = 0;
    for (const o of DIMENSIONES_SELECTOR) {
      if (o !== d && valorDe(e, o) === valorDe(actual, o)) parecido += PESO[o];
    }
    if (parecido > puntos) {
      mejor = e;
      puntos = parecido;
    }
  }
  return mejor ?? actual;
}
