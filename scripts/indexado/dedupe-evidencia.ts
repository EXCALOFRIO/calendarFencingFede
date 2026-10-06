/**
 * Fusiones por nombre que el nombre solo no basta para decidir («RAMIREZ LARENA» frente a
 * «RAMIREZ LARENA Alejandro»; «FONT Marc» de la FIE frente a «FONT DIMAS Marc») y que se
 * deciden con lo que cuentan los puestos de cada persona:
 *
 *  - Club: el mismo código normalizado («ATENEO-M», «ATENEO-», «ATENEO-M (ESP)» → «ATENEO»)
 *    en temporadas a un año o menos.
 *  - Arma: al menos una en común.
 *  - Carrera: las temporadas de la persona corta caen dentro de las de la larga (±1).
 *  - Edad: el año de nacimiento que permiten las categorías (M15 en 2019 → nacido en 2003
 *    o después; VET → 40 años o más) y las fechas conocidas no se contradicen.
 *  - Nunca en la misma prueba ni ronda, mismo género, fechas de nacimiento compatibles.
 *
 * Candidatas de una persona creada por un nombre publicado (o FIE sin licencia, con un
 * apellido): todas las personas cuyo nombre contiene el suyo. Se funde sólo si UNA candidata
 * tiene apoyo (club, arma y carrera; o, para la FIE, arma, carrera y edad o club) sin
 * contradicciones y todas las demás quedan descartadas por una contradicción de identidad
 * (género, edad, fechas; coincidir en una prueba no basta, el recorte puede juntar a dos
 * hermanos) o por otro club conocido en esas temporadas. Dos hermanos del mismo club y arma («FLOREZ DE VARGAS»)
 * quedan como estaban; a una FIE tampoco se le funde nada si hay un hermano de la candidata
 * (mismos apellidos, otro nombre de pila) del mismo género, arma y temporadas. Reversible (`merged_into_person_id`), con candidato
 * `fusion_evidencia` CONFIRMADO.
 */
import type { DatabaseSync } from 'node:sqlite';
import { ahora, palabrasNombre, uuid } from './comun';
import { fechasChocan, partirNombreFie, PARTICULAS, pilaCompatible, significativasDe } from './dedupe-nacimientos';
import { coincidencia } from './vincular-asaltos';
import { anotarBloqueo, motivoNoUnir, nuevoInformeOrden, type InformeOrden } from './nombres-union';

/** Como en `vincular-asaltos.ts`: el alias `efc_licencia` (persona de licencia EFC) no es «sólo nombre». */
const FUENTES_NOMBRE = ['rfee_pdf', 'engarde', 'efc'];
/** Códigos que no son un club: federación, extranjeros, independientes. */
const NO_CLUB = new Set(['FED', 'FEDEXT', 'EXT', 'IND', 'INDEP', 'INDEPENDIENTE', 'LIBRE', 'SINCLUB', 'ESP', 'RFEE']);

/**
 * Código de club comparable «CLUB-PROVINCIA», sin país entre paréntesis, acentos, espacios
 * ni el número de sección («ATENEO-M1», «ATENEO-M (ESP)» → «ATENEO-M»). La provincia puede
 * faltar porque el PDF la corta («ATENEO-» → «ATENEO»).
 */
export function normalizarClub(club: string | null | undefined): string | null {
  if (!club) return null;
  const s = club.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\([^)]*\)/g, ' ').trim();
  const guion = s.indexOf('-');
  const limpio = (x: string) => x.replace(/[^A-Z0-9]/g, '').replace(/\d+$/, '');
  const base = limpio(guion > 0 ? s.slice(0, guion) : s);
  const provincia = guion > 0 ? limpio(s.slice(guion + 1)) : '';
  if (base.length < 2 || NO_CLUB.has(base) || NO_CLUB.has(`${base}${provincia}`)) return null;
  return provincia ? `${base}-${provincia}` : base;
}

