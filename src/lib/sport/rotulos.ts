/**
 * Rótulos de las pruebas: arma, género, categoría y modalidad.
 *
 * Es la única tabla de la aplicación. Antes cada pantalla montaba el suyo y
 * salían cosas como «FLO M, equipos», «Espada femenino M17 · equipos» o
 * «Espada masculino». Aquí el género concuerda con el arma («Espada
 * femenina», «Florete masculino»), el separador es siempre « · » y nunca se
 * escribe un código crudo ni un `undefined`: lo que no se reconoce se omite.
 *
 * Los códigos FLO/ESP/SAB quedan sólo para las tablas densas (`variante:
 * 'codigo'`); en el resto se escribe la palabra.
 */

export type ArmaRotulo = 'FLORETE' | 'ESPADA' | 'SABLE';
export type GeneroRotulo = 'M' | 'F' | 'MIXTO';
export type FormatoRotulo = 'INDIVIDUAL' | 'EQUIPOS';

export const SEPARADOR = ' · ';

export const ROTULO_ARMA = {
  FLORETE: 'Florete',
  ESPADA: 'Espada',
  SABLE: 'Sable',
} as const;

export const CODIGO_ARMA = {
  FLORETE: 'FLO',
  ESPADA: 'ESP',
  SABLE: 'SAB',
} as const;

/** El género dicho solo, sin arma delante. */
export const ROTULO_GENERO = {
  M: 'Masculino',
  F: 'Femenino',
  MIXTO: 'Mixto',
} as const;

/** Sólo para las celdas del mes; en el resto, `rotuloGenero(g, { variante: 'corto' })`. */
export const CODIGO_GENERO = { M: 'M', F: 'F', MIXTO: 'Mx' } as const;

export const ROTULO_GENERO_CORTO = { M: 'Masc.', F: 'Fem.', MIXTO: 'Mixto' } as const;

/** «Espada» es femenino; «florete» y «sable», masculinos. */
const GENERO_GRAMATICAL: Record<ArmaRotulo, 'm' | 'f'> = { FLORETE: 'm', ESPADA: 'f', SABLE: 'm' };

const ADJETIVO_GENERO: Record<GeneroRotulo, Record<'m' | 'f', string>> = {
  M: { m: 'masculino', f: 'masculina' },
  F: { m: 'femenino', f: 'femenina' },
  MIXTO: { m: 'mixto', f: 'mixta' },
};

export const ROTULO_CATEGORIA = {
  M7: 'M7',
  M9: 'M9',
  M10: 'M10',
  M11: 'M11',
  M12: 'M12',
  M13: 'M13',
  M14: 'M14',
  M15: 'M15',
  M17: 'M17',
  M20: 'M20',
  M23: 'M23',
  ABS: 'Absoluto',
  VET: 'Veteranos',
} as const;

/** Sólo dos categorías tienen nombre largo; el resto ya son códigos («M17»). */
export const ROTULO_CATEGORIA_CORTO: Record<string, string> = { ABS: 'Abs', VET: 'Vet' };

export const ROTULO_FORMATO = { INDIVIDUAL: 'Individual', EQUIPOS: 'Equipos' } as const;

export const ORDEN_ARMA: readonly ArmaRotulo[] = ['FLORETE', 'ESPADA', 'SABLE'];
export const ORDEN_GENERO: readonly GeneroRotulo[] = ['M', 'F', 'MIXTO'];
export const ORDEN_FORMATO: readonly FormatoRotulo[] = ['INDIVIDUAL', 'EQUIPOS'];

type Entrada = string | null | undefined;

function clave(valor: Entrada): string {
  return typeof valor === 'string' ? valor.trim().toUpperCase() : '';
}

export function normalizarArma(arma: Entrada): ArmaRotulo | null {
  const v = clave(arma);
  return v in ROTULO_ARMA ? (v as ArmaRotulo) : null;
}

export function normalizarGenero(genero: Entrada): GeneroRotulo | null {
  const v = clave(genero);
  if (v === 'M' || v === 'F' || v === 'MIXTO') return v;
  if (v === 'X' || v === 'MX') return 'MIXTO';
  return null;
}

export function normalizarFormato(formato: Entrada): FormatoRotulo | null {
  const v = clave(formato);
  return v === 'INDIVIDUAL' || v === 'EQUIPOS' ? v : null;
}

/** Código de categoría en mayúsculas o `null`; acepta categorías que no están en la tabla («V40»). */
export function normalizarCategoria(categoria: Entrada): string | null {
  const v = clave(categoria);
  return /^[A-Z0-9+-]{1,8}$/.test(v) ? v : null;
}

export type VarianteArma = 'largo' | 'codigo';

/** «Florete»; con `codigo`, «FLO» (sólo tablas densas). Vacío si no se reconoce. */
export function rotuloArma(arma: Entrada, variante: VarianteArma = 'largo'): string {
  const a = normalizarArma(arma);
  if (!a) return '';
  return variante === 'codigo' ? CODIGO_ARMA[a] : ROTULO_ARMA[a];
}

