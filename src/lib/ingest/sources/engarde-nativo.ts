/**
 * Lector de los ficheros nativos de Engarde (versiones 7-8, texto plano):
 * `competition.egw`, `tireur.txt`, `club.txt`, `nation.txt`, `pouleT<t>P<n>.txt`,
 * `tableau<S><n>.txt`, `claspou_fin_<t>.txt`, `clastab_initial.txt`,
 * `suite_tableaux.txt`. Es lo que la web antigua de la RFEE publicaba como
 * «fichero Engarde» de cada prueba. Sin red ni disco: recibe el texto.
 *
 * Engarde 9 cifra estos ficheros; `esTextoEngarde` lo detecta y esas pruebas
 * no se leen.
 */

export type Valor = string | Valor[] | Registro;
export type Registro = { [clave: string]: Valor };

/** Los ficheros de Engarde se escriben en la página de códigos de Windows. */
export function decodificarEngarde(datos: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(datos);
}

type Token = { t: '{' | '}' | '[' | ']' | '(' | ')' } | { t: 'cad'; v: string } | { t: 'atomo'; v: string };

function tokens(texto: string): Token[] {
  const r: Token[] = [];
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
      i += 1;
    } else if (c === ';' && (i === 0 || texto[i - 1] === '\n')) {
      // Comentario de línea (p. ej. la cabecera de suite_tableaux.txt).
      while (i < n && texto[i] !== '\n') i += 1;
    } else if ('{}[]()'.includes(c)) {
      r.push({ t: c as '{' });
      i += 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && texto[j] !== '"') j += 1;
      r.push({ t: 'cad', v: texto.slice(i + 1, j) });
      i = j + 1;
    } else {
      let j = i;
      while (j < n && !' \n\r\t{}[]()"'.includes(texto[j])) j += 1;
      r.push({ t: 'atomo', v: texto.slice(i, j) });
      i = j;
    }
  }
  return r;
}

class Lector {
  i = 0;
  constructor(private readonly ts: Token[]) {}
  fin(): boolean {
    return this.i >= this.ts.length;
  }
  mira(): Token | undefined {
    return this.ts[this.i];
  }
  valor(): Valor {
    const k = this.ts[this.i++];
    if (!k) return '';
    if (k.t === 'cad' || k.t === 'atomo') return k.v;
    if (k.t === '(') {
      const lista: Valor[] = [];
      while (!this.fin() && this.mira()!.t !== ')') lista.push(this.valor());
      this.i += 1;
      return lista;
    }
    if (k.t === '{') return this.registro();
    // Cierre suelto: se ignora.
    return '';
  }
  /** Tras `{`: secuencia de `[clave valor...]` hasta `}`. */
  registro(): Registro {
    const r: Registro = {};
    while (!this.fin() && this.mira()!.t !== '}') {
      const k = this.ts[this.i++];
      if (k.t !== '[') continue;
      const clave = this.ts[this.i];
      if (!clave || (clave.t !== 'atomo' && clave.t !== 'cad')) continue;
      this.i += 1;
      const vals: Valor[] = [];
      while (!this.fin() && this.mira()!.t !== ']') vals.push(this.valor());
      this.i += 1;
      r[clave.v] = vals.length === 1 ? vals[0] : vals;
    }
    this.i += 1;
    return r;
  }
}

/** Registros `{[clave valor] ...}` de un fichero de tabla (tireur, club, poule, tableau...). */
export function leerRegistros(texto: string): Registro[] {
  const l = new Lector(tokens(texto));
  const r: Registro[] = [];
  while (!l.fin()) {
    const k = l.mira()!;
    if (k.t === '{') {
      l.i += 1;
      r.push(l.registro());
    } else l.i += 1;
  }
  return r;
}

