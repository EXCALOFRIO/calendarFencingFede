/**
 * Comparación de nombres publicados para decidir uniones de personas (lote 8).
 *
 * `normalizarNombre` (comun.ts) ordena las palabras alfabéticamente: sirve de clave de
 * búsqueda, pero pierde el orden de los apellidos, y en España «ROMERO ORTIN Héctor» y
 * «ORTIN ROMERO Héctor» son dos personas (primos con los apellidos cruzados, hermanos de
 * otra madre…). Aquí se compara con el orden en que lo publica la fuente:
 *
 *  - normalización: mayúsculas, tildes, ñ/n, ç/c, guiones, apóstrofos («D'ALESSANDRO» =
 *    «DALESSANDRO»), espacios, partículas (de, del, de la, y, i, da, di, van, von…),
 *    abreviaturas (Mª/M.ª → María, Fco. → Francisco, Fdez. → Fernández…) y caracteres rotos
 *    («NU #65533;EZ»);
 *  - unidades: un apellido con guion («LOPEZ-BARAJAS», «SEMAPAKDI-CHANG») es una sola unidad;
 *  - nombre de pila y apellidos: la FIE, el PDF y Engarde escriben «APELLIDOS Nombre» (los
 *    apellidos en mayúsculas); Skermo «NOMBRE APELLIDOS» todo en mayúsculas. Si un lado marca
 *    el nombre de pila con minúsculas, el otro se parte de las formas que casan con éste
 *    («DAIVIK ROSHAN PERSAUD» frente a «PERSAUD Daivik Ros»: un apellido, dos nombres); si
 *    ninguno lo marca, se prueban las particiones habituales de cada fuente (el PDF recorta:
 *    «GONZALEZ DE HERRERO FER» son tres apellidos sin nombre) y gana la más compatible;
 *  - relación: `mismo`, `recortado` (el PDF corta palabras o falta el nombre), `compuesto_simple`
 *    («Francisco Javier» / «Javier»), `variante_caracter` (un solo carácter distinto),
 *    `orden_cruzado`, `primos` (un apellido en común y el otro claramente distinto), `hermanos`
 *    (los mismos apellidos, otro nombre claramente distinto) y `distinto` (lo demás, también lo
 *    dudoso: «YUSTA» / «YUSTES»).
 *
 * `nivelUnion` dice qué hace falta para unir: `libre` (basta el nombre con las reglas de
 * siempre: candidato único, género, fechas), `pista` (candidato único y otra pista), `evidencia`
 * (licencia, ID FIE, mismo club y año de nacimiento, o continuidad del cuadro o la poule en la
 * misma prueba) o `nunca` por nombre.
 */
import { distanciaEdicion } from '../../src/lib/nombres';

export const PARTICULAS_UNION: ReadonlySet<string> = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'e', 'da', 'das', 'do', 'dos', 'di', 'du', 'van', 'von', 'der', 'den', 'ten',
  'ter', 'le', 'lo', 'd',
]);

/** Abreviaturas de nombres y apellidos que publican las actas a mano. */
export const ABREVIATURAS: ReadonlyMap<string, string> = new Map([
  ['fco', 'francisco'], ['fdo', 'fernando'], ['fdez', 'fernandez'], ['frdez', 'fernandez'], ['glez', 'gonzalez'],
  ['hdez', 'hernandez'], ['hrdez', 'hernandez'], ['rguez', 'rodriguez'], ['rodz', 'rodriguez'], ['mtnez', 'martinez'],
  ['mtez', 'martinez'], ['gcia', 'garcia'], ['dguez', 'dominguez'],
]);

const LETRAS_SUELTAS: Record<string, string> = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i' };

/** `guion`: unida a la anterior por un guion (apellido compuesto). */
export type Palabra = { w: string; mayus: boolean; particula: boolean; guion: boolean };

function esMayusculas(t: string): boolean {
  return /\p{L}/u.test(t) && t === t.toLocaleUpperCase('es') && t !== t.toLocaleLowerCase('es');
}

