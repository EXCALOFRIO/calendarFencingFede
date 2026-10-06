/**
 * Nombre completo de una persona a partir de las variantes publicadas por las
 * fuentes PARA ESA MISMA PERSONA (sus alias, los nombres de sus resultados y de
 * su grupo de fusión, la ficha FIE, Skermo). Nunca mira a otras personas: sólo
 * alarga un nombre con palabras que otra variante de la misma persona publica.
 *
 * Reglas:
 *  1. Una variante sirve si contiene todas las palabras del nombre actual
 *     (comparadas sin acentos ni mayúsculas; una inicial o un truncado del PDF
 *     cuentan como la palabra que empiezan) y añade alguna más.
 *  2. Se queda la más completa. Si hay dos completas incompatibles («Carlos
 *     Llavador Fernández» frente a «Carlos Llavador García») gana la que tenga
 *     al menos el doble de apariciones; si no, no se alarga.
 *  3. Orden «Nombre Apellidos», usando el corte nombre/apellidos que publican
 *     las fuentes estructuradas (FIE firstName/lastName, Skermo Nombre/Apellidos,
 *     «APELLIDOS Nombre» de FIE/Engarde/PDF).
 *  4. Acentos: los de cualquier variante de la misma persona («FERNÁNDEZ» en
 *     Skermo). Si ninguna los trae, sin acentos.
 *  5. Mayúsculas de nombre propio; partículas («de», «del», «la»…) en minúscula.
 */

export type OrdenVariante = 'apellidos-nombre' | 'nombre-apellidos' | 'desconocido';

export type VarianteNombre = {
  texto: string;
  fuente: string;
  /** Si la fuente separa el nombre propio de los apellidos. */
  nombre?: string | null;
  apellidos?: string | null;
  /** Orden conocido cuando la fuente no separa los campos. */
  orden?: OrdenVariante;
  /** Apariciones (resultados) que respaldan la variante. */
  peso?: number;
  /** Sólo aporta acentos, nunca palabras (p. ej. el nombre del archivo de la foto FIE). */
  soloAcentos?: boolean;
};

export type NombreCompleto = {
  /** «Carlos Llavador Fernández». */
  completo: string;
  nombre: string;
  apellidos: string;
  /** Añade palabras al nombre actual. */
  extendido: boolean;
  /** Algún acento procede de una variante de la persona. */
  conAcentos: boolean;
  fuente: string;
  motivo: 'extendido' | 'igual' | 'conflicto' | 'sin_estructura';
};

export const PARTICULAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'e', 'da', 'das', 'do', 'dos',
  'di', 'du', 'van', 'von', 'der', 'den', 'le', 'lo', 'san', 'santa', 'al', 'bin', 'ben',
]);

/** Partículas que se escriben en minúscula dentro del nombre. «San»/«Santa» no. */
const MINUSCULAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'e', 'da', 'das', 'do', 'dos',
  'di', 'du', 'van', 'von', 'der', 'den', 'le', 'lo',
]);

const MAX_PALABRAS = 8;

export function sinAcentos(t: string): string {
  return t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Palabras originales (con acentos). El guion separa, como en `palabrasNombre`:
 * la FIE publica «MARTIN-PORTUGUES» y la RFEE «MARTIN PORTUGUES».
 */
export function palabrasOriginales(texto: string): string[] {
  return texto
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}'’ ]+/gu, ' ')
    .split(/\s+/)
    .map((p) => p.replace(/^['’]+|['’]+$/g, ''))
    .filter(Boolean);
}

export const clave = (p: string) => sinAcentos(p).replace(/[’]/g, "'");

export const tieneAcentos = (p: string) => p.normalize('NFD') !== p.normalize('NFD').replace(/\p{Diacritic}/gu, '');

function esMayusculas(p: string) {
  return p === p.toUpperCase() && p !== p.toLowerCase();
}