/**
 * El mismo club: misma base y misma provincia si las dos la tienen. Una base recortada
 * (4+ letras, «ATEN») vale por la entera sólo sin provincia, que es como la corta el PDF.
 */
export function mismoClub(a: string, b: string): boolean {
  if (a === b) return true;
  const [ba, pa = ''] = a.split('-');
  const [bb, pb = ''] = b.split('-');
  if (pa && pb && pa !== pb) return false;
  if (ba === bb) return true;
  const [c, l, pc] = ba.length <= bb.length ? [ba, bb, pa] : [bb, ba, pb];
  return !pc && c.length >= 4 && l.startsWith(c);
}

/** Año en que acaba una temporada («2018-2019» → 2019, «2020» → 2020). */
export function anioTemporada(temporada: string): number | null {
  const m = /(\d{4})\D*$/.exec(temporada);
  return m ? Number(m[1]) : null;
}

/** Años de nacimiento posibles por tirar una categoría en una temporada (con un año de margen). */
export function nacimientoPorCategoria(categoria: string, anio: number): [number, number] {
  const m = /^M(\d+)$/.exec(categoria);
  if (m) return [anio - Number(m[1]) - 1, Number.POSITIVE_INFINITY];
  if (categoria === 'VET') return [Number.NEGATIVE_INFINITY, anio - 39];
  return [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
}

export type PerfilEvidencia = {
  id: string;
  nombre: string;
  genero: string | null;
  fie: boolean; licencia: boolean; atleta: boolean;
  soloNombre: boolean;
  /** Club normalizado → años de temporada en que lo publicó. */
  clubes: Map<string, Set<number>>;
  armas: Set<string>;
  anios: Set<number>;
  nacimiento: [number, number];
  fechas: Set<string>;
  compsPuesto: Set<string>;
  rondas: Set<string>;
  /** Puestos individuales uno a uno: una persona por nombre recortado puede juntar a dos tiradores. */
  puestos?: PuestoPerfil[];
};
export type PuestoPerfil = { comp: string; genero: string | null; nacimiento: [number, number] };

/** Año de nacimiento posible combinando categorías y fechas conocidas; null si se contradicen. */
function rangoNacimiento(p: PerfilEvidencia): [number, number] | null {
  let [lo, hi] = p.nacimiento;
  for (const f of p.fechas) {
    const y = Number(f.slice(0, 4));
    lo = Math.max(lo, y - 1);
    hi = Math.min(hi, y + 1);
  }
  return lo <= hi ? [lo, hi] : null;
}

const cortan = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) => {
  const [p, g] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of p) if (g.has(x)) return true;
  return false;
};

/** Lo que impide que `x` sea `y`, o null. */
export function contradiccion(x: PerfilEvidencia, y: PerfilEvidencia): string | null {
  if (x.genero && y.genero && x.genero !== y.genero) return 'genero';
  if (cortan(x.compsPuesto, y.compsPuesto) || cortan(x.rondas, y.rondas)) return 'coinciden';
  if (fechasChocan(x.fechas, y.fechas)) return 'fecha_nacimiento';
  const rx = rangoNacimiento(x);
  const ry = rangoNacimiento(y);
  if (rx && ry && (rx[0] > ry[1] || ry[0] > rx[1])) return 'edad';
  if (x.fie && y.fie) return 'dos_fie';
  if (x.atleta && y.atleta) return 'dos_fichas';
  return null;
}

/** El mismo club en temporadas a un año o menos. */
export function clubEnComun(x: PerfilEvidencia, y: PerfilEvidencia): string | null {
  for (const [cx, ax] of x.clubes) {
    for (const [cy, ay] of y.clubes) {
      if (!mismoClub(cx, cy)) continue;
      for (const a of ax) if (ay.has(a) || ay.has(a - 1) || ay.has(a + 1)) return cx;
    }
  }
  return null;
}

