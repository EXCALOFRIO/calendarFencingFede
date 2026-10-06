/**
 * Reparación de nombres con el carácter de sustitución «\uFFFD».
 *
 * La fuente ya publicó «MU\uFFFDOZ»: el byte original se perdió y no se puede
 * decodificar de vuelta. Lo único que se sabe con certeza es que en ese hueco
 * había una letra que no era ASCII (si hubiera sido una «N», se vería la «N»).
 * Por eso una variante sin tilde («MUNOZ») sólo aporta la letra base, y una
 * propuesta se acepta por este orden de pruebas:
 *
 *   a. la misma persona escrita bien en otra fuente o lectura (variantes);
 *   b. un diccionario de palabras bien escritas de la propia base: la palabra
 *      vale si es la única conocida o si domina con >=95 % y >=5 nombres. Si
 *      todas las conocidas tienen las mismas letras base y sólo cambia el
 *      acento (FERNÁNDEZ frente a FERNÀNDEZ), basta >=80 % y >=5: lo que está
 *      en duda es la tilde, no la letra;
 *   c. la «Ñ» en unos pocos patrones españoles inequívocos.
 *
 * Si nada de eso decide, el nombre se deja como está.
 */

export const SUSTITUCION = '\uFFFD';

export type Via = 'a' | 'b' | 'c';

/** Letras no ASCII de Latin-1 / Windows-1252 que caben en un nombre, en mayúscula. */
export const LETRAS_CANDIDATAS: readonly string[] = [...'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝŠŽŸ'];

const BASE_MANUAL: Record<string, string> = { Ø: 'O' };

/** Letra base sin diacríticos y en mayúscula («Ñ» → «N»). */
export function letraBase(c: string): string {
  const m = c.toUpperCase();
  return BASE_MANUAL[m] ?? m.normalize('NFD').replace(/\p{M}/gu, '');
}

const esAscii = (c: string) => c.charCodeAt(0) < 128;

export const tieneSustitucion = (s: string | null | undefined): s is string => typeof s === 'string' && s.includes(SUSTITUCION);

export type Ficha = { texto: string; inicio: number };