/** Bloque `(def <nombre> clave valor ...)` de `competition.egw`. */
export function leerDefinicion(texto: string, nombre: string): Registro | null {
  const inicio = texto.search(new RegExp(`\\(def\\s+${nombre}\\s`));
  if (inicio < 0) return null;
  const l = new Lector(tokens(texto.slice(inicio)));
  const lista = l.valor();
  if (!Array.isArray(lista) || lista[0] !== 'def') return null;
  const r: Registro = {};
  for (let i = 2; i + 1 < lista.length; i += 2) {
    const k = lista[i];
    if (typeof k === 'string') r[k] = lista[i + 1];
  }
  return r;
}

/** Engarde 9 guarda los ficheros cifrados: sin `classe`/`def` legibles no se intenta leer. */
export function esTextoEngarde(texto: string): boolean {
  return /\[classe \w+\]|\(def \w+|\[numero \d+\]|\[nom [a-z]\d+\]|^[qeaz];\d+;/m.test(texto);
}

const cad = (v: Valor | undefined): string | null => (typeof v === 'string' ? v : null);
const lista = (v: Valor | undefined): Valor[] => (Array.isArray(v) ? v : []);

/** `~16/3/2013` → `2013-03-16`. */
export function fechaEngarde(v: string | null | undefined): string | null {
  const m = v?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || d < 1 || d > 31 || a < 1990 || a > 2030) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export type MetaCompeticion = {
  titulo: string | null;
  campeonato: string | null;
  tituloReducido: string | null;
  titulos: string[];
  arma: 'FLORETE' | 'ESPADA' | 'SABLE' | null;
  sexo: 'M' | 'F' | null;
  /** Literal de Engarde: cadet, junior, senior, minime... */
  categoria: string | null;
  fecha: string | null;
  individual: boolean | null;
  dominio: string | null;
  federacion: string | null;
  /** Tableaux activos de la suite principal, del mayor al menor (`a64`, `a32`...). */
  tableauxActivos: string[];
};

const ARMA: Record<string, MetaCompeticion['arma']> = { fleuret: 'FLORETE', epee: 'ESPADA', sabre: 'SABLE' };

export function leerCompeticion(egw: string): MetaCompeticion | null {
  const d = leerDefinicion(egw, 'ma_competition');
  if (!d) return null;
  const tipo = cad(d.type_compe);
  const sexo = cad(d.sexe);
  return {
    titulo: cad(d.titre_ligne)?.trim() || null,
    campeonato: cad(d.championnat)?.trim() || null,
    tituloReducido: cad(d.titre_reduit)?.trim() || null,
    titulos: ['titre1', 'titre2', 'titre3', 'titre4'].map((k) => cad(d[k])?.trim() ?? '').filter(Boolean),
    arma: ARMA[cad(d.arme) ?? ''] ?? null,
    sexo: sexo === 'masculin' ? 'M' : sexo === 'feminin' ? 'F' : null,
    categoria: cad(d.categorie),
    fecha: fechaEngarde(cad(d.date)),
    individual: tipo === 'individuelle' ? true : tipo === 'par_equipes' ? false : null,
    dominio: cad(d.domaine_compe),
    federacion: cad(d.federation)?.trim() || null,
    tableauxActivos: lista(d.tableauxactifs).filter((x): x is string => typeof x === 'string'),
  };
}

export type Tirador = {
  cle: string;
  apellidos: string;
  nombrePila: string;
  /** `APELLIDOS Nombre`, como publica Engarde. */
  nombre: string;
  sexo: 'M' | 'F' | null;
  presente: boolean;
  /** normal | abandon | exclusion | forfait */
  estado: string;
  club: string | null;
  nacion: string | null;
  licencia: string | null;
  anioNacimiento: number | null;
};

/** Tabla `cle → nom` de club.txt / nation.txt. */
export function leerNombres(texto: string | null | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!texto) return m;
  for (const r of leerRegistros(texto)) {
    const cle = cad(r.cle);
    const nom = cad(r.nom)?.trim();
    if (cle && nom) m.set(cle, nom);
  }
  return m;
}