/** `y` publicó otro club en las temporadas de `x` (±1) y ninguno es el de `x`. */
export function otroClub(x: PerfilEvidencia, y: PerfilEvidencia): boolean {
  if (x.clubes.size === 0) return false;
  const anios = new Set([...x.clubes.values()].flatMap((s) => [...s].flatMap((a) => [a - 1, a, a + 1])));
  let conocido = false;
  for (const ay of y.clubes.values()) for (const a of ay) if (anios.has(a)) conocido = true;
  return conocido && clubEnComun(x, y) === null;
}

/** Temporadas de `x` dentro de la carrera de `y` (±1). */
export function dentroDeCarrera(x: PerfilEvidencia, y: PerfilEvidencia): boolean {
  if (x.anios.size === 0 || y.anios.size === 0) return false;
  const lo = Math.min(...y.anios) - 1;
  const hi = Math.max(...y.anios) + 1;
  return [...x.anios].every((a) => a >= lo && a <= hi);
}

export type Apoyo = { club: string | null; arma: boolean; carrera: boolean; edad: boolean };

export function apoyo(x: PerfilEvidencia, y: PerfilEvidencia): Apoyo {
  const rx = rangoNacimiento(x);
  const ry = rangoNacimiento(y);
  // Edad informativa: las dos personas acotan el año y los rangos se cruzan.
  const acotado = (r: [number, number] | null) => !!r && Number.isFinite(r[0]) && Number.isFinite(r[1]);
  const edad = acotado(rx) && !!ry && (Number.isFinite(ry[0]) || Number.isFinite(ry[1])) && rx![0] <= ry[1] && ry[0] <= rx![1];
  return { club: clubEnComun(x, y), arma: cortan(x.armas, y.armas), carrera: dentroDeCarrera(x, y), edad };
}

/**
 * Alguno de los hechos de `x` podría ser de `z`. Una persona por nombre recortado puede juntar
 * puestos de dos hermanos («MARCOS PERAL»: los de M15 de uno, el absoluto del otro), así que
 * una contradicción del conjunto (coincidir en una prueba, la edad de todas sus categorías) no
 * descarta a `z`: hace falta que ningún puesto suyo pueda serlo. Dos IDs FIE, dos fichas o
 * fechas de nacimiento distintas sí la descartan.
 */
export function podriaSerDeOtra(x: PerfilEvidencia, z: PerfilEvidencia, contra: string | null = contradiccion(x, z)): boolean {
  if (contra === 'dos_fie' || contra === 'dos_fichas' || contra === 'fecha_nacimiento') return false;
  if (!x.puestos || x.puestos.length === 0) return !contra || contra === 'coinciden';
  const rz = rangoNacimiento(z) ?? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  return x.puestos.some((p) => (!p.genero || !z.genero || p.genero === z.genero) && !z.compsPuesto.has(p.comp)
    && p.nacimiento[0] <= rz[1] && rz[0] <= p.nacimiento[1]);
}

export type Decision =
  | { tipo: 'fundir'; destino: PerfilEvidencia; evidencia: string }
  | { tipo: 'rechazar'; motivo: string };

/**
 * Decide entre las candidatas de `x` (todas las personas cuyo nombre contiene el suyo).
 * `truncadoDe(z, y)`: z es a su vez un recorte de y (la misma cadena de nombres, no compite).
 */