/** Una palabra sin tildes, en minúsculas y sólo letras/dígitos (ñ → n, ç → c). */
export function normalizarPalabra(t: string): string {
  return t.replace(/[øØæÆœŒßłŁđĐı]/g, (c) => LETRAS_SUELTAS[c])
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Palabras de un nombre con su forma normalizada, en el orden publicado. */
export function palabrasUnion(texto: string): Palabra[] {
  // Un carácter que se perdió al leer («NU #65533;EZ», «NU�EZ») no parte la palabra.
  let t = texto.normalize('NFC').replace(/\s*&?#\d+;\s*/g, '').replace(/\uFFFD/g, '');
  const todoMayus = !/\p{Ll}/u.test(t.replace(/[ªº]/g, ''));
  // «Mª», «M.ª», «Mª.» = María (con las mayúsculas del resto, para no romper el formato).
  t = t.replace(/\bM\s*\.?\s*[ªº]\.?/gu, todoMayus ? ' MARIA ' : ' María ');
  t = t.replace(/['’`´]/g, '');
  const out: Palabra[] = [];
  let guion = false;
  for (const trozo of t.split(/(\s+|[-‐–—]+|[.,;:/()]+)/u)) {
    if (/^[-‐–—]+$/u.test(trozo)) { guion = true; continue; }
    if (/^(\s+|[.,;:/()]+)$/u.test(trozo) || !trozo) { if (trozo) guion = false; continue; }
    const w0 = normalizarPalabra(trozo);
    if (!w0) continue;
    const mayus = esMayusculas(trozo);
    (ABREVIATURAS.get(w0) ?? w0).split(' ').forEach((w, i) => {
      out.push({ w, mayus, particula: PARTICULAS_UNION.has(w), guion: guion && i === 0 });
    });
    guion = false;
  }
  return out;
}

/** Forma comparable completa: palabras significativas en el orden publicado. */
export function normalizarUnion(texto: string): string {
  return palabrasUnion(texto).filter((p) => !p.particula).map((p) => p.w).join(' ');
}

export type Formato = 'apellidos_primero' | 'nombre_primero';
/** Palabras de un apellido o nombre (varias si lleva guion). */
type Unidad = string[];
/**
 * `extendida`: partición poco habitual. `recorte`: más apellidos de los habituales (el PDF
 * recorta el nombre, o un apellido compuesto sin guion); `marcas`: un solo apellido, sólo si el
 * otro lado lo marca con mayúsculas y lo confirma (extranjeros en Skermo).
 */
type Partido = { nombre: Unidad[]; apellidos: Unidad[]; extendida?: 'recorte' | 'marcas' };

type Analisis = {
  palabras: string[];
  unidades: Unidad[];
  /** Partición que dicen las mayúsculas (null: la fuente no distingue nombre y apellidos). */
  marcado: Partido | null;
  /** Todo en minúsculas o en «Nombre Apellido»: el orden de Skermo, sin marcas. */
  titulo: boolean;
};

function analizar(texto: string): Analisis {
  const ps = palabrasUnion(texto).filter((p) => !p.particula);
  const unidades: Unidad[] = [];
  const marcas: boolean[] = [];
  for (const p of ps) {
    if (p.guion && unidades.length > 0) {
      unidades[unidades.length - 1].push(p.w);
      marcas[marcas.length - 1] &&= p.mayus;
    } else {
      unidades.push([p.w]);
      marcas.push(p.mayus);
    }
  }
  const base = { palabras: ps.map((p) => p.w), unidades };
  const primeraMinus = marcas.indexOf(false);
  const primeraMayus = marcas.indexOf(true);
  // «ROMERO ORTÍN Héctor»: apellidos en mayúsculas delante, nombre después.
  if (primeraMinus > 0 && marcas.slice(primeraMinus).every((m) => !m)) {
    return { ...base, titulo: false, marcado: { apellidos: unidades.slice(0, primeraMinus), nombre: unidades.slice(primeraMinus) } };
  }
  // «Héctor ROMERO ORTÍN»: nombre delante y apellidos en mayúsculas.
  if (primeraMinus === 0 && primeraMayus > 0 && marcas.slice(primeraMayus).every(Boolean)) {
    return { ...base, titulo: false, marcado: { nombre: unidades.slice(0, primeraMayus), apellidos: unidades.slice(primeraMayus) } };
  }
  return { ...base, titulo: unidades.length >= 2 && marcas.every((m) => !m), marcado: null };
}

export type NombreAnalizado = {
  original: string;
  /** Significativas, en el orden publicado. */
  palabras: string[];
  /** null: la fuente no distingue nombre y apellidos (todo en mayúsculas). */
  nombre: string[] | null;
  apellidos: string[] | null;
};

/** Partición habitual (la primera de `particiones`). */
export function analizarNombre(texto: string, formato?: Formato): NombreAnalizado {
  const A = analizar(texto);
  const p = A.marcado ?? (A.titulo || formato ? particiones(A, A.titulo ? 'nombre_primero' : formato)[0] : null);
  return {
    original: texto, palabras: A.palabras,
    nombre: p ? p.nombre.flat() : null, apellidos: p ? p.apellidos.flat() : null,
  };
}

/**
 * Particiones posibles de un nombre sin marcas, la habitual primero. Sin formato conocido, la
 * de Skermo (y, con dos palabras o si el otro lado marca el nombre, también las del PDF).
 */
function particiones(A: Analisis, formato: Formato | undefined, ambos = false): Partido[] {
  if (A.marcado) return [A.marcado];
  const u = A.unidades;
  const n = u.length;
  if (n === 0) return [];
  const ap = (k: number, extendida?: Partido['extendida']): Partido => ({ apellidos: u.slice(0, k), nombre: u.slice(k), extendida });
  const np = (k: number, extendida?: Partido['extendida']): Partido => ({ nombre: u.slice(0, k), apellidos: u.slice(k), extendida });
  const out: Partido[] = [];
  if (formato === 'apellidos_primero' || (!formato && (n === 2 || ambos))) {
    if (n === 1) out.push(ap(1));
    // «ELODIE BELMONTE» en un PDF: a veces el nombre va delante.
    else if (n === 2) out.push(ap(2), ap(1), ...(formato ? [np(1, 'recorte')] : []));
    else {
      // El PDF recorta: el tercer trozo puede ser un apellido («… FER», «… DE LUC»).
      out.push(ap(2));
      for (let k = 3; k <= n; k += 1) out.push(ap(k, 'recorte'));
      out.push(ap(1, 'marcas'));
    }
  }
  if (formato !== 'apellidos_primero') {
    if (n === 1) out.push(np(0));
    else if (n === 2) out.push(np(1));
    else {
      out.push(np(n - 2));
      // Apellido compuesto sin guion («CARLOS LOPEZ RUIPEREZ GARCIA») o extranjero con un apellido.
      for (let k = 1; k < n - 2; k += 1) out.push(np(k, 'recorte'));
      out.push(np(n - 1, 'marcas'));
    }
  }
  return out;
}

type Cmp = 'igual' | 'prefijo' | 'variante' | 'distinto';
/**
 * `minPrefijo`: letras que debe tener la palabra recortada. Una o dos letras con la misma
 * inicial son una inicial o un recorte («Ll» de «Lluís» frente a «Luis»).
 */
function cmpPalabra(x: string, y: string, minPrefijo = 1): Cmp {
  if (x === y) return 'igual';
  const corta = Math.min(x.length, y.length);
  if (corta >= minPrefijo && (x.startsWith(y) || y.startsWith(x))) return 'prefijo';
  if (corta <= 2 && x[0] === y[0]) return 'prefijo';
  if (corta >= 4 && distanciaEdicion(x, y, 1) <= 1) return 'variante';
  return 'distinto';
}

/** Dos apellidos: enteros, uno recortado, una parte del compuesto («CHANG» de «SEMAPAKDI-CHANG») o una errata. */
function cmpUnidad(a: Unidad, b: Unidad): Cmp {
  const x = a.join('');
  const y = b.join('');
  const c = cmpPalabra(x, y, 2);
  if (c !== 'distinto') return c;
  if ((a.length > 1 || b.length > 1) && a.some((w) => b.some((v) => w.length >= 3 && cmpPalabra(w, v, 3) !== 'distinto' && cmpPalabra(w, v, 3) !== 'variante'))) return 'prefijo';
  return 'distinto';
}

/**
 * Claramente distintos: ni recorte, ni errata de una letra, ni demasiado cortos para saberlo,
 * ni el mismo comienzo con dos letras cambiadas al final («YUSTA» / «YUSTES»).
 */
function claramenteDistintos(a: Unidad, b: Unidad): boolean {
  const x = a.join('');
  const y = b.join('');
  if (Math.min(x.length, y.length) < 3 || x.startsWith(y) || y.startsWith(x)) return false;
  const d = distanciaEdicion(x, y, 2);
  if (d <= 1) return false;
  let comun = 0;
  while (comun < Math.min(x.length, y.length) && x[comun] === y[comun]) comun += 1;
  return !(d <= 2 && comun >= 4);
}

type Apellidos = { tipo: 'ok' | 'cruzado' | 'primos' | 'distinto'; variante: boolean; prefijo: boolean; parcial: boolean };

function compararApellidos(a: readonly Unidad[], b: readonly Unidad[]): Apellidos {
  const r = (tipo: Apellidos['tipo'], cs: Cmp[] = [], parcial = false): Apellidos =>
    ({ tipo, variante: cs.includes('variante'), prefijo: cs.includes('prefijo'), parcial });
  if (a.length === 0 || b.length === 0) return r('distinto');
  // Los mismos apellidos partidos o juntados de otra forma («CARRASC OSA», «LAMA PEREIRA» / «LAMAPEREIRA»).
  const ja = a.flat().join('');
  const jb = b.flat().join('');
  if (ja === jb) return r('ok', a.length === b.length && a.every((x, i) => x.join('') === b[i].join('')) ? ['igual'] : ['prefijo']);
  if (Math.min(ja.length, jb.length) >= 6 && (ja.startsWith(jb) || jb.startsWith(ja))) return r('ok', ['prefijo']);
  if (a.length >= 2 && b.length >= 2) {
    const directo = [cmpUnidad(a[0], b[0]), cmpUnidad(a[1], b[1])];
    if (directo.every((c) => c !== 'distinto')) return r('ok', directo);
    // Un apellido de más en medio («GARCIA MARTIN» / «GARCIA-SAN MIGUEL MARTIN»).
    const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
    if (largo.length > corto.length) {
      let j = 0;
      const cs: Cmp[] = [];
      for (const x of corto) {
        while (j < largo.length && cmpUnidad(x, largo[j]) === 'distinto') j += 1;
        if (j >= largo.length) break;
        cs.push(cmpUnidad(x, largo[j]));
        j += 1;
      }
      if (cs.length === corto.length) return r('ok', [...cs, 'prefijo']);
    }
    const cruce = [cmpUnidad(a[0], b[1]), cmpUnidad(a[1], b[0])];
    if (cruce.every((c) => c !== 'distinto')) return r('cruzado', cruce);
    // Primos: uno en común (en su sitio o cruzado) y el otro claramente distinto.
    if (directo[0] !== 'distinto' && claramenteDistintos(a[1], b[1])) return r('primos');
    if (directo[1] !== 'distinto' && claramenteDistintos(a[0], b[0])) return r('primos');
    if (cruce[0] !== 'distinto' && claramenteDistintos(a[1], b[0])) return r('primos');
    if (cruce[1] !== 'distinto' && claramenteDistintos(a[0], b[1])) return r('primos');
    return r('distinto');
  }
  const [uno, varios] = a.length === 1 ? [a, b] : [b, a];
  const primero = cmpUnidad(uno[0], varios[0]);
  // La FIE publica sólo el primer apellido; si casa con el segundo, es el orden cruzado.
  if (primero !== 'distinto') return r('ok', [primero], varios.length > 1);
  if (varios.length > 1 && cmpUnidad(uno[0], varios[1]) !== 'distinto') return r('cruzado');
  return r('distinto');
}

function compararPila(a: readonly Unidad[], b: readonly Unidad[]): 'igual' | 'recortado' | 'compuesto' | 'variante' | 'distinto' {
  const wa = a.flat();
  const wb = b.flat();
  if (wa.length === 0 || wb.length === 0) return wa.length === wb.length ? 'igual' : 'recortado';
  if (wa.length === wb.length && wa.every((w, i) => w === wb[i])) return 'igual';
  const [corto, largo] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const cs = corto.map((w, i) => cmpPalabra(w, largo[i]));
  if (cs.every((c) => c === 'igual' || c === 'prefijo')) return corto.length === largo.length ? 'recortado' : 'compuesto';
  if (corto.length === largo.length) {
    if (cs.filter((c) => c === 'variante').length === 1 && cs.every((c) => c !== 'distinto')) return 'variante';
    // El mismo nombre de pila con las palabras en otro orden («María José» / «José María») no es el mismo nombre.
    return 'distinto';
  }
  // «Javier» / «Francisco Javier», «Asia» / «Eleonora Asia»: el simple es una parte del compuesto, en orden.
  let j = 0;
  for (const w of corto) {
    while (j < largo.length && ['distinto', 'variante'].includes(cmpPalabra(w, largo[j]))) j += 1;
    if (j >= largo.length) return 'distinto';
    j += 1;
  }
  return 'compuesto';
}

export type Relacion =
  | 'mismo' | 'recortado' | 'compuesto_simple' | 'variante_caracter' | 'orden_cruzado' | 'primos' | 'hermanos' | 'distinto';

/** De más a menos compatible. */
export const ORDEN_RELACION: readonly Relacion[] = [
  'mismo', 'recortado', 'compuesto_simple', 'variante_caracter', 'orden_cruzado', 'primos', 'hermanos', 'distinto',
];

function relacionPartidos(pa: Partido, pb: Partido): Relacion {
  const ap = compararApellidos(pa.apellidos, pb.apellidos);
  const pila = compararPila(pa.nombre, pb.nombre);
  if (ap.tipo === 'distinto') return 'distinto';
  if (ap.tipo === 'primos') return pila === 'distinto' ? 'distinto' : 'primos';
  if (ap.tipo === 'cruzado') return pila === 'distinto' ? 'distinto' : 'orden_cruzado';
  if (pila === 'distinto') {
    // Hermanos: los dos nombres de pila enteros y claramente distintos.
    const claro = pa.nombre.length > 0 && pb.nombre.length > 0
      && pa.nombre.flat().every((w) => pb.nombre.flat().every((v) => claramenteDistintos([w], [v]) || w === v))
      && !ap.variante;
    return claro ? 'hermanos' : 'distinto';
  }
  const variantes = (ap.variante ? 1 : 0) + (pila === 'variante' ? 1 : 0);
  if (variantes > 1) return 'distinto';
  // Una errata sólo se acepta si el resto del nombre es idéntico («Luis»/«Luisa» con otra errata no).
  if (variantes === 1) return pila === 'recortado' || pila === 'compuesto' || ap.prefijo || ap.parcial ? 'distinto' : 'variante_caracter';
  if (pila === 'compuesto') return 'compuesto_simple';
  if (pila === 'recortado' || ap.prefijo || ap.parcial) return 'recortado';
  return 'mismo';
}

const coma = (u: readonly Unidad[]) => u.map((x) => x.join(' ')).join('|');

/**
 * Nombres de pila muy frecuentes: en un nombre sin marcas, una de estas palabras que el otro
 * lado no publica es un segundo nombre («ALEXA MARIA SERBANESCU» / «SERBANESCU Ale»), no un apellido.
 */
const NOMBRES_FRECUENTES: ReadonlySet<string> = new Set([
  'maria', 'jose', 'juan', 'ana', 'luis', 'carmen', 'francisco', 'antonio', 'manuel', 'javier', 'carlos', 'jesus', 'angel',
  'miguel', 'pablo', 'pedro', 'david', 'daniel', 'alejandro', 'fernando', 'rafael', 'isabel', 'teresa', 'pilar', 'rosa',
  'elena', 'lucia', 'sofia', 'paula', 'laura', 'marta', 'julia', 'victoria', 'cristina', 'andrea', 'alba', 'irene', 'eva',
  'ignacio', 'ramon', 'enrique', 'alberto', 'alvaro', 'jorge', 'diego', 'mario', 'hugo', 'marc', 'jordi', 'pau', 'joan',
  'jean', 'pierre', 'marie', 'anne', 'louis', 'paul', 'john', 'james', 'michael', 'peter', 'mark', 'anna', 'sophie', 'emma',
  'giovanni', 'giuseppe', 'marco', 'luca', 'alessandro', 'francesco', 'elizabeth', 'alexandra', 'nicolas', 'ines', 'clara',
]);

/**
 * Particiones de `A` que no contradicen el nombre marcado `M`: ninguna palabra que en `M` es
 * apellido queda en el nombre de pila ni al revés. Vacío si ninguna.
 */
function coherentes(A: Analisis, ps: Partido[], M: Partido): Partido[] {
  const ap = M.apellidos.flat();
  const juntos = ap.join('');
  const pila = M.nombre.flat();
  const tipo = (w: string) => {
    const s = ap.some((x) => cmpPalabra(w, x, 3) !== 'distinto' && cmpPalabra(w, x, 3) !== 'variante') || (w.length >= 3 && juntos.includes(w));
    const g = pila.some((x) => cmpPalabra(w, x) !== 'distinto');
    return s && !g ? 'S' : g && !s ? 'G' : '?';
  };
  const tipos = new Map(A.palabras.map((w) => [w, tipo(w)]));
  // Un solo apellido (extranjeros en Skermo) sólo si el otro lo confirma: todo el nombre de pila
  // casa con el suyo o es un nombre muy frecuente («DAIVIK ROSHAN» / «Daivik Ros»). Con «SANDRA
  // ROMERO ORTIN» frente a «ORTIN Sandra», «ROMERO» no dice nada: queda como apellido (Skermo).
  return ps.filter((p) => {
    const nombre = p.nombre.flat();
    const apellidos = p.apellidos.flat();
    if (p.extendida === 'marcas') {
      return nombre.every((w) => tipos.get(w) === 'G' || (tipos.get(w) === '?' && NOMBRES_FRECUENTES.has(w)))
        && apellidos.every((w) => tipos.get(w) === 'S');
    }
    // Un apellido compuesto sin guion no empieza por un nombre muy frecuente («JOSE MARIA GARCIA …»).
    return nombre.every((w) => tipos.get(w) !== 'S') && apellidos.every((w) => tipos.get(w) !== 'G'
      && !(p.extendida === 'recorte' && tipos.get(w) === '?' && NOMBRES_FRECUENTES.has(w)));
  });
}

/**
 * Un recorte o un apellido compuesto (`recorte`) sólo vale si los apellidos casan y no se traga
 * el nombre de pila: con más apellidos que el otro lado y sin nombre, «ORTIN ROMERO SANDRA»
 * casaría con «GERMAN ORTIN ROMERO». Sí si el otro publica un solo apellido (la FIE) o si son
 * los del otro recortados («SOLANO FERNANDEZ SOR» / «SOLANO FERNANDEZ-SORDO»).
 */
function recorteValido(x: Partido, y: Partido): boolean {
  if (x.extendida !== 'recorte') return true;
  if (compararApellidos(x.apellidos, y.apellidos).tipo !== 'ok') return false;
  const jx = x.apellidos.flat().join('');
  const jy = y.apellidos.flat().join('');
  return x.apellidos.length <= y.apellidos.length || x.nombre.length > 0 || jy.startsWith(jx)
    || (y.apellidos.length === 1 && !y.extendida && y.nombre.length > 0);
}

const otroFormato = (f: Formato | undefined): Formato | undefined =>
  f === 'apellidos_primero' ? 'nombre_primero' : f === 'nombre_primero' ? 'apellidos_primero' : undefined;

/** Particiones de un nombre sin marcas frente a uno marcado; si su formato no da ninguna coherente, el otro (la fuente se equivocó). */
function frenteAMarcado(A: Analisis, f: Formato | undefined, M: Partido): Partido[] {
  const ok = coherentes(A, particiones(A, f, true), M);
  if (ok.length > 0) return ok;
  const otro = otroFormato(f);
  const alt = otro ? coherentes(A, particiones(A, otro, true), M) : [];
  return alt.length > 0 ? alt : particiones(A, f, true).filter((p) => !p.extendida);
}

/**
 * `formatos`: cómo escribe cada fuente un nombre todo en mayúsculas (Skermo, nombre primero;
 * el resto, apellidos primero). Si un lado marca el nombre de pila con minúsculas, el otro se
 * parte de las formas que casan con éste; si ninguno, se prueban las particiones de cada fuente.
 */
export function relacionNombres(a: string, b: string, formatos: { a?: Formato; b?: Formato } = {}): Relacion {
  const A = analizar(a);
  const B = analizar(b);
  if (A.palabras.length === 0 || B.palabras.length === 0) return 'distinto';
  if (A.palabras.join(' ') === B.palabras.join(' ') || A.palabras.join('') === B.palabras.join('')) return 'mismo';
  const fa = A.titulo ? 'nombre_primero' : formatos.a;
  const fb = B.titulo ? 'nombre_primero' : formatos.b;
  const mismas = [...A.palabras].sort().join(' ') === [...B.palabras].sort().join(' ');
  if (mismas && !A.marcado && !B.marcado) {
    const n = A.palabras.length;
    // Dos palabras al revés: con el mismo formato (o sin saberlo), los apellidos cruzados; con
    // formatos distintos («ANTIVERO LUCILA» del PDF, «LUCILA ANTIVERO» de Skermo), se comprueba.
    if (n <= 2 && (!fa || !fb || fa === fb)) return 'orden_cruzado';
    // «HECTOR ROMERO ORTIN» / «ROMERO ORTIN HECTOR»: el mismo orden de los apellidos.
    if (n >= 3) for (let k = 1; k < n; k += 1) if ([...A.palabras.slice(k), ...A.palabras.slice(0, k)].join(' ') === B.palabras.join(' ')) return 'mismo';
  }
  const pas = B.marcado && !A.marcado ? frenteAMarcado(A, fa, B.marcado) : particiones(A, fa).filter((p) => p.extendida !== 'marcas');
  const pbs = A.marcado && !B.marcado ? frenteAMarcado(B, fb, A.marcado) : particiones(B, fb).filter((p) => p.extendida !== 'marcas');
  let mejor: Relacion = 'distinto';
  const vistos = new Set<string>();
  for (const pa of pas) {
    for (const pb of pbs) {
      const k = `${coma(pa.apellidos)}/${coma(pa.nombre)}#${coma(pb.apellidos)}/${coma(pb.nombre)}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      if (!recorteValido(pa, pb) || !recorteValido(pb, pa)) continue;
      const rel = relacionPartidos(pa, pb);
      if (ORDEN_RELACION.indexOf(rel) < ORDEN_RELACION.indexOf(mejor)) mejor = rel;
      if (mejor === 'mismo') return mejor;
    }
  }
  return mejor;
}

export type NivelUnion = 'libre' | 'pista' | 'evidencia' | 'nunca';

export function nivelUnion(r: Relacion): NivelUnion {
  if (r === 'mismo' || r === 'recortado' || r === 'compuesto_simple') return 'libre';
  if (r === 'variante_caracter') return 'pista';
  if (r === 'orden_cruzado') return 'evidencia';
  return 'nunca';
}

/** Un nombre tal cual lo publica una fuente (`sport_person_alias.source`, `sport_result.source`). */
export type NombrePublicado = string | { nombre: string; fuente?: string | null };

/** Skermo escribe «NOMBRE APELLIDOS»; la FIE, la EFC, Engarde y los PDF, «APELLIDOS Nombre». */
export function formatoDeFuente(fuente: string | null | undefined): Formato | undefined {
  if (!fuente) return undefined;
  return fuente === 'skermo_rfee' ? 'nombre_primero' : 'apellidos_primero';
}

/** De más a menos fiable para el nombre visible: nunca se ordenan las palabras. */
const PRIORIDAD_FUENTE = ['fie', 'skermo_rfee', 'efc_licencia', 'efc', 'rfee_pdf', 'engarde'];
export function prioridadFuente(fuente: string | null | undefined): number {
  const i = PRIORIDAD_FUENTE.indexOf(fuente ?? '');
  return i < 0 ? PRIORIDAD_FUENTE.length : i;
}

const comoPublicado = (x: NombrePublicado) => (typeof x === 'string' ? { nombre: x, fuente: null } : x);
/** Sin repetidos; el nombre visible sin fuente sobra si un alias da ese mismo nombre con la suya. */
function unicos(xs: Iterable<NombrePublicado>): { nombre: string; fuente?: string | null }[] {
  const l = [...xs].map(comoPublicado);
  const conFuente = new Set(l.filter((x) => x.fuente).map((x) => x.nombre));
  return [...new Map(l.filter((x) => x.fuente || !conFuente.has(x.nombre)).map((x) => [`${x.fuente ?? ''}|${x.nombre}`, x])).values()];
}

/** El par de nombres publicados más compatible entre dos personas. */
export function mejorRelacion(as: Iterable<NombrePublicado>, bs: Iterable<NombrePublicado>): { relacion: Relacion; a: string; b: string } | null {
  const lb = unicos(bs);
  const la = unicos(as);
  let mejor: { relacion: Relacion; a: string; b: string } | null = null;
  for (const a of la) {
    for (const b of lb) {
      const relacion = relacionNombres(a.nombre, b.nombre, { a: formatoDeFuente(a.fuente), b: formatoDeFuente(b.fuente) });
      if (!mejor || ORDEN_RELACION.indexOf(relacion) < ORDEN_RELACION.indexOf(mejor.relacion)) mejor = { relacion, a: a.nombre, b: b.nombre };
      if (mejor.relacion === 'mismo') return mejor;
    }
  }
  return mejor;
}

/**
 * Pruebas que permiten unir dos nombres que el nombre solo no deja unir:
 *  - `identidad`: la misma licencia o el mismo ID FIE publicados en los dos lados;
 *  - `clubYAnio`: el mismo club y el mismo año de nacimiento conocido;
 *  - `continuidad`: el cuadro o la poule de la misma prueba enlaza los dos nombres.
 */
export type PruebasUnion = { identidad?: boolean; clubYAnio?: boolean; continuidad?: boolean };

/**
 * Por qué no se pueden unir dos personas por su nombre (null: el nombre no lo impide). Sólo
 * decide lo que el nombre dice con seguridad: apellidos cruzados (salvo otra prueba), hermanos
 * y primos (nunca por nombre; sí con la misma licencia o ID). `distinto` no se decide aquí: los
 * pasos que llegan a comparar ya exigieron palabras en común, y un nombre partido de otra
 * forma (compuestos, partículas) no debe deshacer lo que esos pasos ya comprueban.
 */
export function motivoNoUnir(
  as: Iterable<NombrePublicado>, bs: Iterable<NombrePublicado>, pruebas: PruebasUnion = {},
): { relacion: Relacion; a: string; b: string } | null {
  const m = mejorRelacion(as, bs);
  if (!m || pruebas.identidad) return null;
  if (m.relacion === 'orden_cruzado') return pruebas.clubYAnio || pruebas.continuidad ? null : m;
  if (m.relacion === 'hermanos' || m.relacion === 'primos') return m;
  return null;
}

/** Uniones por nombre que `motivoNoUnir` impidió, por paso y por relación, con los nombres originales. */
export type InformeOrden = { bloqueadas: number; porPaso: Record<string, number>; porRelacion: Record<string, number>; ejemplos: string[] };
export const nuevoInformeOrden = (): InformeOrden => ({ bloqueadas: 0, porPaso: {}, porRelacion: {}, ejemplos: [] });
export function sumarOrden(a: InformeOrden, b: InformeOrden | undefined): void {
  if (!b) return;
  a.bloqueadas += b.bloqueadas;
  for (const [k, v] of Object.entries(b.porPaso)) a.porPaso[k] = (a.porPaso[k] ?? 0) + v;
  for (const [k, v] of Object.entries(b.porRelacion)) a.porRelacion[k] = (a.porRelacion[k] ?? 0) + v;
  a.ejemplos.push(...b.ejemplos.slice(0, Math.max(0, 400 - a.ejemplos.length)));
}
export function anotarBloqueo(inf: InformeOrden, paso: string, m: { relacion: Relacion; a: string; b: string }, ids = ''): void {
  inf.bloqueadas += 1;
  inf.porPaso[paso] = (inf.porPaso[paso] ?? 0) + 1;
  inf.porRelacion[m.relacion] = (inf.porRelacion[m.relacion] ?? 0) + 1;
  if (inf.ejemplos.length < 400) inf.ejemplos.push(`${paso}: «${m.a}» ≠ «${m.b}» (${m.relacion})${ids ? ` ${ids}` : ''}`);
}

/**
 * Firma del orden de los apellidos para agrupar nombres publicados: dos nombres con las mismas
 * palabras y los apellidos cruzados tienen firmas distintas. Sin marcas de mayúsculas se usa la
 * partición habitual del formato de la fuente (o la de Skermo).
 */
export function firmaApellidos(texto: string, formato?: Formato): string {
  const A = analizar(texto);
  const p = A.marcado ?? particiones(A, A.titulo ? 'nombre_primero' : formato ?? 'nombre_primero')[0];
  return p ? p.apellidos.flat().join(' ') : '';
}