export function leerTiradores(
  tireur: string,
  clubes: Map<string, string> = new Map(),
  naciones: Map<string, string> = new Map(),
): Map<string, Tirador> {
  const r = new Map<string, Tirador>();
  for (const t of leerRegistros(tireur)) {
    if (cad(t.classe) !== 'tireur') continue;
    const cle = cad(t.cle);
    const apellidos = (cad(t.nom) ?? '').replace(/\s+/g, ' ').trim();
    const nombrePila = (cad(t.prenom) ?? '').replace(/\s+/g, ' ').trim();
    if (!cle || !apellidos) continue;
    const sexe = cad(t.sexe);
    const lic = (cad(t.licence_fie) ?? cad(t.licence) ?? '').trim().toUpperCase();
    const nac = cad(t.date_nais)?.match(/(\d{4})\s*$/)?.[1];
    const anio = nac ? Number(nac) : null;
    r.set(cle, {
      cle,
      apellidos,
      nombrePila,
      nombre: nombrePila ? `${apellidos} ${nombrePila}` : apellidos,
      sexo: sexe === 'masculin' ? 'M' : sexe === 'feminin' ? 'F' : null,
      presente: cad(t.presence) === 'present',
      estado: cad(t.status) ?? 'normal',
      club: clubes.get(cad(t.club1) ?? '') ?? null,
      nacion: naciones.get(cad(t.nation1) ?? '') ?? null,
      // Sólo licencias con forma de licencia (letra-número): `0`, `12` o vacío no identifican a nadie.
      licencia: /^[A-Z]{1,3}-?\d{3,}$/.test(lic) ? lic : null,
      anioNacimiento: anio && anio >= 1920 && anio <= 2025 ? anio : null,
    });
  }
  return r;
}

export type AsaltoNativo = {
  ronda: string;
  a: string;
  b: string;
  tocadosA: number;
  tocadosB: number;
  ganador: 'A' | 'B';
};

export type PouleNativa = { numero: number; tiradores: string[]; asaltos: AsaltoNativo[]; esperados: number; sinResultado: number };

/**
 * Poule: `grille` va en el orden de `les_tir_feuille`; la celda (i, j) es el
 * resultado del tirador i contra el j: `(v 5)`/`(w 4)` victoria con esos
 * tocados, `(d 3)` derrota; `(a ())`, `(xx ())`, `(z ())`, `(f ())` abandono,
 * exclusión o asalto no disputado.
 */
export function leerPoule(texto: string, prefijoRonda: string): PouleNativa | null {
  const r = leerRegistros(texto)[0];
  if (!r) return null;
  const numero = Number(cad(r.numero));
  const orden = lista(r.les_tir_feuille).filter((x): x is string => typeof x === 'string');
  const grilla = lista(r.grille).map(lista);
  if (!Number.isInteger(numero) || orden.length < 2 || grilla.length !== orden.length) return null;
  const celda = (i: number, j: number): { c: string; n: number | null } => {
    const v = lista(grilla[i]?.[j]);
    const c = cad(v[0]) ?? '';
    const n = cad(v[1]);
    return { c, n: n !== null && /^\d{1,2}$/.test(n) ? Number(n) : null };
  };
  const asaltos: AsaltoNativo[] = [];
  let esperados = 0;
  let sinResultado = 0;
  for (let i = 0; i < orden.length; i += 1) {
    for (let j = i + 1; j < orden.length; j += 1) {
      esperados += 1;
      const x = celda(i, j);
      const y = celda(j, i);
      const ganaX = x.c === 'v' || x.c === 'w';
      const ganaY = y.c === 'v' || y.c === 'w';
      if (x.n === null || y.n === null || ganaX === ganaY || (!ganaX && x.c !== 'd') || (!ganaY && y.c !== 'd')) {
        sinResultado += 1;
        continue;
      }
      if ((ganaX && x.n < y.n) || (ganaY && y.n < x.n)) {
        sinResultado += 1;
        continue;
      }
      asaltos.push({ ronda: `${prefijoRonda}${numero}`, a: orden[i], b: orden[j], tocadosA: x.n, tocadosB: y.n, ganador: ganaX ? 'A' : 'B' });
    }
  }
  return { numero, tiradores: orden, asaltos, esperados, sinResultado };
}