export function decidir(
  x: PerfilEvidencia,
  candidatas: readonly PerfilEvidencia[],
  modo: 'recortado' | 'fie',
  truncadoDe: (z: PerfilEvidencia, y: PerfilEvidencia) => boolean = () => false,
): Decision {
  if (candidatas.length === 0) return { tipo: 'rechazar', motivo: 'sin_candidatas' };
  const evaluadas = candidatas.map((y) => ({ y, contra: contradiccion(x, y), a: apoyo(x, y) }));
  const conApoyo = evaluadas.filter(({ contra, a }) => !contra && a.arma && a.carrera
    && (modo === 'recortado' ? !!a.club : !!a.club || a.edad));
  if (conApoyo.length === 0) {
    const motivos = new Set(evaluadas.map((e) => e.contra ?? (modo === 'recortado' && x.clubes.size === 0 ? 'sin_club' : 'sin_apoyo')));
    return { tipo: 'rechazar', motivo: motivos.size === 1 ? [...motivos][0] : 'sin_apoyo' };
  }
  if (conApoyo.length > 1) {
    const [y] = conApoyo;
    if (!conApoyo.every((e) => e.y === y.y || (truncadoDe(e.y, y.y) && e.y.soloNombre))) return { tipo: 'rechazar', motivo: 'varias_con_apoyo' };
  }
  const elegida = conApoyo[0];
  const competidora = evaluadas.find((e) => e.y !== elegida.y && podriaSerDeOtra(x, e.y, e.contra)
    && !(truncadoDe(e.y, elegida.y) && e.y.soloNombre)
    && !(modo === 'recortado' && otroClub(x, e.y)));
  if (competidora) return { tipo: 'rechazar', motivo: 'otra_candidata_posible' };
  const { a } = elegida;
  const partes = [a.club ? `club:${a.club}` : null, 'arma', 'carrera', a.edad ? 'edad' : null].filter(Boolean);
  return { tipo: 'fundir', destino: elegida.y, evidencia: `${modo}:${partes.join('+')}` };
}

// ------------------------------------------------------------------ base

type InformeModo = { candidatos: number; fusiones: number; rechazos: Record<string, number>; ejemplosRechazo: Record<string, string[]> };
export type InformeEvidencia = {
  recortado: InformeModo;
  fie: InformeModo;
  /** Todas las fusiones hechas, para revisarlas: «evidencia: origen → destino». */
  ejemplos: string[];
  /** Candidatas descartadas por el orden de los apellidos, hermanos o primos (`nombres-union.ts`). */
  orden: InformeOrden;
};

type Grupo = {
  id: string; nombre: string; genero: string | null; pais: string | null;
  miembros: string[]; variantes: string[][]; publicados: string[]; nombresFie: string[];
  /** Nombres publicados (con su fuente) de la raíz y de las fundidas con ID, licencia o ficha. */
  identidad: { nombre: string; fuente: string | null }[];
  fie: boolean; licencia: boolean; atleta: boolean; soloNombre: boolean;
};

/** `grande` sin las palabras de `pequeno` (con repetición), o null si no las tiene todas. */
function quitar(grande: readonly string[], pequeno: readonly string[]): string[] | null {
  const libres = [...grande];
  for (const w of pequeno) {
    const i = libres.indexOf(w);
    if (i < 0) return null;
    libres.splice(i, 1);
  }
  return libres;
}

/** `corto` casa con `largo` con menos información (menos palabras o la misma truncada). */
function contenido(corto: readonly string[], largo: readonly string[]): boolean {
  const c = coincidencia(corto, largo);
  if (!c || c.nivel === 'exacto') return false;
  return corto.length < largo.length || (corto.length === largo.length && corto.join('').length < largo.join('').length);
}

