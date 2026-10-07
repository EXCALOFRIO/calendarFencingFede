/**
 * Personas canónicas cuyo grupo (raíz + fundidas) mezcla géneros, con propuesta de separación.
 * Sin `--aplicar` sólo lee (abre la base en modo lectura); con `--aplicar` escribe en la copia.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/separar-genero.ts --db <copia.sqlite> \
 *     [--aplicar] [--informe <separar-genero-informe.json>] [--casos "NOMBRE,NOMBRE"]
 *
 * Señales de un grupo mezclado: puestos o lados de asalto en pruebas M y F (las MIXTO no cuentan),
 * personas guardadas con los dos géneros, nombres de los dos géneros, o una licencia RFEE publicada
 * para personas de los dos géneros.
 *
 * El género de un nombre sale de la primera palabra de su nombre de pila (las palabras con minúsculas
 * de «APELLIDOS Nombre»; en «Maria Jose» y «Jose Maria» manda la primera), con el género aprendido de
 * los nombres de los grupos de género claro de la propia base (≥ 10 nombres y ≥ 97 %). Un nombre todo
 * en mayúsculas no da género (muchos apellidos son nombres de pila: «ALDANA JULIAN»). Una palabra que
 * puede ser el recorte de otra del otro género («Julia» de «Julian») tampoco.
 *
 * Que alguien tenga filas en pruebas del otro género NO basta para separar: las pruebas de silla de
 * ruedas, de veteranos o regionales se publican como masculinas y son mixtas. Por eso manda el
 * nombre. Propuesta (y lo que hace `--aplicar`):
 *  1) `separar`: una fundida cuyo nombre es del otro género que el del grupo vuelve a ser raíz, salvo
 *     que comparta ID FIE con el grupo (`conflicto_fie`, sólo se lista). Con sólo filas del otro género
 *     y sin nombre que lo confirme queda como `revisar`. Deja un candidato `separacion_genero` RECHAZADO
 *     (origen → raíz anterior); deshacerla es volver a poner `merged_into_person_id`;
 *  2) `corregir_genero`: persona del grupo con el género guardado contrario al de su nombre (y al
 *     del grupo): se le pone el del nombre;
 *  3) `desvincular`: puesto o lado de asalto en una prueba del otro género y cuyo nombre publicado
 *     también lo es (p. ej. «MARIA TERESA …» en el grupo de «Mario»): `person_id = NULL`, para que el paso
 *     por nombre (que separa por género) lo vuelva a resolver.
 * Las licencias de los dos géneros no se tocan (no se sabe de quién es): se listan para que la
 * fusión por licencia no las use. Después, `unificar-personas.ts` y `vincular-asaltos.ts` como siempre.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { ahora, argumento, bandera, CARPETA_TRABAJO, palabrasNombre, prepararCopiaTrabajo, quitarGuardia, restaurarGuardia, uuid } from './comun';

export type Genero = 'M' | 'F';
type Cuenta = { M: number; F: number };
const vacia = (): Cuenta => ({ M: 0, F: 0 });
export const otro = (g: Genero): Genero => (g === 'M' ? 'F' : 'M');

/** Género de una cuenta: el que tiene al menos `cuota` de `minimo` filas o más. */
export function generoClaro(c: Cuenta, cuota = 0.9, minimo = 3): Genero | null {
  const n = c.M + c.F;
  if (n < minimo) return null;
  if (c.M / n >= cuota) return 'M';
  if (c.F / n >= cuota) return 'F';
  return null;
}

/**
 * Nombre de pila: las palabras con minúsculas de «APELLIDOS Nombre» (FIE, PDF). En un nombre todo
 * en mayúsculas no se sabe qué palabra es el nombre (Skermo lo pone delante, el PDF detrás) y
 * muchos apellidos son nombres de pila («ALDANA JULIAN», «ELENA NAVARRO»): no se usa.
 */
export function nombresDePila(nombre: string): string[] {
  const conMinusculas = nombre.trim().split(/\s+/).filter((w) => /\p{Ll}/u.test(w));
  return conMinusculas.length > 0 ? palabrasNombre(conMinusculas.join(' ')) : [];
}