export type CruceNativo = {
  a: string | null;
  b: string | null;
  /** Tocados; `null` si el cruce no tiene marcador (exento, abandono, sin disputar). */
  tocadosA: number | null;
  tocadosB: number | null;
  /** abandon | exclusion | forfait de alguno de los dos, si Engarde lo anota. */
  incidencia: string | null;
  ganador: string | null;
  plazaA: number | null;
  plazaB: number | null;
};

export type CuadroNativo = { nombre: string; suite: string; tamano: number; estado: string; cruces: CruceNativo[] };

export function leerCuadro(texto: string): CuadroNativo | null {
  const r = leerRegistros(texto)[0];
  const nombre = cad(r?.nom);
  const m = nombre?.match(/^([a-z])(\d+)$/i);
  if (!r || !nombre || !m) return null;
  const tamano = Number(cad(r.taille) ?? m[2]);
  const ref = (v: Valor | undefined) => {
    const s = cad(v);
    return s && /^\d+$/.test(s) ? s : null;
  };
  const tocados = (v: Valor | undefined) => {
    const s = cad(v);
    return s && /^\d{1,2}$/.test(s) ? Number(s) : null;
  };
  const cruces: CruceNativo[] = [];
  for (const x of lista(r.les_matches)) {
    if (typeof x !== 'object' || Array.isArray(x)) continue;
    const t = lista(x.match);
    if (t.length < 7) continue;
    const incidencia = [t[2], t[3]].map(cad).find((s) => s && /^[a-z]+$/.test(s)) ?? null;
    cruces.push({
      a: ref(t[0]), b: ref(t[1]), tocadosA: tocados(t[2]), tocadosB: tocados(t[3]), incidencia,
      ganador: ref(t[4]), plazaA: Number(cad(t[5])) || null, plazaB: Number(cad(t[6])) || null,
    });
  }
  return { nombre: nombre.toLowerCase(), suite: m[1].toLowerCase(), tamano, estado: cad(r.etat) ?? '', cruces };
}

export type FilaClasificacion = { codigo: string; rango: number; cle: string };

/** `claspou_fin_<t>.txt`, `clastab_initial.txt`: `q;rango;cle;...`. */
export function leerClasificacion(texto: string | null | undefined): FilaClasificacion[] {
  if (!texto) return [];
  const r: FilaClasificacion[] = [];
  for (const l of texto.split(/\r?\n/)) {
    const m = l.match(/^([a-z]);(\d+);(\d+);/);
    if (m) r.push({ codigo: m[1], rango: Number(m[2]), cle: m[3] });
  }
  return r;
}

export type Suite = { nombre: string; nombreExtendido: string };

export function leerSuites(texto: string | null | undefined): Suite[] {
  if (!texto) return [];
  return leerRegistros(texto)
    .filter((r) => cad(r.classe) === 'suite_tableaux')
    .map((r) => ({ nombre: (cad(r.nom) ?? '').toLowerCase(), nombreExtendido: cad(r.nom_etendu) ?? '' }));
}

const TERCER_PUESTO = /tercer|troisi|3e |3\.?º|third/i;

/** Ficheros de una carpeta de competición, por nombre en minúsculas. */
export type FicherosUnidad = Map<string, string>;

export type UnidadEngarde = {
  meta: MetaCompeticion;
  tiradores: Map<string, Tirador>;
  /** Poules por vuelta (1, 2...). */
  poules: { vuelta: number; poule: PouleNativa }[];
  /** Clasificación al final de cada vuelta de poules. */
  clasificacionPoules: Map<number, FilaClasificacion[]>;
  clasificacionInicialCuadro: FilaClasificacion[];
  /** Cuadro principal (suite A) del mayor al menor. */
  cuadro: CuadroNativo[];
  /** Asalto por el tercer puesto (suite B de tamaño 2 con ese nombre), si lo hay. */
  tercerPuesto: CuadroNativo | null;
  /** Suites de cuadro que no son la principal ni el tercer puesto (repesca, clasificación). */
  otrasSuites: string[];
};