export function fundirPorEvidencia(db: DatabaseSync, nacimientos?: ReadonlyMap<string, readonly string[]>): InformeEvidencia {
  const inf: InformeEvidencia = {
    recortado: { candidatos: 0, fusiones: 0, rechazos: {}, ejemplosRechazo: {} },
    fie: { candidatos: 0, fusiones: 0, rechazos: {}, ejemplosRechazo: {} },
    ejemplos: [],
    orden: nuevoInformeOrden(),
  };
  const destino = new Map<string, string | null>();
  const filas = db.prepare(
    `SELECT id, merged_into_person_id m, display_name n, name_normalized nn, gender g, country_code pais, athlete_id atleta FROM sport_person`,
  ).all() as { id: string; m: string | null; n: string; nn: string | null; g: string | null; pais: string | null; atleta: string | null }[];
  for (const f of filas) destino.set(f.id, f.m);
  const raiz = (id: string) => {
    let a = id;
    for (let i = 0; i < 5; i += 1) {
      const m = destino.get(a);
      if (!m) break;
      a = m;
    }
    return a;
  };
  const grupos = new Map<string, Grupo>();
  const de = (id: string) => grupos.get(raiz(id));
  for (const f of filas) {
    const r = raiz(f.id);
    let g = grupos.get(r);
    if (!g) {
      grupos.set(r, (g = {
        id: r, nombre: '', genero: null, pais: null, miembros: [], variantes: [], publicados: [], nombresFie: [], identidad: [],
        fie: false, licencia: false, atleta: false, soloNombre: true,
      }));
    }
    g.miembros.push(f.id);
    if (f.id === r) Object.assign(g, { nombre: f.n, genero: f.g, pais: f.pais });
    if (f.nn && !g.variantes.some((v) => v.join(' ') === f.nn)) g.variantes.push(f.nn.split(' '));
    if (!g.publicados.includes(f.n)) g.publicados.push(f.n);
    if (f.atleta) Object.assign(g, { atleta: true, soloNombre: false });
  }
  const nombresDe = new Map<string, { nombre: string; fuente: string | null }[]>();
  const conIdentidad = new Set<string>();
  for (const f of filas) {
    if (f.n) nombresDe.set(f.id, [{ nombre: f.n, fuente: null }]);
    if (f.atleta) conIdentidad.add(f.id);
  }
  for (const a of db.prepare('SELECT person_id p, source s, name_original n, name_normalized nn FROM sport_person_alias').iterate() as Iterable<{
    p: string; s: string; n: string; nn: string | null;
  }>) {
    const g = de(a.p);
    if (!g) continue;
    if (a.nn && !g.variantes.some((v) => v.join(' ') === a.nn)) g.variantes.push(a.nn.split(' '));
    if (a.s === 'fie') { if (!g.nombresFie.includes(a.n)) g.nombresFie.push(a.n); } else if (!g.publicados.includes(a.n)) g.publicados.push(a.n);
    if (!FUENTES_NOMBRE.includes(a.s)) {
      g.soloNombre = false;
      conIdentidad.add(a.p);
    }
    if (a.n) (nombresDe.get(a.p) ?? nombresDe.set(a.p, []).get(a.p)!).push({ nombre: a.n, fuente: a.s });
  }
  for (const x of db.prepare(`SELECT person_id p, scheme s FROM sport_external_id WHERE person_id IS NOT NULL AND link_status = 'CONFIRMADO'`).iterate() as Iterable<{
    p: string; s: string;
  }>) {
    const g = de(x.p);
    if (!g) continue;
    g.soloNombre = false;
    conIdentidad.add(x.p);
    if (x.s === 'fie_addr_id') g.fie = true;
    if (x.s === 'rfee_license') g.licencia = true;
  }
  // Sólo los nombres que identifican: si una fundida por nombre fue un error, no abre la puerta a otras.
  for (const g of grupos.values()) {
    g.identidad = g.miembros.filter((m) => m === g.id || conIdentidad.has(m)).flatMap((m) => nombresDe.get(m) ?? []);
  }
  const espanola = (g: Grupo) => !g.pais || g.pais === 'ESP';

  // Perfiles bajo demanda: sólo de las personas que entran en alguna comparación.
  const qPuestos = db.prepare(
    `SELECT r.competition_id comp, r.source_club club, c.season t, c.weapon arma, c.gender g, c.category cat, c.format formato
       FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id WHERE r.person_id = ?`,
  );
  const qLadosA = db.prepare(`SELECT competition_id || '|' || phase || '|' || round_key k FROM sport_bout WHERE fencer_a_person_id = ?`);
  const qLadosB = db.prepare(`SELECT competition_id || '|' || phase || '|' || round_key k FROM sport_bout WHERE fencer_b_person_id = ?`);
  const perfiles = new Map<string, PerfilEvidencia>();
  const perfil = (g: Grupo): PerfilEvidencia => {
    let p = perfiles.get(g.id);
    if (p) return p;
    p = {
      id: g.id, nombre: g.nombre, genero: g.genero, fie: g.fie, licencia: g.licencia, atleta: g.atleta, soloNombre: g.soloNombre,
      clubes: new Map(), armas: new Set(), anios: new Set(), nacimiento: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
      fechas: new Set(), compsPuesto: new Set(), rondas: new Set(), puestos: [],
    };
    const generos = new Set<string>();
    for (const id of g.miembros) {
      for (const f of nacimientos?.get(id) ?? []) p.fechas.add(f);
      for (const r of qPuestos.all(id) as { comp: string; club: string | null; t: string; arma: string; g: string; cat: string; formato: string }[]) {
        p.compsPuesto.add(r.comp);
        const anio = anioTemporada(r.t);
        if (r.formato !== 'INDIVIDUAL') continue;
        p.armas.add(r.arma);
        if (r.g === 'M' || r.g === 'F') generos.add(r.g);
        p.puestos!.push({
          comp: r.comp, genero: r.g === 'M' || r.g === 'F' ? r.g : null,
          nacimiento: anio === null ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] : nacimientoPorCategoria(r.cat, anio),
        });
        if (anio === null) continue;
        p.anios.add(anio);
        const [lo, hi] = nacimientoPorCategoria(r.cat, anio);
        p.nacimiento = [Math.max(p.nacimiento[0], lo), Math.min(p.nacimiento[1], hi)];
        const club = normalizarClub(r.club);
        if (club) (p.clubes.get(club) ?? p.clubes.set(club, new Set()).get(club)!).add(anio);
      }
      for (const q of [qLadosA, qLadosB]) for (const b of q.all(id) as { k: string }[]) p.rondas.add(b.k);
    }
    if (!p.genero && generos.size === 1) p.genero = [...generos][0];
    perfiles.set(g.id, p);
    return p;
  };

  const porPalabra = new Map<string, Set<Grupo>>();
  for (const g of grupos.values()) {
    if (!espanola(g)) continue;
    for (const w of new Set(g.variantes.flat())) if (!PARTICULAS.has(w)) (porPalabra.get(w) ?? porPalabra.set(w, new Set()).get(w)!).add(g);
  }
  const comparten = (ws: readonly string[]) => {
    const cuenta = new Map<Grupo, number>();
    for (const w of new Set(significativasDe(ws))) for (const y of porPalabra.get(w) ?? []) cuenta.set(y, (cuenta.get(y) ?? 0) + 1);
    return [...cuenta].filter(([, n]) => n >= 2).map(([y]) => y);
  };
  const generoCompatible = (a: Grupo, b: Grupo) => !a.genero || !b.genero || a.genero === b.genero;
  const contenidaEn = (l: Grupo, m: Grupo) => l.variantes.some((wl) => m.variantes.some((wm) => contenido(wl, wm)));
  const conHechos = (p: PerfilEvidencia) => p.compsPuesto.size > 0 || p.rondas.size > 0;
  /** El nombre impide unir: apellidos cruzados (salvo mismo club y año de nacimiento), hermanos, primos. */
  const bloquea = (paso: string, x: Grupo, y: Grupo): boolean => {
    const m = motivoNoUnir(x.identidad, y.identidad);
    if (!m) return false;
    if (m.relacion === 'orden_cruzado') {
      const px = perfil(x);
      const py = perfil(y);
      const anios = new Set([...py.fechas].map((f) => f.slice(0, 4)));
      if (apoyo(px, py).club && [...px.fechas].some((f) => anios.has(f.slice(0, 4)))) return false;
    }
    anotarBloqueo(inf.orden, paso, m, `[${x.id.slice(0, 8)} / ${y.id.slice(0, 8)}]`);
    return true;
  };

  const t = ahora();
  const fundir = db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE id = ? AND merged_into_person_id IS NULL`);
  const reapuntar = db.prepare(`UPDATE sport_person SET merged_into_person_id = ?, updated_at = ? WHERE merged_into_person_id = ?`);
  const candidato = db.prepare(
    `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
     VALUES (?, 'fusion_evidencia', ?, ?, ?, 'CONFIRMADO', ?, ?, ?)`,
  );
  const fundidos = new Set<string>();
  const aplicar = (o: Grupo, d: Grupo, evidencia: string, inf2: InformeModo): void => {
    if (Number(fundir.run(d.id, t, o.id).changes) === 0) return;
    reapuntar.run(d.id, t, o.id);
    candidato.run(uuid(), o.id, o.nombre, d.id, evidencia, t, t);
    fundidos.add(o.id);
    inf2.fusiones += 1;
    // El destino gana los hechos del origen: las siguientes decisiones lo ven.
    const po = perfiles.get(o.id);
    const pd = perfiles.get(d.id);
    if (po && pd) {
      for (const [c, as] of po.clubes) for (const a of as) (pd.clubes.get(c) ?? pd.clubes.set(c, new Set()).get(c)!).add(a);
      for (const x of po.armas) pd.armas.add(x);
      for (const x of po.anios) pd.anios.add(x);
      for (const x of po.fechas) pd.fechas.add(x);
      for (const x of po.compsPuesto) pd.compsPuesto.add(x);
      for (const x of po.rondas) pd.rondas.add(x);
      pd.puestos?.push(...(po.puestos ?? []));
      pd.nacimiento = [Math.max(pd.nacimiento[0], po.nacimiento[0]), Math.min(pd.nacimiento[1], po.nacimiento[1])];
    }
    for (const v of o.variantes) if (!d.variantes.some((w) => w.join(' ') === v.join(' '))) d.variantes.push(v);
    for (const n of o.publicados) if (!d.publicados.includes(n)) d.publicados.push(n);
    if (!o.soloNombre) d.identidad.push(...o.identidad);
    if (inf.ejemplos.length < 5000) inf.ejemplos.push(`${evidencia}: ${o.nombre} [${o.id.slice(0, 8)}] → ${d.nombre} [${d.id.slice(0, 8)}]`);
  };
  const rechazar = (m: InformeModo, motivo: string, x: Grupo, cands: readonly PerfilEvidencia[]) => {
    m.rechazos[motivo] = (m.rechazos[motivo] ?? 0) + 1;
    const ej = (m.ejemplosRechazo[motivo] ??= []);
    if (ej.length < 40) ej.push(`${x.nombre} [${x.id.slice(0, 8)}] → ${cands.map((y) => `${y.nombre} [${y.id.slice(0, 8)}]`).join(' | ')}`);
  };
  const ordenados = [...grupos.values()].sort((a, b) => (a.id < b.id ? -1 : 1));

  db.exec('SAVEPOINT evidencia');
  try {
    // 1) Persona creada por un nombre publicado, contenido en el de otras.
    for (const x of ordenados) {
      if (fundidos.has(x.id) || !x.soloNombre || !espanola(x)) continue;
      const largos = new Set<Grupo>();
      for (const ws of x.variantes) {
        for (const y of comparten(ws)) {
          if (y !== x && !fundidos.has(y.id) && espanola(y) && generoCompatible(x, y) && y.variantes.some((wy) => contenido(ws, wy))
            && !largos.has(y) && !bloquea('evidencia_recortado', x, y)) largos.add(y);
        }
      }
      if (largos.size === 0) continue;
      const px = perfil(x);
      if (!conHechos(px)) continue;
      inf.recortado.candidatos += 1;
      const cands = [...largos].map((y) => perfil(y));
      const d = decidir(px, cands, 'recortado', (z, y) => contenidaEn(grupos.get(z.id)!, grupos.get(y.id)!));
      if (d.tipo === 'rechazar') rechazar(inf.recortado, d.motivo, x, cands);
      else aplicar(x, grupos.get(d.destino.id)!, d.evidencia, inf.recortado);
    }

    // 2) FIE sin licencia con un nombre contenido en uno nacional («FONT Marc» → «FONT DIMAS Marc»).
    for (const f of ordenados) {
      if (fundidos.has(f.id) || !f.fie || f.licencia || f.pais !== 'ESP') continue;
      const partidos = f.nombresFie.map(partirNombreFie).filter((p): p is NonNullable<typeof p> => !!p);
      if (partidos.length === 0) continue;
      const nacionales = new Set<Grupo>();
      /** Apellidos nacionales completos de cada candidata, para buscar hermanos. */
      const apellidosDe = new Map<Grupo, string[][]>();
      for (const { apellidos, nombre } of partidos) {
        const base = [...apellidos, ...nombre];
        // Ya tiene su nombre nacional con otro apellido: otra persona así es otra persona.
        if (f.variantes.some((v) => v.length > base.length && contenido(base, v))) continue;
        const [apellido] = significativasDe(apellidos);
        for (const y of comparten(base)) {
          if (y === f || y.fie || fundidos.has(y.id) || !espanola(y) || !generoCompatible(f, y)) continue;
          const casan = y.variantes.filter((wy) => contenido(base, wy));
          if (casan.length === 0) continue;
          // La FIE publica el primer apellido: «LOPEZ Ana» no es «ANA GALLARIN LOPEZ».
          const primero = y.publicados.some((n) => significativasDe(palabrasNombre(n).filter((w) => !nombre.includes(w)))[0] === apellido);
          if (!primero) continue;
          if (!nacionales.has(y) && bloquea('evidencia_fie', y, f)) continue;
          nacionales.add(y);
          const l = apellidosDe.get(y) ?? apellidosDe.set(y, []).get(y)!;
          for (const wy of casan) l.push([...apellidos, ...(quitar(wy, base) ?? [])].filter((w) => !nombre.includes(w)));
        }
      }
      if (nacionales.size === 0) continue;
      const pf = perfil(f);
      if (!conHechos(pf)) continue;
      inf.fie.candidatos += 1;
      // Hermanos: los mismos apellidos nacionales con otro nombre de pila, del mismo género y
      // con el arma y las temporadas de la FIE. Con uno así, la FIE puede ser cualquiera de los dos.
      const nombresPila = partidos.map((p) => p.nombre);
      const hermano = [...apellidosDe].flatMap(([y, ls]) => ls.flatMap((ap) => comparten(ap).filter((z) => z !== y && z !== f
        && !fundidos.has(z.id) && generoCompatible(f, z) && z.variantes.some((wz) => {
          const pila = quitar(wz, ap);
          return pila !== null && significativasDe(pila).length > 0 && !nombresPila.some((n) => pilaCompatible(pila, n));
        }))))
        .find((z) => {
          const pz = perfil(z);
          if (pf.genero && pz.genero && pf.genero !== pz.genero) return false;
          const a = apoyo(pf, pz);
          return a.arma && (a.carrera || dentroDeCarrera(pz, pf));
        });
      if (hermano) {
        rechazar(inf.fie, 'hermanos', f, [...nacionales].map((y) => perfil(y)).concat(perfil(hermano)));
        continue;
      }
      const cands = [...nacionales].map((y) => perfil(y));
      const d = decidir(pf, cands, 'fie', (z, y) => contenidaEn(grupos.get(z.id)!, grupos.get(y.id)!));
      if (d.tipo === 'rechazar') rechazar(inf.fie, d.motivo, f, cands);
      else aplicar(grupos.get(d.destino.id)!, f, d.evidencia, inf.fie);
    }
    db.exec('RELEASE evidencia');
  } catch (e) {
    db.exec('ROLLBACK TO evidencia');
    db.exec('RELEASE evidencia');
    throw e;
  }
  return inf;
}

