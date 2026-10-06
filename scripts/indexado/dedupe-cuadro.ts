/**
 * Continuidad del cuadro dentro de una prueba individual. Cada tirador de una prueba es
 * una cadena: sus puestos de la clasificación, sus asaltos de poule y sus asaltos de la
 * directa, ronda tras ronda. La referencia del asalto (`fencer_*_ref`) ya une los lados
 * del mismo tirador cuando la fuente la repite; aquí se unen además los tramos que la
 * fuente publica con referencias distintas:
 *
 *  - Directa: quien gana un asalto de la ronda N está en la ronda N/2. Un ganador que no
 *    aparece en la ronda siguiente y un tirador nuevo en ella son el mismo si sus nombres
 *    casan y ninguno casa con otro tirador de la ronda contraria («IBAÑEZ MARTIN Ce» en
 *    T16 → «IBAÑEZ MARTIN Celia» en T8).
 *  - Poule → directa: quien entra en la directa sin poule y quien tiró la poule sin
 *    directa, con la misma condición de nombre.
 *  - Clasificación: un tirador con asaltos y sin puesto y un puesto sin asaltos.
 *
 * Una cadena no puede tener dos lados en la misma ronda ni dos puestos: esas uniones no
 * se hacen. Con las cadenas hechas, `planCuadro` devuelve qué lados y puestos vacíos
 * reciben la persona de su cadena y qué cadenas llevan dos personas (manda la que tiene
 * identificador sobre la creada por un nombre y, entre iguales, la del puesto; lo de la
 * otra pasa a ella). Funciones puras: la base la toca `vincular-asaltos.ts`.
 */
import { cabe, prepararNombre } from './dedupe-pruebas';
import { coincidencia, nombresCompatibles } from './vincular-asaltos';

export type AsaltoCuadro = {
  id: string; fase: string; ronda: string;
  ar: string; an: string; ap: string | null; sa: number;
  br: string; bn: string; bp: string | null; sb: number;
};
export type PuestoCuadro = { id: string; nombre: string; raiz: string | null };
/** `conId`: ID FIE, licencia, ficha o alias de una fuente con identificador; `peso`: cuántos hechos tiene. */
export type InfoPersona = { conId: boolean; peso: number };
export type Arista = 'cuadro' | 'poule' | 'clasificacion';

export type CambioLado = { asalto: string; lado: 'a' | 'b'; raiz: string; previa: string | null };
export type CambioPuesto = { id: string; raiz: string };
/** Cadena con dos personas: los lados y puestos de `extra` en la prueba pasan a `principal`. */
export type ConflictoCuadro = { principal: string; extra: string; nodos: number };
export type PlanCuadro = {
  aristas: Record<Arista, number>;
  lados: CambioLado[];
  puestos: CambioPuesto[];
  conflictos: ConflictoCuadro[];
  /** Cadenas con dos personas sin puesto que diga cuál es la buena: no se tocan. */
  sinPrincipal: number;
};

type Nodo = {
  clave: string;
  nombres: string[];
  raiz: string | null;
  rondas: Set<string>;
  puesto: boolean;
  fases: Set<string>;
};

/** Tamaño de una ronda de directa por su clave («T16», «A8», «64»): null si no lo tiene. */
export function rondaDirecta(clave: string): { familia: string; tam: number } | null {
  const m = /^(.*?)(\d+)$/.exec(clave);
  if (!m) return null;
  const tam = Number(m[2]);
  return tam >= 2 && (tam & (tam - 1)) === 0 ? { familia: m[1], tam } : null;
}

/** Dos nombres publicados del mismo tirador: iguales, uno recortado del otro o con una errata. */
export function nombresDeCadena(a: string, b: string): boolean {
  const pa = prepararNombre(a);
  const pb = prepararNombre(b);
  if (pa.palabras.length === 0 || pb.palabras.length === 0) return false;
  if (pa.norm === pb.norm) return true;
  return cabe(pa.palabras, pb.palabras) || cabe(pb.palabras, pa.palabras)
    || coincidencia(pa.palabras, pb.palabras) !== null || nombresCompatibles(pa.palabras, pb.palabras);
}

/**
 * `x` es `y` o un recorte suyo (o con una errata), nunca al revés: «MARCOS PERAL Enri» cabe
 * en «MARCOS PERAL Enrique» pero no en el «MARCOS PERAL» recortado que tenga otra persona.
 */