export type LecturaUnidad = { ok: true; unidad: UnidadEngarde } | { ok: false; motivo: 'cifrado' | 'sin_competicion' | 'sin_tiradores' };

export function leerUnidad(f: FicherosUnidad): LecturaUnidad {
  const egw = f.get('competition.egw');
  const tireur = f.get('tireur.txt');
  if (!egw || !tireur) return { ok: false, motivo: 'sin_competicion' };
  if (!esTextoEngarde(egw) || !esTextoEngarde(tireur)) return { ok: false, motivo: 'cifrado' };
  const meta = leerCompeticion(egw);
  if (!meta) return { ok: false, motivo: 'sin_competicion' };
  const tiradores = leerTiradores(tireur, leerNombres(f.get('club.txt')), leerNombres(f.get('nation.txt')));
  if (tiradores.size === 0) return { ok: false, motivo: 'sin_tiradores' };

  const poules: UnidadEngarde['poules'] = [];
  const clasificacionPoules = new Map<number, FilaClasificacion[]>();
  const cuadros: CuadroNativo[] = [];
  for (const [nombre, texto] of f) {
    const p = nombre.match(/^poulet(\d+)p(\d+)\.txt$/);
    if (p && esTextoEngarde(texto)) {
      const vuelta = Number(p[1]);
      const poule = leerPoule(texto, vuelta <= 1 ? 'P' : `V${vuelta}P`);
      if (poule) poules.push({ vuelta, poule });
      continue;
    }
    const c = nombre.match(/^claspou_fin_(\d+)\.txt$/);
    if (c) {
      clasificacionPoules.set(Number(c[1]), leerClasificacion(texto));
      continue;
    }
    if (/^tableau[a-z]\d+\.txt$/.test(nombre) && esTextoEngarde(texto)) {
      const t = leerCuadro(texto);
      if (t) cuadros.push(t);
    }
  }
  poules.sort((a, b) => a.vuelta - b.vuelta || a.poule.numero - b.poule.numero);
  if (clasificacionPoules.size === 0 && f.get('clas_fin_poules.txt')) {
    clasificacionPoules.set(1, leerClasificacion(f.get('clas_fin_poules.txt')));
  }
  const suites = leerSuites(f.get('suite_tableaux.txt'));
  const suiteTercer = suites.find((s) => s.nombre !== 'a' && TERCER_PUESTO.test(s.nombreExtendido))?.nombre ?? null;
  const cuadro = cuadros.filter((c) => c.suite === 'a').sort((a, b) => b.tamano - a.tamano);
  const tercerPuesto = cuadros.find((c) => c.suite === suiteTercer && c.tamano === 2) ?? null;
  const otrasSuites = [...new Set(cuadros.filter((c) => c.suite !== 'a' && c.suite !== suiteTercer && c.cruces.some((x) => x.ganador)).map((c) => c.suite))];
  return {
    ok: true,
    unidad: {
      meta, tiradores, poules, clasificacionPoules,
      clasificacionInicialCuadro: leerClasificacion(f.get('clastab_initial.txt')), cuadro, tercerPuesto, otrasSuites,
    },
  };
}

/** Asaltos con marcador del cuadro principal (`T64`...`T2`) y del tercer puesto (`C2`). */
export function asaltosDeCuadro(u: UnidadEngarde): AsaltoNativo[] {
  const r: AsaltoNativo[] = [];
  const anadir = (c: CuadroNativo, ronda: string) => {
    for (const x of c.cruces) {
      if (!x.a || !x.b || x.tocadosA === null || x.tocadosB === null || !x.ganador) continue;
      if (x.ganador !== x.a && x.ganador !== x.b) continue;
      const gA = x.ganador === x.a;
      if ((gA && x.tocadosA < x.tocadosB) || (!gA && x.tocadosB < x.tocadosA)) continue;
      r.push({ ronda, a: x.a, b: x.b, tocadosA: x.tocadosA, tocadosB: x.tocadosB, ganador: gA ? 'A' : 'B' });
    }
  };
  for (const c of u.cuadro) anadir(c, `T${c.tamano}`);
  if (u.tercerPuesto) anadir(u.tercerPuesto, 'C2');
  return r;
}