/**
 * «LLAVADOR FERNANDEZ Carlos» → apellidos LLAVADOR FERNANDEZ, nombre Carlos.
 * Necesita al menos una palabra en mayúsculas y otra con minúsculas; un texto
 * todo en mayúsculas no dice dónde está el corte.
 */
export function separarApellidosNombre(texto: string): { nombre: string[]; apellidos: string[] } | null {
  const ps = palabrasOriginales(texto);
  // Una letra suelta en mayúscula es la inicial del nombre («LLAVADOR C»), salvo
  // que sea una partícula entre apellidos («GARCIA Y LOPEZ Ana»).
  const deApellido = (p: string, i: number) =>
    esMayusculas(p) && (p.length > 1 || (i > 0 && i < ps.length - 1 && MINUSCULAS.has(clave(p))));
  let i = 0;
  while (i < ps.length && deApellido(ps[i], i)) i += 1;
  if (i === 0 || i === ps.length) return null;
  const resto = ps.slice(i);
  if (!resto.every((p) => !esMayusculas(p) || p.length === 1)) return null;
  return { apellidos: ps.slice(0, i), nombre: resto };
}

type Estructurada = { palabras: string[]; nombre: Set<string> | null };

function estructurar(v: VarianteNombre): Estructurada {
  if (v.nombre != null || v.apellidos != null) {
    const n = palabrasOriginales(v.nombre ?? '');
    const a = palabrasOriginales(v.apellidos ?? '');
    return { palabras: [...n, ...a], nombre: new Set(n.map(clave)) };
  }
  if (v.orden !== 'nombre-apellidos') {
    const s = separarApellidosNombre(v.texto);
    if (s) return { palabras: [...s.nombre, ...s.apellidos], nombre: new Set(s.nombre.map(clave)) };
  }
  const palabras = palabrasOriginales(v.texto);
  if (v.orden === 'nombre-apellidos') {
    // Convención española: los dos últimos apellidos (con sus partículas) y el resto, nombre.
    const corte = corteDosApellidos(palabras);
    return { palabras, nombre: corte > 0 ? new Set(palabras.slice(0, corte).map(clave)) : null };
  }
  return { palabras, nombre: null };
}

/** Índice donde empiezan los apellidos si los dos últimos «de verdad» lo son. */
export function corteDosApellidos(palabras: string[]): number {
  let vistos = 0;
  let i = palabras.length;
  while (i > 0 && vistos < 2) {
    i -= 1;
    if (!PARTICULAS.has(clave(palabras[i]))) vistos += 1;
  }
  while (i > 0 && PARTICULAS.has(clave(palabras[i - 1]))) i -= 1;
  // Hace falta al menos un nombre delante.
  return vistos === 2 && i > 0 ? i : palabras.length >= 2 ? 1 : 0;
}

/**
 * ¿`grande` contiene todas las palabras de `pequeno`? Cada palabra de `pequeno`
 * usa una palabra distinta de `grande`: exacta, o inicial («c» → «carlos»), o
 * truncado de 3+ letras («ferna» → «fernandez»). Las partículas pueden faltar.
 */
export function cubre(grande: readonly string[], pequeno: readonly string[]): boolean {
  const usadas = new Set<number>();
  const orden = [...pequeno].sort((a, b) => b.length - a.length);
  for (const p of orden) {
    let elegido = grande.findIndex((g, i) => !usadas.has(i) && g === p);
    if (elegido < 0 && (p.length === 1 || p.length >= 3)) {
      elegido = grande.findIndex((g, i) => !usadas.has(i) && g.length > p.length && g.startsWith(p));
    }
    if (elegido < 0) {
      if (PARTICULAS.has(p)) continue;
      return false;
    }
    usadas.add(elegido);
  }
  return true;
}

const significativas = (ks: readonly string[]) => ks.filter((k) => !PARTICULAS.has(k));