export function cabeEn(x: string, y: string): boolean {
  const px = prepararNombre(x);
  const py = prepararNombre(y);
  if (px.palabras.length === 0 || py.palabras.length === 0) return false;
  if (px.norm === py.norm || cabe(px.palabras, py.palabras)) return true;
  const masCorto = px.palabras.length < py.palabras.length
    || (px.palabras.length === py.palabras.length && px.palabras.join('').length <= py.palabras.join('').length);
  if (masCorto && coincidencia(px.palabras, py.palabras)) return true;
  return px.palabras.length === py.palabras.length && nombresCompatibles(px.palabras, py.palabras);
}

class Cadenas {
  private readonly padre = new Map<string, string>();
  private readonly datos = new Map<string, Nodo>();

  nodo(clave: string, nombre: string, raiz: string | null, ronda: string | null, fase: string | null, puesto: boolean): void {
    let n = this.datos.get(clave);
    if (!n) {
      this.datos.set(clave, (n = { clave, nombres: [], raiz: null, rondas: new Set(), puesto, fases: new Set() }));
      this.padre.set(clave, clave);
    }
    if (nombre && !n.nombres.includes(nombre)) n.nombres.push(nombre);
    if (raiz) n.raiz ??= raiz;
    if (ronda) n.rondas.add(ronda);
    if (fase) n.fases.add(fase);
  }

  cabeza(clave: string): string {
    let x = clave;
    while (this.padre.get(x) !== x) x = this.padre.get(x)!;
    let y = clave;
    while (this.padre.get(y) !== x) {
      const s = this.padre.get(y)!;
      this.padre.set(y, x);
      y = s;
    }
    return x;
  }

  /** Miembros de cada cadena, por su cabeza. */
  grupos(): Map<string, Nodo[]> {
    const g = new Map<string, Nodo[]>();
    for (const n of this.datos.values()) {
      const c = this.cabeza(n.clave);
      (g.get(c) ?? g.set(c, []).get(c)!).push(n);
    }
    return g;
  }

  unir(a: string, b: string): void {
    const ca = this.cabeza(a);
    const cb = this.cabeza(b);
    if (ca !== cb) this.padre.set(cb, ca);
  }

  claves(): IterableIterator<string> {
    return this.datos.keys();
  }

  get(clave: string): Nodo | undefined {
    return this.datos.get(clave);
  }
}

/** Resumen de una cadena para decidir uniones. */
type Cadena = { cabeza: string; nombres: string[]; rondas: Set<string>; puestos: number; fases: Set<string>; doble: boolean };

function resumir(miembros: readonly Nodo[], variantes: (raiz: string) => readonly string[]): Cadena {
  const nombres = new Set<string>();
  const rondas = new Set<string>();
  const fases = new Set<string>();
  let puestos = 0;
  let doble = false;
  for (const n of miembros) {
    for (const x of n.nombres) nombres.add(x);
    if (n.raiz) for (const v of variantes(n.raiz)) nombres.add(v);
    for (const r of n.rondas) {
      if (rondas.has(r)) doble = true;
      rondas.add(r);
    }
    for (const f of n.fases) fases.add(f);
    if (n.puesto) puestos += 1;
  }
  return { cabeza: '', nombres: [...nombres], rondas, puestos, fases, doble: doble || puestos > 1 };
}

const casan = (a: Cadena, b: Cadena) => a.nombres.some((x) => b.nombres.some((y) => nombresDeCadena(x, y)));
const cortan = (a: ReadonlySet<string>, b: ReadonlySet<string>) => {
  for (const x of a) if (b.has(x)) return true;
  return false;
};

/**
 * Empareja los `sueltos` de un lado con los `nuevos` del otro: cada suelto casa por nombre
 * con un único tirador de `todosB` y ese es nuevo, y ese nuevo casa con un único tirador
 * de `todosA`, que es el suelto, sin homónimos a ningún lado. Devuelve los pares [suelto, nuevo].
 */
function emparejar(sueltos: readonly Cadena[], nuevos: readonly Cadena[], todosA: readonly Cadena[], todosB: readonly Cadena[]): [Cadena, Cadena][] {
  if (sueltos.length === 0 || nuevos.length === 0) return [];
  const esNuevo = new Set(nuevos);
  const pares: [Cadena, Cadena][] = [];
  for (const s of sueltos) {
    const cs = todosB.filter((b) => b !== s && casan(s, b));
    if (cs.length !== 1 || !esNuevo.has(cs[0])) continue;
    const [n] = cs;
    const ds = todosA.filter((a) => a !== n && casan(n, a));
    if (ds.length !== 1 || ds[0] !== s) continue;
    if (cortan(s.rondas, n.rondas) || s.puestos + n.puestos > 1) continue;
    // Un homónimo en el mismo lado que no casa con el otro («ZABALA GUTIERREZ Pedro» junto a
    // «ZABALA GUTIERREZ», frente al puesto «… Juan») dice que el nombre no basta.
    if (todosA.some((t) => t !== s && casan(s, t) && !casan(t, n))) continue;
    if (todosB.some((t) => t !== n && casan(n, t) && !casan(t, s))) continue;
    pares.push([s, n]);
  }
  return pares;
}