/** Palabras de nombre de pila con género claro, aprendidas de nombres con género conocido. */
export function diccionarioGenero(nombres: Iterable<{ nombre: string; genero: Genero }>, minimo = 10, cuota = 0.97): Map<string, Genero> {
  const cuentas = new Map<string, Cuenta>();
  for (const { nombre, genero } of nombres) {
    // Sólo la primera palabra: «Maria» es de mujer aunque haya muchos «Jose Maria».
    for (const w of nombresDePila(nombre).slice(0, 1)) {
      if (w.length < 3) continue;
      const c = cuentas.get(w) ?? cuentas.set(w, vacia()).get(w)!;
      c[genero] += 1;
    }
  }
  const out = new Map<string, Genero>();
  for (const [w, c] of cuentas) {
    const g = generoClaro(c, cuota, minimo);
    if (g) out.set(w, g);
  }
  return out;
}

/**
 * Género del nombre: todas sus palabras de género claro coinciden (y hay alguna). La última
 * palabra se ignora si es el principio de una palabra del otro género (recorte del PDF).
 */
const recortables = new WeakMap<ReadonlyMap<string, Genero>, Map<string, boolean>>();
function recortable(w: string, g: Genero, dic: ReadonlyMap<string, Genero>): boolean {
  const memo = recortables.get(dic) ?? recortables.set(dic, new Map()).get(dic)!;
  let r = memo.get(w);
  if (r === undefined) {
    r = false;
    for (const [v, gv] of dic) if (gv !== g && v.length > w.length && v.startsWith(w)) { r = true; break; }
    memo.set(w, r);
  }
  return r;
}

export function generoDeNombre(nombre: string, dic: ReadonlyMap<string, Genero>): Genero | null {
  // En un nombre compuesto manda la primera palabra («Maria Jose», «Jose Maria»).
  const ws = nombresDePila(nombre);
  const w = ws[0];
  const g = w ? dic.get(w) : undefined;
  if (!g) return null;
  return ws.length === 1 && recortable(w, g, dic) ? null : g;
}

/** Género de varios nombres de una misma persona: el único que dan, `ambos` o `null`. */
export function generoDeNombres(nombres: readonly string[], dic: ReadonlyMap<string, Genero>): Genero | 'ambos' | null {
  const gs = new Set(nombres.map((n) => generoDeNombre(n, dic)).filter((g): g is Genero => g !== null));
  return gs.size === 0 ? null : gs.size === 1 ? [...gs][0] : 'ambos';
}

export type Accion = 'quedar' | 'separar' | 'conflicto_fie' | 'corregir_genero' | 'revisar' | 'nombres_de_los_dos_generos';

/** Decisión para una fundida (o la raíz, que nunca se separa) frente al género `g` del grupo. */
export function decidirMiembro(
  m: { esRaiz: boolean; genero: string | null; filas: Cuenta; nombre: Genero | 'ambos' | null; fieCompartido: boolean },
  g: Genero,
): Accion {
  const o = otro(g);
  if (m.nombre === 'ambos') return 'nombres_de_los_dos_generos';
  if (m.nombre === o && !m.esRaiz) return m.fieCompartido ? 'conflicto_fie' : 'separar';
  if (m.nombre === g && m.genero === o) return 'corregir_genero';
  // Sólo filas del otro género, sin nombre que lo confirme: suelen ser pruebas mixtas publicadas como M.
  if (m.nombre === null && m.filas.M + m.filas.F >= 3 && m.filas[o] > m.filas[g]) return 'revisar';
  return 'quedar';
}

export type GrupoMezclado = {
  raiz: string;
  nombre: string;
  genero: Genero | null;
  filas: Cuenta;
  motivos: string[];
  miembros: { id: string; nombre: string; genero: string | null; filas: Cuenta; nombres: string[]; generoNombre: string | null; accion: Accion }[];
  filasDesvinculadas: string[];
};