/** Palabras de un nombre con su posición; el apóstrofo forma parte de la palabra. */
export function fichas(nombre: string): Ficha[] {
  return [...nombre.matchAll(/[\p{L}\p{M}\p{N}'’\uFFFD]+/gu)].map((m) => ({ texto: m[0], inicio: m.index ?? 0 }));
}

const mayus = (s: string) => s.normalize('NFC').toUpperCase();
const plano = (s: string) => [...mayus(s)].map(letraBase).join('');

/**
 * Letras (en mayúscula) que `candidata` pone en cada hueco de `rota`, o `null` si no
 * encajan: misma longitud y mismas letras base fuera de los huecos.
 */
export function encajar(rota: string, candidata: string): string[] | null {
  const r = [...mayus(rota)];
  const c = [...mayus(candidata)];
  if (r.length !== c.length || c.includes(SUSTITUCION)) return null;
  const letras: string[] = [];
  for (let i = 0; i < r.length; i += 1) {
    if (r[i] === SUSTITUCION) {
      if (!/\p{L}/u.test(c[i])) return null;
      letras.push(c[i]);
    } else if (letraBase(r[i]) !== letraBase(c[i])) return null;
  }
  return letras;
}

export type Variante = { nombre: string; origen: string };

/** Lo que una variante dice de cada palabra rota del nombre: índice de ficha → letras por hueco. */
export function letrasDeVariante(original: string, variante: string, exigirMismoNumero: boolean): Map<number, string[]> | null {
  if (tieneSustitucion(variante)) return null;
  const fo = fichas(original);
  const libres = fichas(variante).map((f) => f.texto);
  if (exigirMismoNumero && libres.length !== fo.length) return null;
  if (libres.length < fo.length) return null;
  for (const f of fo) {
    if (f.texto.includes(SUSTITUCION)) continue;
    const i = libres.findIndex((v) => plano(v) === plano(f.texto));
    if (i < 0) return null;
    libres.splice(i, 1);
  }
  const salida = new Map<number, string[]>();
  for (const [i, f] of fo.entries()) {
    if (!f.texto.includes(SUSTITUCION)) continue;
    const opciones = libres.map((v, j) => ({ j, letras: encajar(f.texto, v) })).filter((o) => o.letras !== null);
    if (opciones.length === 0) return null;
    const distintas = new Set(opciones.map((o) => o.letras!.join('')));
    if (distintas.size > 1) return null;
    salida.set(i, opciones[0].letras!);
    libres.splice(opciones[0].j, 1);
  }
  return salida;
}

/** Palabra en mayúscula → número de nombres distintos de la base que la contienen. */
export type Diccionario = Map<string, number>;

export function construirDiccionario(nombres: Iterable<string>): Diccionario {
  const dic: Diccionario = new Map();
  const vistos = new Set<string>();
  for (const n of nombres) {
    if (!n) continue;
    const clave = mayus(n).replace(/\s+/g, ' ').trim();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    for (const p of new Set(fichas(clave).map((f) => f.texto))) {
      if (p.includes(SUSTITUCION) || [...p].every(esAscii)) continue;
      dic.set(p, (dic.get(p) ?? 0) + 1);
    }
  }
  return dic;
}

export const UMBRAL_DICCIONARIO = { cuota: 0.95, cuotaMismoAcento: 0.8, minimo: 5 } as const;

/**
 * Patrones de la vía c: con un solo hueco, el hueco es una «Ñ». Sólo entran entornos donde una
 * vocal con tilde no da apellidos ni nombres españoles: «…A�A» (PESTAÑA, CASTAÑA, MONTAÑA) y
 * «…E�ATE» (PEÑATE). Y sólo si el diccionario no conoce ninguna otra letra para esa palabra.
 */
export const PATRONES_ENE: readonly RegExp[] = [/U\uFFFDOZ$/, /A\uFFFDEZ$/, /U\uFFFDEZ$/, /^CA\uFFFD[AEIOU]/, /A\uFFFDA$/, /E\uFFFDATE$/];

export type DecisionPalabra = {
  palabra: string;
  /** Palabra reparada, con la caja del original; `null` si no se decidió. */
  reparada: string | null;
  via: Via | null;
  evidencia: string;
};

export type Propuesta = {
  original: string;
  /** Nombre reparado; `null` si alguna palabra quedó sin decidir. */
  propuesta: string | null;
  /** La vía más débil que hizo falta (a < b < c). */
  via: Via | null;
  palabras: DecisionPalabra[];
};

/** Caja de la letra según la palabra: «MU�OZ» → «Ñ», «Trist�n» → «á», «�lvaro» → «Á». */
function conCaja(palabra: string, posicion: number, letra: string): string {
  const resto = [...palabra].filter((c, i) => i !== posicion && c !== SUSTITUCION && /\p{L}/u.test(c));
  const todasMayus = resto.length > 0 && resto.every((c) => c === c.toUpperCase() && c !== c.toLowerCase());
  if (todasMayus) return letra.toUpperCase();
  if (posicion === 0) return letra.toUpperCase();
  return letra.toLowerCase();
}

function rellenar(palabra: string, letras: string[]): string {
  const cs = [...palabra];
  let k = 0;
  return cs.map((c, i) => (c === SUSTITUCION ? conCaja(palabra, i, letras[k++]) : c)).join('');
}

type Restriccion = { fija: string | null; opciones: readonly string[]; evidencia: string };

/** Combina lo que dicen las variantes sobre un hueco. */
function restriccionDeVariantes(todas: { letra: string; origen: string }[]): Restriccion {
  // Una «R» en el hueco no puede venir de una letra no ASCII: esa variante es otro nombre.
  const vistas = todas.filter((v) => !esAscii(v.letra) || LETRAS_CANDIDATAS.some((l) => letraBase(l) === letraBase(v.letra)));
  if (vistas.length === 0) return { fija: null, opciones: LETRAS_CANDIDATAS, evidencia: '' };
  const noAscii = [...new Set(vistas.map((v) => v.letra).filter((l) => !esAscii(l)))];
  const bases = new Set(vistas.map((v) => letraBase(v.letra)));
  const origenes = [...new Set(vistas.map((v) => v.origen))].slice(0, 3).join(', ');
  if (bases.size > 1) return { fija: null, opciones: LETRAS_CANDIDATAS, evidencia: `variantes en conflicto (${[...bases].join('/')})` };
  const base = [...bases][0];
  if (noAscii.length === 1) return { fija: noAscii[0], opciones: noAscii, evidencia: `«${noAscii[0]}» en ${origenes}` };
  const opciones = LETRAS_CANDIDATAS.filter((l) => letraBase(l) === base && (noAscii.length === 0 || noAscii.includes(l)));
  if (opciones.length === 1) {
    const por = noAscii.length === 0 ? `«${base}» sin tilde en ${origenes} y «${opciones[0]}» es la única letra no ASCII con esa base` : `«${opciones[0]}» en ${origenes}`;
    return { fija: opciones[0], opciones, evidencia: por };
  }
  return { fija: null, opciones: opciones.length ? opciones : LETRAS_CANDIDATAS, evidencia: `base «${base}» en ${origenes}` };
}

function decidirPalabra(palabra: string, vistasPorHueco: { letra: string; origen: string }[][], dic: Diccionario): DecisionPalabra {
  const huecos = [...palabra].filter((c) => c === SUSTITUCION).length;
  const restr = Array.from({ length: huecos }, (_, k) => restriccionDeVariantes(vistasPorHueco[k] ?? []));
  if (restr.every((r) => r.fija)) {
    return { palabra, reparada: rellenar(palabra, restr.map((r) => r.fija!)), via: 'a', evidencia: restr.map((r) => r.evidencia).join('; ') };
  }
  // Vía b: todas las combinaciones permitidas contra el diccionario.
  let combinaciones: string[][] = [[]];
  for (const r of restr) {
    const ops = r.fija ? [r.fija] : r.opciones;
    combinaciones = combinaciones.flatMap((c) => ops.map((o) => [...c, o]));
    if (combinaciones.length > 20_000) break;
  }
  if (combinaciones.length <= 20_000) {
    const rota = mayus(palabra);
    const cuentas = combinaciones
      .map((letras) => {
        let k = 0;
        const w = [...rota].map((c) => (c === SUSTITUCION ? letras[k++] : c)).join('');
        return { letras, w, n: dic.get(w) ?? 0 };
      })
      .filter((x) => x.n > 0)
      .sort((x, y) => y.n - x.n);
    const total = cuentas.reduce((s, x) => s + x.n, 0);
    const mejor = cuentas[0];
    const previa = restr.map((r) => r.evidencia).filter(Boolean).join('; ');
    const mismoAcento = cuentas.length > 1 && new Set(cuentas.map((x) => x.letras.map(letraBase).join(''))).size === 1;
    const cuota = mismoAcento ? UMBRAL_DICCIONARIO.cuotaMismoAcento : UMBRAL_DICCIONARIO.cuota;
    if (mejor && (cuentas.length === 1 || (mejor.n / total >= cuota && mejor.n >= UMBRAL_DICCIONARIO.minimo))) {
      const otras = cuentas.slice(1, 4).map((x) => `${x.w} ${x.n}`).join(', ');
      const regla = mismoAcento ? `; mismo acento base: ${mejor.n} frente a ${total - mejor.n}` : '';
      return {
        palabra,
        reparada: rellenar(palabra, mejor.letras),
        via: 'b',
        evidencia: `diccionario: ${mejor.w} en ${mejor.n} nombres${otras ? ` (frente a ${otras})` : ', única'}${regla}${previa ? `; ${previa}` : ''}`,
      };
    }
    if (huecos === 1 && cuentas.length === 0 && PATRONES_ENE.some((p) => p.test(rota)) && restr[0].opciones.includes('Ñ')) {
      return { palabra, reparada: rellenar(palabra, ['Ñ']), via: 'c', evidencia: `patrón español ${PATRONES_ENE.find((p) => p.test(rota))!.source.replace(/\\uFFFD/g, SUSTITUCION)}` };
    }
    const dudas = cuentas.slice(0, 4).map((x) => `${x.w} ${x.n}`).join(', ');
    return { palabra, reparada: null, via: null, evidencia: [previa, dudas ? `diccionario sin mayoría clara: ${dudas}` : 'sin palabra conocida'].filter(Boolean).join('; ') };
  }
  return { palabra, reparada: null, via: null, evidencia: 'demasiados huecos' };
}

const ORDEN_VIA: Record<Via, number> = { a: 0, b: 1, c: 2 };

/**
 * Propuesta para un nombre roto. `variantes` son nombres de la misma persona o de la
 * misma prueba; `mismaPersona` permite que la variante tenga palabras de más (fusión,
 * alias), mientras que una lectura de la prueba debe tener las mismas palabras.
 */
export function proponer(original: string, variantes: readonly (Variante & { mismaPersona: boolean })[], dic: Diccionario): Propuesta {
  const fo = fichas(original);
  const vistas = new Map<number, { letra: string; origen: string }[][]>();
  for (const v of variantes) {
    const l = letrasDeVariante(original, v.nombre, !v.mismaPersona);
    if (!l) continue;
    for (const [i, letras] of l) {
      const porHueco = vistas.get(i) ?? letras.map(() => []);
      letras.forEach((letra, k) => porHueco[k].push({ letra, origen: `${v.origen} «${v.nombre}»` }));
      vistas.set(i, porHueco);
    }
  }
  const palabras: DecisionPalabra[] = [];
  let salida = '';
  let cursor = 0;
  for (const [i, f] of fo.entries()) {
    if (!f.texto.includes(SUSTITUCION)) continue;
    const d = decidirPalabra(f.texto, vistas.get(i) ?? [], dic);
    palabras.push(d);
    salida += original.slice(cursor, f.inicio) + (d.reparada ?? f.texto);
    cursor = f.inicio + f.texto.length;
  }
  salida += original.slice(cursor);
  const completa = palabras.length > 0 && palabras.every((p) => p.reparada !== null) && !tieneSustitucion(salida);
  const via = completa ? palabras.map((p) => p.via!).sort((x, y) => ORDEN_VIA[y] - ORDEN_VIA[x])[0] : null;
  return { original, propuesta: completa ? salida : null, via, palabras };
}