export type Puesto = { cle: string; posicion: number | null; posicionRaw: string };

export type Clasificacion = {
  /** Eliminados de esta unidad con su puesto, y el campeón si la unidad acaba en la final. */
  puestos: Puesto[];
  /** Tiradores que siguen en competición al acabar la unidad (pasan a la fase siguiente). */
  supervivientes: string[];
  /** La final está decidida y todos los tiradores presentes tienen puesto o motivo. */
  completa: boolean;
  /** Algún cruce del cuadro no está decidido: los puestos de esa ronda no se dan. */
  cuadroIncompleto: boolean;
};

const RAW_INCIDENCIA: Record<string, string> = { a: 'Abandono', z: 'Excluido', abandon: 'Abandono', exclusion: 'Excluido', forfait: 'No presentado' };

/**
 * Puestos de una unidad, con la regla de Engarde/FIE: el campeón y el
 * finalista; los semifinalistas, empatados en el 3 salvo asalto por el
 * tercer puesto; en cada ronda anterior, los derrotados se ordenan por su
 * puesto en la clasificación de entrada al cuadro (empates incluidos); y los
 * eliminados en poules, por su clasificación de poules, vuelta a vuelta.
 * Los excluidos y los abandonos en poules quedan sin puesto.
 */
export function clasificarUnidad(u: UnidadEngarde, opciones: { poulesSonFinal?: boolean } = {}): Clasificacion {
  const semilla = new Map<string, number>();
  for (const f of u.clasificacionInicialCuadro) semilla.set(f.cle, f.rango);
  const plazaCuadro = new Map<string, number>();
  for (const c of u.cuadro) {
    for (const x of c.cruces) {
      if (x.a && x.plazaA) plazaCuadro.set(x.a, Math.min(plazaCuadro.get(x.a) ?? Infinity, x.plazaA));
      if (x.b && x.plazaB) plazaCuadro.set(x.b, Math.min(plazaCuadro.get(x.b) ?? Infinity, x.plazaB));
    }
  }
  const orden = (cle: string) => semilla.get(cle) ?? plazaCuadro.get(cle) ?? 9999;

  type Grupo = { cles: string[]; rango: (c: string) => number; empateTotal?: boolean; raw?: Map<string, string> };
  const grupos: Grupo[] = [];
  let supervivientes: string[] = [];
  let cuadroIncompleto = false;
  let finalDecidida = false;
  const colocados = new Set<string>();

  // Cuadro: rondas decididas, del menor tamaño (final) al mayor.
  const decididas: CuadroNativo[] = [];
  for (const c of u.cuadro) {
    const reales = c.cruces.filter((x) => x.a && x.b);
    const decidida = c.cruces.length > 0 && c.cruces.every((x) => (!x.a && !x.b) || (x.ganador !== null && (x.ganador === x.a || x.ganador === x.b)));
    // Los tableaux mayores que el de entrada existen vacíos: se saltan hasta el primero con cruces.
    if (decididas.length === 0 && reales.length === 0 && !c.cruces.some((x) => x.ganador)) continue;
    if (!decidida || reales.length === 0) {
      if (reales.some((x) => x.ganador)) cuadroIncompleto = true;
      break;
    }
    decididas.push(c);
  }
  const vueltas = [...u.clasificacionPoules.keys()].sort((a, b) => b - a);
  if (decididas.length > 0) {
    const ultima = decididas[decididas.length - 1];
    supervivientes = ultima.cruces.map((x) => x.ganador).filter((x): x is string => !!x);
    if (ultima.tamano === 2 && supervivientes.length === 1) finalDecidida = true;
  } else if (vueltas.length > 0) {
    const q = u.clasificacionPoules.get(vueltas[0])!.filter((f) => f.codigo === 'q');
    if (opciones.poulesSonFinal && !cuadroIncompleto && u.cuadro.every((c) => c.cruces.every((x) => !x.ganador))) {
      // Prueba sólo de poules: la clasificación de la última vuelta es la final.
      const rango = new Map(q.map((f) => [f.cle, f.rango]));
      grupos.push({ cles: q.map((f) => f.cle), rango: (c) => rango.get(c) ?? 9999 });
      finalDecidida = q.length > 0;
    } else {
      // Sin cuadro decidido, los clasificados de la última vuelta siguen en competición.
      supervivientes = q.map((f) => f.cle);
    }
  }
  if (finalDecidida) {
    grupos.push({ cles: supervivientes, rango: () => 0 });
    supervivientes = [];
  }
  for (const c of [...decididas].reverse()) {
    const perdedores = c.cruces
      .filter((x) => x.a && x.b && x.ganador)
      .map((x) => (x.ganador === x.a ? x.b! : x.a!));
    if (c.tamano === 4 && u.tercerPuesto) {
      const t = u.tercerPuesto.cruces.find((x) => x.a && x.b && x.ganador && perdedores.includes(x.a) && perdedores.includes(x.b));
      if (t) {
        const perdedor = t.ganador === t.a ? t.b! : t.a!;
        grupos.push({ cles: [t.ganador!], rango: () => 0 });
        grupos.push({ cles: [perdedor], rango: () => 0 });
        continue;
      }
    }
    grupos.push({ cles: perdedores, rango: orden, empateTotal: c.tamano === 4 });
  }
  for (const g of grupos) for (const c of g.cles) colocados.add(c);
  for (const c of supervivientes) colocados.add(c);

  // Poules: eliminados de cada vuelta, de la última a la primera. Engarde pone a
  // los que abandonan en poules al final, empatados; los excluidos quedan sin puesto.
  const abandonos: string[] = [];
  const excluidos: FilaClasificacion[] = [];
  for (const v of vueltas) {
    const filas = u.clasificacionPoules.get(v)!.filter((f) => f.codigo !== 'q' && !colocados.has(f.cle));
    const elim = filas.filter((f) => f.codigo === 'e');
    const rango = new Map(elim.map((f) => [f.cle, f.rango]));
    if (elim.length) grupos.push({ cles: elim.map((f) => f.cle), rango: (c) => rango.get(c) ?? 9999 });
    for (const f of filas) {
      if (f.codigo === 'a') abandonos.push(f.cle);
      else if (f.codigo !== 'e') excluidos.push(f);
      colocados.add(f.cle);
    }
  }
  if (abandonos.length) grupos.push({ cles: abandonos, rango: () => 0, empateTotal: true });
  if (excluidos.length) {
    grupos.push({ cles: excluidos.map((f) => f.cle), rango: () => 0, raw: new Map(excluidos.map((f) => [f.cle, RAW_INCIDENCIA[f.codigo] ?? f.codigo])) });
  }

  const puestos: Puesto[] = [];
  let encima = supervivientes.length;
  for (const g of grupos) {
    if (g.raw) {
      for (const c of g.cles) puestos.push({ cle: c, posicion: null, posicionRaw: g.raw.get(c)! });
      continue;
    }
    const ordenados = [...g.cles].sort((a, b) => g.rango(a) - g.rango(b) || Number(a) - Number(b));
    for (const c of ordenados) {
      const mejores = g.empateTotal ? 0 : ordenados.filter((o) => g.rango(o) < g.rango(c)).length;
      const posicion = encima + 1 + mejores;
      puestos.push({ cle: c, posicion, posicionRaw: String(posicion) });
    }
    encima += g.cles.length;
  }

  const presentes = [...u.tiradores.values()].filter((t) => t.presente).map((t) => t.cle);
  const completa = finalDecidida && !cuadroIncompleto && presentes.every((c) => colocados.has(c));
  return { puestos, supervivientes, completa, cuadroIncompleto };
}