function capitalizar(p: string): string {
  return p
    .toLowerCase()
    .replace(/^(\p{L})/u, (c) => c.toUpperCase())
    // «d'alessandro» → «D'Alessandro», «o'connor» → «O'Connor».
    .replace(/^(\p{L})['’](\p{L})/u, (_, a: string, b: string) => `${a}'${b.toUpperCase()}`);
}

/** Mayúsculas de nombre propio. La primera palabra siempre con mayúscula. */
export function nombrePropio(palabras: readonly string[], primeraDelTodo = true): string {
  return palabras
    .map((p, i) => (MINUSCULAS.has(clave(p)) && !(i === 0 && primeraDelTodo) ? p.toLowerCase() : capitalizar(p)))
    .join(' ');
}

/** Grafía preferida por palabra: la más frecuente con acentos; si no hay, la más frecuente. */
function grafias(variantes: readonly VarianteNombre[]): Map<string, string> {
  const votos = new Map<string, Map<string, number>>();
  for (const v of variantes) {
    const peso = Math.max(1, v.peso ?? 1);
    const todas = [v.texto, v.nombre ?? '', v.apellidos ?? ''].flatMap(palabrasOriginales);
    for (const p of new Set(todas)) {
      const k = clave(p);
      const m = votos.get(k) ?? new Map<string, number>();
      const forma = p.toLowerCase();
      m.set(forma, (m.get(forma) ?? 0) + peso);
      votos.set(k, m);
    }
  }
  const salida = new Map<string, string>();
  for (const [k, m] of votos) {
    const formas = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const acentuada = formas.find(([f]) => tieneAcentos(f));
    salida.set(k, (acentuada ?? formas[0])[0]);
  }
  return salida;
}

type Candidato = { claves: string[]; estructura: Estructurada; peso: number; fuente: string };

/**
 * Elige el nombre completo. `actual` es el `display_name` de la persona
 * canónica; `variantes`, todo lo publicado para su grupo de fusión.
 */
export function completarNombre(actual: string, variantes: readonly VarianteNombre[]): NombreCompleto | null {
  const base = palabrasOriginales(actual).map(clave);
  if (base.length === 0) return null;

  const candidatos = new Map<string, Candidato>();
  const todas: VarianteNombre[] = [{ texto: actual, fuente: 'actual', peso: 1 }, ...variantes];
  for (const v of todas) {
    if (v.soloAcentos) continue;
    const e = estructurar(v);
    const claves = e.palabras.map(clave);
    if (claves.length === 0 || claves.length > MAX_PALABRAS) continue;
    if (!claves.every((k) => /^\p{L}[\p{L}']*$/u.test(k))) continue;
    if (!cubre(claves, base)) continue;
    const id = [...claves].sort().join(' ');
    const previo = candidatos.get(id);
    const peso = Math.max(1, v.peso ?? 1);
    if (previo) {
      previo.peso += peso;
      if (!previo.estructura.nombre && e.nombre) previo.estructura = e;
    } else {
      candidatos.set(id, { claves, estructura: e, peso, fuente: v.fuente });
    }
  }

  // No dominadas: ninguna otra candidata las contiene con alguna palabra más.
  const lista = [...candidatos.values()];
  const maximas = lista.filter((c) => !lista.some((o) =>
    o !== c && cubre(o.claves, c.claves) && !cubre(c.claves, o.claves)));
  if (maximas.length === 0) return null;

  // Se agrupan las máximas por su forma completa: dos truncados distintos del mismo nombre no compiten.
  maximas.sort((a, b) => b.peso - a.peso || b.claves.length - a.claves.length);
  let elegida = maximas[0];
  let motivo: NombreCompleto['motivo'] = 'extendido';
  if (maximas.length > 1) {
    const segunda = maximas[1];
    if (elegida.peso < 2 * segunda.peso) {
      // Conflicto: se queda la mayor candidata que cubren TODAS las máximas.
      const comunes = lista.filter((c) => maximas.every((m) => cubre(m.claves, c.claves)));
      comunes.sort((a, b) => significativas(b.claves).length - significativas(a.claves).length || b.peso - a.peso);
      elegida = comunes[0] ?? candidatos.get([...base].sort().join(' ')) ?? elegida;
      motivo = 'conflicto';
    }
  }

  // También cuenta completar una inicial o un truncado («LLAVADOR C» → «Carlos Llavador»).
  const extendido = !cubre(base, elegida.claves);
  if (motivo !== 'conflicto') motivo = extendido ? 'extendido' : 'igual';

  // Corte nombre/apellidos: votos de las variantes estructuradas compatibles.
  const votosNombre = new Map<string, number>();
  const votosApellido = new Map<string, number>();
  for (const v of todas) {
    if (v.soloAcentos) continue;
    const e = estructurar(v);
    if (!e.nombre) continue;
    const claves = e.palabras.map(clave);
    if (!cubre(elegida.claves, claves)) continue;
    const peso = Math.max(1, v.peso ?? 1);
    for (const k of claves) {
      const destino = e.nombre.has(k) ? votosNombre : votosApellido;
      destino.set(k, (destino.get(k) ?? 0) + peso);
    }
  }
  // Una palabra cuenta por prefijo si la variante estaba truncada («carl» → «carlos»).
  const voto = (m: Map<string, number>, k: string) =>
    [...m.entries()].reduce((s, [p, n]) => s + (p === k || (p.length >= 3 && k.startsWith(p)) || (p.length === 1 && k.startsWith(p)) ? n : 0), 0);

  const palabras = elegida.estructura.palabras;
  const claves = palabras.map(clave);
  let esNombre: boolean[] = claves.map((k) => voto(votosNombre, k) > voto(votosApellido, k));
  const decididas = claves.map((k) => voto(votosNombre, k) + voto(votosApellido, k) > 0);
  // Palabras sin voto (p. ej. un segundo apellido que sólo publica una fuente sin corte):
  // heredan de su vecina decidida más cercana dentro del orden de la variante.
  for (let i = 0; i < claves.length; i += 1) {
    if (decididas[i]) continue;
    const izq = [...Array(i).keys()].reverse().find((j) => decididas[j]);
    const der = [...Array(claves.length - i - 1).keys()].map((j) => j + i + 1).find((j) => decididas[j]);
    const ref = izq ?? der;
    esNombre[i] = ref === undefined ? (elegida.estructura.nombre?.has(claves[i]) ?? false) : esNombre[ref];
  }
  // Las partículas siguen a la palabra que tienen detrás («de la Cal» es apellido).
  for (let i = claves.length - 2; i >= 0; i -= 1) {
    if (PARTICULAS.has(claves[i])) esNombre[i] = esNombre[i + 1];
  }
  if (!esNombre.some(Boolean) || esNombre.every(Boolean)) {
    if (!elegida.estructura.nombre) {
      return {
        completo: nombrePropio(aplicarGrafias(palabras, grafias(todas))),
        nombre: '', apellidos: '', extendido, conAcentos: false, fuente: elegida.fuente, motivo: 'sin_estructura',
      };
    }
    esNombre = claves.map((k) => elegida.estructura.nombre!.has(k));
  }

  const formas = grafias(todas);
  const nombreP = aplicarGrafias(palabras.filter((_, i) => esNombre[i]), formas);
  const apellidosP = aplicarGrafias(palabras.filter((_, i) => !esNombre[i]), formas);
  const conAcentos = [...nombreP, ...apellidosP].some(tieneAcentos);
  const nombre = nombrePropio(nombreP);
  const apellidos = nombrePropio(apellidosP, nombreP.length === 0);
  return {
    completo: `${nombre} ${apellidos}`.trim(),
    nombre,
    apellidos,
    extendido,
    conAcentos,
    fuente: elegida.fuente,
    motivo,
  };
}

function aplicarGrafias(palabras: readonly string[], formas: Map<string, string>): string[] {
  return palabras.map((p) => formas.get(clave(p)) ?? p.toLowerCase());
}