export type InformeGenero = {
  personas: number;
  grupos: number;
  gruposMezclados: number;
  porMotivo: Record<string, number>;
  acciones: Record<string, number>;
  filasDesvinculadas: { puestos: number; asaltosLado: number };
  ejemplosDesvinculadas: string[];
  /** Filas en pruebas del otro género sin indicio de nombre: pruebas mixtas publicadas como M o F. */
  filasOtroGeneroSinIndicio: number;
  /** Nombre del otro género que el grupo, pero en una prueba del género del grupo: se lista, no se toca. */
  filasNombreContrario: number;
  ejemplosNombreContrario: string[];
  palabrasConGenero: number;
  licenciasDosGeneros: { licencia: string; personas: { id: string; raiz: string; nombre: string; genero: string | null; temporadas: string[] }[] }[];
  grupos_: GrupoMezclado[];
  casos: Record<string, GrupoMezclado[]>;
};

export function separarPorGenero(db: DatabaseSync, aplicar: boolean, vigilar: readonly string[] = []): InformeGenero {
  type P = { id: string; n: string; g: string | null; m: string | null };
  const personas = new Map<string, P>();
  for (const p of db.prepare(`SELECT id, display_name n, gender g, merged_into_person_id m FROM sport_person`).all() as P[]) personas.set(p.id, p);
  const raiz = (id: string) => {
    let a = id;
    for (let i = 0; i < 10; i += 1) {
      const m = personas.get(a)?.m;
      if (!m || !personas.has(m)) return a;
      a = m;
    }
    return a;
  };

  type FilaG = { tabla: 'r' | 'a' | 'b'; id: string; genero: Genero; persona: string; nombre: string };
  const generoComp = new Map<string, Genero>();
  for (const c of db.prepare(`SELECT id, gender g FROM sport_competition WHERE gender IN ('M','F')`).all() as { id: string; g: Genero }[]) generoComp.set(c.id, c.g);
  const filas: FilaG[] = [];
  for (const r of db.prepare(`SELECT id, competition_id c, person_id p, source_name n FROM sport_result WHERE person_id IS NOT NULL`).iterate() as
      Iterable<{ id: string; c: string; p: string; n: string }>) {
    const g = generoComp.get(r.c);
    if (g && personas.has(r.p)) filas.push({ tabla: 'r', id: r.id, genero: g, persona: r.p, nombre: r.n ?? '' });
  }
  for (const b of db.prepare(`SELECT id, competition_id c, fencer_a_person_id a, fencer_b_person_id b, fencer_a_name an, fencer_b_name bn FROM sport_bout
      WHERE fencer_a_person_id IS NOT NULL OR fencer_b_person_id IS NOT NULL`).iterate() as
      Iterable<{ id: string; c: string; a: string | null; b: string | null; an: string | null; bn: string | null }>) {
    const g = generoComp.get(b.c);
    if (!g) continue;
    if (b.a && personas.has(b.a)) filas.push({ tabla: 'a', id: b.id, genero: g, persona: b.a, nombre: b.an ?? '' });
    if (b.b && personas.has(b.b)) filas.push({ tabla: 'b', id: b.id, genero: g, persona: b.b, nombre: b.bn ?? '' });
  }
  const porPersona = new Map<string, Cuenta>();
  for (const f of filas) (porPersona.get(f.persona) ?? porPersona.set(f.persona, vacia()).get(f.persona)!)[f.genero] += 1;
  const porRaiz = new Map<string, Cuenta>();
  for (const [p, c] of porPersona) {
    const t = porRaiz.get(raiz(p)) ?? porRaiz.set(raiz(p), vacia()).get(raiz(p))!;
    t.M += c.M;
    t.F += c.F;
  }

  const nombresDe = new Map<string, string[]>();
  for (const p of personas.values()) if (p.n) nombresDe.set(p.id, [p.n]);
  for (const a of db.prepare(`SELECT person_id p, source s, name_original n FROM sport_person_alias`).iterate() as Iterable<{ p: string; s: string; n: string | null }>) {
    if (a.n && personas.has(a.p)) (nombresDe.get(a.p) ?? nombresDe.set(a.p, []).get(a.p)!).push(a.n);
  }
  const grupos = new Map<string, string[]>();
  for (const p of personas.values()) (grupos.get(raiz(p.id)) ?? grupos.set(raiz(p.id), []).get(raiz(p.id))!).push(p.id);
  // Aprendizaje: un nombre por grupo de filas de un solo género (≥ 98 % de ≥ 3).
  const dic = diccionarioGenero((function* () {
    for (const [r, c] of porRaiz) {
      const g = generoClaro(c, 0.98, 3);
      if (!g) continue;
      for (const m of grupos.get(r) ?? [r]) for (const nombre of new Set(nombresDe.get(m) ?? [])) yield { nombre, genero: g };
    }
  })());

  const fie = new Map<string, Set<string>>();
  const licencias = new Map<string, { persona: string; temporada: string }[]>();
  for (const e of db.prepare(`SELECT person_id p, scheme s, value v, scope_season t FROM sport_external_id
      WHERE link_status = 'CONFIRMADO' AND person_id IS NOT NULL AND scheme IN ('fie_addr_id', 'rfee_license')`).iterate() as Iterable<{ p: string; s: string; v: string; t: string }>) {
    const v = e.v.trim().toUpperCase();
    if (e.s === 'fie_addr_id') (fie.get(e.p) ?? fie.set(e.p, new Set()).get(e.p)!).add(v);
    else (licencias.get(v) ?? licencias.set(v, []).get(v)!).push({ persona: e.p, temporada: e.t });
  }

  const generoGuardado = (id: string): Genero | null => {
    const g = personas.get(id)?.g;
    return g === 'M' || g === 'F' ? g : null;
  };
  /** Género del grupo: el del nombre de la raíz (o, si no da, el de todos los del grupo); si no, el de las filas; si no, el guardado. */
  const generoGrupo = (r: string): Genero | null => {
    const n = generoDeNombres(nombresDe.get(r) ?? [], dic) ?? generoDeNombres((grupos.get(r) ?? []).flatMap((m) => nombresDe.get(m) ?? []), dic);
    if (n === 'M' || n === 'F') return n;
    const c = porRaiz.get(r) ?? vacia();
    if (c.M !== c.F) return c.M > c.F ? 'M' : 'F';
    const ms = grupos.get(r) ?? [r];
    return generoGuardado(r) ?? ms.map(generoGuardado).find((g) => g !== null) ?? null;
  };

  const inf: InformeGenero = {
    personas: personas.size, grupos: grupos.size, gruposMezclados: 0, porMotivo: {}, acciones: {},
    filasDesvinculadas: { puestos: 0, asaltosLado: 0 }, ejemplosDesvinculadas: [], filasOtroGeneroSinIndicio: 0, filasNombreContrario: 0, ejemplosNombreContrario: [], palabrasConGenero: dic.size,
    licenciasDosGeneros: [], grupos_: [], casos: {},
  };
  const t = ahora();
  const soltar = db.prepare(`UPDATE sport_person SET merged_into_person_id = NULL, updated_at = ? WHERE id = ? AND merged_into_person_id IS NOT NULL`);
  const ponerGenero = db.prepare(`UPDATE sport_person SET gender = ?, updated_at = ? WHERE id = ?`);
  const anotar = db.prepare(`INSERT INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, decided_at, created_at)
    VALUES (?, 'separacion_genero', ?, ?, ?, 'RECHAZADO', ?, ?, ?)`);
  const porGrupo = new Map<string, GrupoMezclado>();
  const generoFinal = new Map<string, Genero | null>();

  for (const [r, ms] of grupos) {
    const motivos: string[] = [];
    const c = porRaiz.get(r) ?? vacia();
    if (c.M > 0 && c.F > 0) motivos.push('filas_de_los_dos_generos');
    if (new Set(ms.map(generoGuardado).filter((g) => g !== null)).size > 1) motivos.push('personas_de_los_dos_generos');
    const generosNombre = ms.map((id) => generoDeNombres(nombresDe.get(id) ?? [], dic));
    const gn = new Set(generosNombre.flatMap((x) => (x === 'ambos' ? ['M', 'F'] : x ? [x] : [])));
    if (gn.size > 1) motivos.push('nombres_de_los_dos_generos');
    const g = generoGrupo(r);
    generoFinal.set(r, g);
    if (motivos.length === 0 || !g) {
      if (motivos.length) {
        inf.gruposMezclados += 1;
        for (const m of motivos) inf.porMotivo[m] = (inf.porMotivo[m] ?? 0) + 1;
        inf.acciones.sin_genero_de_grupo = (inf.acciones.sin_genero_de_grupo ?? 0) + 1;
      }
      continue;
    }
    inf.gruposMezclados += 1;
    for (const m of motivos) inf.porMotivo[m] = (inf.porMotivo[m] ?? 0) + 1;
    const grupo: GrupoMezclado = { raiz: r, nombre: personas.get(r)!.n, genero: g, filas: c, motivos, miembros: [], filasDesvinculadas: [] };
    const decisiones = ms.map((id, i) => ({ id, nombre: generosNombre[i], filas: porPersona.get(id) ?? vacia() }));
    for (const d of decisiones) {
      const fieResto = new Set(decisiones.filter((x) => x.id !== d.id && x.nombre !== otro(g)).flatMap((x) => [...(fie.get(x.id) ?? [])]));
      const accion = decidirMiembro({ esRaiz: d.id === r, genero: personas.get(d.id)!.g, filas: d.filas, nombre: d.nombre,
        fieCompartido: [...(fie.get(d.id) ?? [])].some((v) => fieResto.has(v)) }, g);
      inf.acciones[accion] = (inf.acciones[accion] ?? 0) + 1;
      grupo.miembros.push({ id: d.id, nombre: personas.get(d.id)!.n, genero: personas.get(d.id)!.g, filas: d.filas,
        nombres: [...new Set(nombresDe.get(d.id) ?? [])], generoNombre: d.nombre, accion });
      if (!aplicar) continue;
      if (accion === 'separar' && Number(soltar.run(t, d.id).changes) > 0) {
        anotar.run(uuid(), d.id, personas.get(d.id)!.n, r, `genero:${otro(g)}≠${g}|nombre:${d.nombre ?? '-'}|filas:${d.filas.M}M/${d.filas.F}F`, t, t);
      }
      if (accion === 'corregir_genero') ponerGenero.run(g, t, d.id);
    }
    for (const m of grupo.miembros) if (m.accion === 'separar') personas.get(m.id)!.m = null;
    porGrupo.set(r, grupo);
    inf.grupos_.push(grupo);
  }

  // Puestos y lados de asalto con un nombre del otro género que su grupo (ya separado).
  const quitar = {
    r: db.prepare(`UPDATE sport_result SET person_id = NULL WHERE id = ?`),
    a: db.prepare(`UPDATE sport_bout SET fencer_a_person_id = NULL WHERE id = ?`),
    b: db.prepare(`UPDATE sport_bout SET fencer_b_person_id = NULL WHERE id = ?`),
  };
  const generoNombreCache = new Map<string, Genero | null>();
  const palabrasGrupo = new Map<string, Set<string>>();
  const palabrasDe = (r: string) => {
    let s = palabrasGrupo.get(r);
    if (!s) {
      s = new Set((grupos.get(r) ?? [r]).filter((m) => raiz(m) === r).flatMap((m) => (nombresDe.get(m) ?? []).flatMap((n) => palabrasNombre(n))));
      palabrasGrupo.set(r, s);
    }
    return s;
  };
  // «Eva» en el grupo de «EVAN …»: el nombre del puesto es un recorte de uno del grupo.
  const recorteDelGrupo = (nombre: string, r: string) => {
    const propias = palabrasDe(r);
    return nombresDePila(nombre).some((w) => [...propias].some((v) => v.length > w.length && v.startsWith(w)));
  };
  for (const f of filas) {
    const r = raiz(f.persona);
    const g = generoFinal.get(r) ?? generoGrupo(r);
    if (!g) continue;
    let gn = generoNombreCache.get(f.nombre);
    if (gn === undefined) generoNombreCache.set(f.nombre, (gn = generoDeNombre(f.nombre, dic)));
    if (gn === otro(g) && f.genero === gn && !recorteDelGrupo(f.nombre, r)) {
      if (f.tabla === 'r') inf.filasDesvinculadas.puestos += 1;
      else inf.filasDesvinculadas.asaltosLado += 1;
      if (inf.ejemplosDesvinculadas.length < 400) inf.ejemplosDesvinculadas.push(`${f.tabla === 'r' ? 'puesto' : 'asalto'} «${f.nombre}» → ${personas.get(r)!.n} (${g})`);
      const grupo = porGrupo.get(r);
      if (grupo && grupo.filasDesvinculadas.length < 20) grupo.filasDesvinculadas.push(`${f.tabla === 'r' ? 'puesto' : 'asalto'} «${f.nombre}»`);
      if (aplicar) quitar[f.tabla].run(f.id);
    } else if (gn === otro(g)) {
      inf.filasNombreContrario += 1;
      if (inf.ejemplosNombreContrario.length < 200) inf.ejemplosNombreContrario.push(`«${f.nombre}» en prueba ${f.genero} → ${personas.get(r)!.n} (${g})`);
    } else if (f.genero !== g && gn === null) inf.filasOtroGeneroSinIndicio += 1;
  }

  for (const [v, l] of licencias) {
    const porRaizLic = new Map<string, { id: string; temporadas: string[] }>();
    for (const x of l) {
      const rr = raiz(x.persona);
      const e = porRaizLic.get(rr) ?? porRaizLic.set(rr, { id: x.persona, temporadas: [] }).get(rr)!;
      e.temporadas.push(x.temporada);
    }
    if (porRaizLic.size < 2) continue;
    const gs = new Set([...porRaizLic.keys()].map((rr) => generoGrupo(rr)).filter((g) => g !== null));
    if (gs.size < 2) continue;
    inf.licenciasDosGeneros.push({ licencia: v, personas: [...porRaizLic].map(([rr, e]) => ({
      id: e.id, raiz: rr, nombre: personas.get(rr)?.n ?? '?', genero: generoGrupo(rr), temporadas: e.temporadas.sort(),
    })) });
  }

  for (const v of vigilar) {
    const n = palabrasNombre(v).sort().join(' ');
    inf.casos[v] = inf.grupos_.filter((gr) => gr.miembros.some((m) => m.nombres.some((x) => palabrasNombre(x).sort().join(' ') === n)));
  }
  return inf;
}