/**
 * - Sin arma: «Masculino», «Femenino», «Mixto».
 * - Con arma: el adjetivo en minúscula y concordado, «masculino» tras
 *   florete o sable y «masculina» tras espada.
 * - `corto`: «Masc.», «Fem.», «Mixto», con o sin arma.
 */
export function rotuloGenero(
  genero: Entrada,
  opciones: { arma?: Entrada; variante?: 'largo' | 'corto' } = {},
): string {
  const g = normalizarGenero(genero);
  if (!g) return '';
  if (opciones.variante === 'corto') return ROTULO_GENERO_CORTO[g];
  const a = normalizarArma(opciones.arma);
  return a ? ADJETIVO_GENERO[g][GENERO_GRAMATICAL[a]] : ROTULO_GENERO[g];
}

/** «Absoluto», «Veteranos», «M17»; `corto` da «Abs»/«Vet». `omitirAbsoluto` devuelve vacío para ABS. */
export function rotuloCategoria(
  categoria: Entrada,
  opciones: { variante?: 'largo' | 'corto'; omitirAbsoluto?: boolean } = {},
): string {
  const c = normalizarCategoria(categoria);
  if (!c) return '';
  if (c === 'ABS' && opciones.omitirAbsoluto) return '';
  if (opciones.variante === 'corto' && ROTULO_CATEGORIA_CORTO[c]) return ROTULO_CATEGORIA_CORTO[c];
  return (ROTULO_CATEGORIA as Record<string, string>)[c] ?? c;
}

export function rotuloFormato(formato: Entrada): string {
  const f = normalizarFormato(formato);
  return f ? ROTULO_FORMATO[f] : '';
}

export type PruebaRotulable = {
  arma?: Entrada;
  genero?: Entrada;
  categoria?: Entrada | { codigo: Entrada };
  formato?: Entrada;
};

export type OpcionesRotuloPrueba = {
  /** `largo`: «Espada femenina M17 · Equipos». `corto`: «Espada Fem. M17 · Equipos». */
  variante?: 'largo' | 'corto';
  /** Por defecto `si-no-absoluto`: ABS no se escribe. */
  categoria?: 'siempre' | 'nunca' | 'si-no-absoluto';
  /** Por defecto `si-equipos`: «Individual» no se escribe. */
  formato?: 'siempre' | 'si-equipos' | 'nunca';
};

function codigoCategoria(c: PruebaRotulable['categoria']): Entrada {
  return c && typeof c === 'object' ? c.codigo : c;
}

/**
 * El nombre de una prueba en una sola línea.
 *
 *   largo → «Espada femenina M17 · Equipos», «Florete masculino»,
 *           «Espada femenina · Absoluto · Individual»
 *   corto → «Florete Masc.», «Espada Fem. M17 · Equipos», «Sable Masc. · Vet»
 */
export function rotuloPrueba(prueba: PruebaRotulable, opciones: OpcionesRotuloPrueba = {}): string {
  const variante = opciones.variante ?? 'largo';
  const modoCategoria = opciones.categoria ?? 'si-no-absoluto';
  const modoFormato = opciones.formato ?? 'si-equipos';

  const arma = rotuloArma(prueba.arma);
  const genero = rotuloGenero(prueba.genero, { arma: prueba.arma, variante });
  const categoria =
    modoCategoria === 'nunca'
      ? ''
      : rotuloCategoria(codigoCategoria(prueba.categoria), {
          variante,
          omitirAbsoluto: modoCategoria === 'si-no-absoluto',
        });
  const f = normalizarFormato(prueba.formato);
  const formato =
    modoFormato === 'nunca' || !f || (modoFormato === 'si-equipos' && f !== 'EQUIPOS') ? '' : ROTULO_FORMATO[f];

  // «Absoluto» y «Veteranos» son palabras con mayúscula: en medio de la frase
  // («Espada femenina Absoluto») parecían parte del nombre. Los códigos («M17») sí van pegados.
  const categoriaAparte = categoria !== '' && (normalizarCategoria(codigoCategoria(prueba.categoria)) ?? '') in ROTULO_CATEGORIA_CORTO;
  const nucleo = [arma, genero, categoriaAparte ? '' : categoria].filter(Boolean).join(' ');
  return [nucleo, categoriaAparte ? categoria : '', formato].filter(Boolean).join(SEPARADOR);
}

/** Posición canónica de una categoría: ABS primero, de menor a mayor edad, VET al final. */
export function ordenCategoria(categoria: Entrada): number {
  const c = normalizarCategoria(categoria);
  if (!c) return 10_000;
  if (c === 'ABS') return 0;
  if (c === 'VET' || /^V\d+/.test(c)) return 9_000 + (Number(c.replace(/\D/g, '')) || 0);
  const m = /^M(\d+)$/.exec(c);
  return m ? 100 + Number(m[1]) : 5_000;
}

export function compararCategorias(a: Entrada, b: Entrada): number {
  return ordenCategoria(a) - ordenCategoria(b) || clave(a).localeCompare(clave(b));
}