/**
 * Plan de una prueba. `raiz` de asaltos y puestos ya resuelta a la persona raíz;
 * `variantes(raiz)`: otros nombres conocidos de esa persona (en el orden publicado o no).
 */
export function planCuadro(
  asaltos: readonly AsaltoCuadro[],
  puestos: readonly PuestoCuadro[],
  variantes: (raiz: string) => readonly string[] = () => [],
  info: (raiz: string) => InfoPersona = () => ({ conId: false, peso: 0 }),
): PlanCuadro {
  const plan: PlanCuadro = { aristas: { cuadro: 0, poule: 0, clasificacion: 0 }, lados: [], puestos: [], conflictos: [], sinPrincipal: 0 };
  if (asaltos.length === 0) return plan;
  const u = new Cadenas();
  for (const b of asaltos) {
    const ronda = `${b.fase}|${b.ronda}`;
    u.nodo(`r:${b.ar}`, b.an, b.ap, ronda, b.fase, false);
    u.nodo(`r:${b.br}`, b.bn, b.bp, ronda, b.fase, false);
  }
  for (const p of puestos) u.nodo(`p:${p.id}`, p.nombre, p.raiz, null, null, true);
  // La misma persona ya vinculada es la misma cadena (salvo si tiene dos puestos).
  const porRaiz = new Map<string, string[]>();
  for (const k of [...u.claves()]) {
    const r = u.get(k)!.raiz;
    if (r) (porRaiz.get(r) ?? porRaiz.set(r, []).get(r)!).push(k);
  }
  for (const ks of porRaiz.values()) {
    if (ks.filter((k) => k.startsWith('p:')).length > 1) continue;
    for (const k of ks.slice(1)) u.unir(ks[0], k);
  }

  const cadenas = () => {
    const out = new Map<string, Cadena>();
    for (const [c, ms] of u.grupos()) out.set(c, { ...resumir(ms, variantes), cabeza: c });
    return out;
  };
  const tocadas = new Set<string>();
  const unir = (a: Cadena, b: Cadena, arista: Arista) => {
    u.unir(a.cabeza, b.cabeza);
    plan.aristas[arista] += 1;
    tocadas.add(a.cabeza);
    tocadas.add(b.cabeza);
  };
  const enRonda = (cs: Map<string, Cadena>, r: string) => [...cs.values()].filter((c) => c.rondas.has(r) && !c.doble);

  // Directa: de la ronda N a la N/2, de la más grande a la final.
  const directa = new Map<string, { familia: string; tam: number }>();
  for (const b of asaltos) {
    if (b.fase !== 'TABLEAU') continue;
    const d = rondaDirecta(b.ronda);
    if (d) directa.set(b.ronda, d);
  }
  const orden = [...directa].sort((x, y) => y[1].tam - x[1].tam);
  for (const [clave, { familia, tam }] of orden) {
    const siguiente = orden.find(([, d]) => d.familia === familia && d.tam === tam / 2)?.[0];
    if (!siguiente) continue;
    const cs = cadenas();
    const r = `TABLEAU|${clave}`;
    const rs = `TABLEAU|${siguiente}`;
    const ganadores = new Set<string>();
    for (const b of asaltos) {
      if (b.fase !== 'TABLEAU' || b.ronda !== clave || b.sa === b.sb) continue;
      ganadores.add(u.cabeza(`r:${b.sa > b.sb ? b.ar : b.br}`));
    }
    const actual = enRonda(cs, r);
    const proxima = enRonda(cs, rs);
    const sueltos = actual.filter((c) => ganadores.has(c.cabeza) && !c.rondas.has(rs));
    const nuevos = proxima.filter((c) => !c.rondas.has(r));
    for (const [s, n] of emparejar(sueltos, nuevos, actual, proxima)) unir(s, n, 'cuadro');
  }

  // Poule → directa.
  {
    const cs = [...cadenas().values()].filter((c) => !c.doble);
    const poule = cs.filter((c) => c.fases.has('POULE'));
    const tabla = cs.filter((c) => c.fases.has('TABLEAU'));
    if (poule.length > 0 && tabla.length > 0) {
      const sueltos = poule.filter((c) => !c.fases.has('TABLEAU'));
      const nuevos = tabla.filter((c) => !c.fases.has('POULE'));
      for (const [s, n] of emparejar(sueltos, nuevos, poule, tabla)) unir(s, n, 'poule');
    }
  }

  // Clasificación: tirador con asaltos sin puesto ↔ puesto sin asaltos.
  {
    const cs = [...cadenas().values()].filter((c) => !c.doble);
    const conAsaltos = cs.filter((c) => c.rondas.size > 0);
    const conPuesto = cs.filter((c) => c.puestos === 1);
    const sueltos = conAsaltos.filter((c) => c.puestos === 0);
    const nuevos = conPuesto.filter((c) => c.rondas.size === 0);
    for (const [s, n] of emparejar(sueltos, nuevos, conAsaltos, conPuesto)) unir(s, n, 'clasificacion');
  }

  if (tocadas.size === 0) return plan;
  const cabezasTocadas = new Set([...tocadas].map((c) => u.cabeza(c)));
  const raizPuesto = new Map(puestos.map((p) => [`p:${p.id}`, p.raiz]));
  for (const [cabeza, ms] of u.grupos()) {
    if (!cabezasTocadas.has(cabeza)) continue;
    if (resumir(ms, () => []).doble) continue;
    const raices = new Set(ms.map((n) => n.raiz).filter((r): r is string => !!r));
    if (raices.size === 0) continue;
    // Sólo puede quedarse la cadena una persona cuyo nombre casa con todos los de la cadena:
    // si la poule dice «MARCOS PERAL Enri», la cadena no es de «MARCOS PERAL Alvaro» aunque el
    // puesto recortado («MARCOS PERAL») se le vinculara.
    // Los nombres de la persona son los suyos conocidos, no los de los lados que ya tiene en la
    // cadena (que pueden ser justo los mal vinculados); sin ninguno, los de sus lados.
    const nombresDe = (r: string) => {
      const v = variantes(r);
      return v.length > 0 ? v : ms.filter((n) => n.raiz === r).flatMap((n) => n.nombres);
    };
    const casaConTodos = (r: string) => {
      const propios = nombresDe(r);
      return ms.every((n) => n.nombres.some((x) => propios.some((y) => cabeEn(x, y))));
    };
    const posibles = [...raices].filter(casaConTodos);
    let principal: string;
    if (raices.size === 1) {
      if (posibles.length === 0) {
        plan.sinPrincipal += 1;
        continue;
      }
      principal = posibles[0];
    } else {
      // Entre las posibles manda la que tiene identificador sobre las creadas por un nombre;
      // entre iguales, la del puesto. Dos con identificador y ninguna con el puesto: no se sabe cuál.
      const delPuestoTodas = ms.find((n) => n.puesto && n.raiz)?.raiz ?? null;
      const delPuesto = delPuestoTodas && posibles.includes(delPuestoTodas) ? delPuestoTodas : null;
      const conIdentificador = posibles.filter((r) => info(r).conId);
      const elegida = conIdentificador.length === 1 ? conIdentificador[0]
        : conIdentificador.length > 1 ? (delPuesto && conIdentificador.includes(delPuesto) ? delPuesto : null)
          : delPuesto ?? (posibles.length > 0 ? [...posibles].sort((x, y) => info(y).peso - info(x).peso)[0] : null);
      if (!elegida) {
        plan.sinPrincipal += 1;
        continue;
      }
      principal = elegida;
      const nodos = new Map<string, number>();
      for (const n of ms) if (n.raiz && n.raiz !== principal) nodos.set(n.raiz, (nodos.get(n.raiz) ?? 0) + 1);
      for (const [extra, n] of nodos) plan.conflictos.push({ principal, extra, nodos: n });
    }
    const refs = new Set(ms.filter((n) => n.clave.startsWith('r:')).map((n) => n.clave.slice(2)));
    for (const n of ms) {
      if (n.puesto && raizPuesto.get(n.clave) !== principal) plan.puestos.push({ id: n.clave.slice(2), raiz: principal });
    }
    for (const b of asaltos) {
      if (refs.has(b.ar) && b.ap !== principal) plan.lados.push({ asalto: b.id, lado: 'a', raiz: principal, previa: b.ap });
      if (refs.has(b.br) && b.bp !== principal) plan.lados.push({ asalto: b.id, lado: 'b', raiz: principal, previa: b.bp });
    }
  }
  return plan;
}