function main(): void {
  const rutaDb = argumento('db', '');
  if (!rutaDb) throw new Error('Uso: --db <copia.sqlite> [--aplicar] [--informe <json>]');
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'separar-genero-informe.json'));
  const aplicar = bandera('aplicar');
  const vigilar = argumento('casos', 'MARIA TERESA DIAZ ESCALONA,DIAZ ESCALONA Mario').split(',').filter(Boolean);
  const db = new DatabaseSync(rutaDb, aplicar ? {} : { readOnly: true });
  let inf: InformeGenero;
  if (!aplicar) inf = separarPorGenero(db, false, vigilar);
  else {
    prepararCopiaTrabajo(db);
    restaurarGuardia(db);
    quitarGuardia(db);
    try {
      db.exec('BEGIN');
      inf = separarPorGenero(db, true, vigilar);
      db.exec('COMMIT');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    } finally {
      restaurarGuardia(db);
    }
  }
  db.close();
  writeFileSync(salida, JSON.stringify(inf, null, 1));
  const { grupos_, casos, licenciasDosGeneros, ...resumen } = inf;
  console.log(JSON.stringify({ ...resumen, licenciasDosGeneros, gruposConAccion: grupos_.filter((g) => g.miembros.some((m) => m.accion !== 'quedar') || g.filasDesvinculadas.length).length,
    casos: Object.fromEntries(Object.entries(casos).map(([k, v]) => [k, v.map((g) => ({ raiz: g.raiz, nombre: g.nombre, genero: g.genero, motivos: g.motivos,
      miembros: g.miembros.map((m) => `${m.accion} ${m.nombre} ${m.genero} ${m.filas.M}M/${m.filas.F}F`), filas: g.filasDesvinculadas }))])) }, null, 2));
  console.log(`Informe: ${salida}${aplicar ? '' : '\n(sólo lectura: nada guardado; --aplicar para escribir en la copia)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
