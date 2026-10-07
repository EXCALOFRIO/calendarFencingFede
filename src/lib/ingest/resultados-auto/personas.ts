/**
 * Enlace conservador de personas para la ingesta automática.
 *
 * Orden de decisión para cada puesto sin persona:
 *  1. ID externo confirmado: ID FIE (`fie_addr_id`) o licencia RFEE de esa temporada
 *     (`rfee_license` con ámbito de temporada, como la escribe la ingesta de Skermo).
 *  2. La misma licencia confirmada en otra temporada para una persona con el MISMO nombre
 *     (relación `mismo` de `nombres-union`, que distingue apellidos cruzados, hermanos y primos).
 *  3. Nombre normalizado idéntico con relación `mismo`, contexto de la prueba (mismo país en la
 *     FIE; mismo club en los tres últimos años en las nacionales), mismo género, año de
 *     nacimiento compatible, sin otro ID del mismo tipo y sin puesto ya en esta prueba. Sólo si
 *     queda UN candidato.
 *  4. Si no: con ID publicado y SIN homónimos se crea una persona nueva con ese ID. Con
 *     homónimos (o sin ID: Engarde, PDF) el puesto queda sin persona y los homónimos quedan como
 *     candidatos `PROPUESTO` para el siguiente lote. Nunca se une ni se crea por la duda.
 */
import type { HechosPrueba, ResultadoHecho } from '../hechos/formato';
import { normalizarNombre } from '../hechos/reglas-carga';
import { mejorRelacion, type NombrePublicado } from '../../sport/nombres/union';
import type { BaseResultados, Sentencia } from './sql';

export type ContextoPersonas = {
  source: HechosPrueba['source'];
  season: string;
  /** Fecha de la prueba (ISO); acota la búsqueda de club. */
  fecha: string | null;
  gender: HechosPrueba['competition']['gender'];
  competitionKey: string;
  /** Personas ya enlazadas a otros puestos de esta prueba: nunca reciben un segundo puesto. */
  yaEnPrueba: ReadonlySet<string>;
  ahora: number;
  uuid: () => string;
};

export type DecisionPersona =
  | { tipo: 'id_externo' | 'licencia_otra_temporada' | 'nombre_contexto'; personId: string }
  | { tipo: 'nueva'; personId: string }
  | { tipo: 'sin_enlazar'; candidatos: string[] };

export type ResultadoPersonas = {
  personas: Map<string, string | null>;
  decisiones: Map<string, DecisionPersona>;
  /** Sentencias que deben ir ANTES de los puestos (personas nuevas, IDs, candidatos). */
  sentencias: Sentencia[];
  nuevas: string[];
};

const LOTE = 80;
const trozos = <T>(xs: readonly T[], n = LOTE) => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const marcas = (n: number) => Array.from({ length: n }, () => '?').join(',');
const temporadaRfee = (season: string) => /^(\d{4})-(\d{4})$/.exec(season);

async function raices(base: BaseResultados, ids: readonly string[]): Promise<Map<string, string>> {
  const raiz = new Map<string, string>(ids.map((id) => [id, id]));
  let pendientes = [...new Set(ids)];
  for (let salto = 0; salto < 4 && pendientes.length; salto += 1) {
    const siguientes: string[] = [];
    const destino = new Map<string, string>();
    for (const t of trozos(pendientes)) {
      for (const r of await base.leer<{ id: string; m: string | null }>(
        `select id, merged_into_person_id m from sport_person where id in (${marcas(t.length)})`, t)) {
        if (r.m) { destino.set(r.id, r.m); siguientes.push(r.m); }
      }
    }
    for (const [origen, actual] of raiz) {
      const d = destino.get(actual);
      if (d) raiz.set(origen, d);
    }
    pendientes = [...new Set(siguientes)];
  }
  return raiz;
}

type Candidata = {
  id: string; gender: string | null; country: string | null; birthYear: number | null;
  nombres: NombrePublicado[];
};

async function candidatasPorNombre(base: BaseResultados, normalizados: readonly string[]) {
  const porNombre = new Map<string, Set<string>>();
  const anotar = (n: string, id: string) => (porNombre.get(n) ?? porNombre.set(n, new Set()).get(n)!).add(id);
  for (const t of trozos([...new Set(normalizados)])) {
    for (const r of await base.leer<{ id: string; n: string }>(
      `select id, name_normalized n from sport_person where name_normalized in (${marcas(t.length)})`, t)) anotar(r.n, r.id);
    for (const r of await base.leer<{ id: string; n: string }>(
      `select person_id id, name_normalized n from sport_person_alias where name_normalized in (${marcas(t.length)})`, t)) anotar(r.n, r.id);
  }
  const todas = [...new Set([...porNombre.values()].flatMap((s) => [...s]))];
  const raiz = await raices(base, todas);
  const porNombreRaiz = new Map<string, Set<string>>();
  for (const [n, ids] of porNombre) porNombreRaiz.set(n, new Set([...ids].map((id) => raiz.get(id) ?? id)));
  const raicesUnicas = [...new Set(raiz.values())];
  const datos = new Map<string, Candidata>();
  // Names that identify the group: the root plus every member, as the batch rules do.
  const miembros = new Map<string, string[]>();
  for (const t of trozos(raicesUnicas)) {
    for (const r of await base.leer<{ id: string; m: string }>(
      `select id, merged_into_person_id m from sport_person where merged_into_person_id in (${marcas(t.length)})`, t)) {
      (miembros.get(r.m) ?? miembros.set(r.m, []).get(r.m)!).push(r.id);
    }
  }
  const grupo = (r: string) => [r, ...(miembros.get(r) ?? [])];
  const ids = [...new Set(raicesUnicas.flatMap(grupo))];
  const filas = new Map<string, { display_name: string; gender: string | null; country_code: string | null; birth_year: number | null }>();
  const alias = new Map<string, NombrePublicado[]>();
  for (const t of trozos(ids)) {
    for (const r of await base.leer<{ id: string; display_name: string; gender: string | null; country_code: string | null; birth_year: number | null }>(
      `select id, display_name, gender, country_code, birth_year from sport_person where id in (${marcas(t.length)})`, t)) filas.set(r.id, r);
    for (const r of await base.leer<{ id: string; source: string; name_original: string }>(
      `select person_id id, source, name_original from sport_person_alias where person_id in (${marcas(t.length)})`, t)) {
      (alias.get(r.id) ?? alias.set(r.id, []).get(r.id)!).push({ nombre: r.name_original, fuente: r.source });
    }
  }
  for (const r of raicesUnicas) {
    const f = filas.get(r);
    if (!f) continue;
    const nombres: NombrePublicado[] = [];
    for (const id of grupo(r)) {
      const g = filas.get(id);
      if (g) nombres.push(g.display_name);
      nombres.push(...(alias.get(id) ?? []));
    }
    datos.set(r, { id: r, gender: f.gender, country: f.country_code, birthYear: f.birth_year, nombres });
  }
  return { porNombreRaiz, datos, grupo };
}

/** Decide la persona de cada puesto que la necesita. Nunca escribe: devuelve sentencias. */
export async function resolverPersonas(
  base: BaseResultados,
  ctx: ContextoPersonas,
  filas: readonly ResultadoHecho[],
): Promise<ResultadoPersonas> {
  const personas = new Map<string, string | null>();
  const decisiones = new Map<string, DecisionPersona>();
  const sentencias: Sentencia[] = [];
  const nuevas: string[] = [];
  const usados = new Set(ctx.yaEnPrueba);
  const equipos = filas.some((f) => f.factKey.startsWith('team:'));
  if (equipos) return { personas, decisiones, sentencias, nuevas };

  const rfee = temporadaRfee(ctx.season);
  const fieIds = filas.map((f) => f.fieId).filter((x): x is string => !!x);
  const licencias = filas.map((f) => f.license).filter((x): x is string => !!x);

  const porFie = new Map<string, string>();
  for (const t of trozos([...new Set(fieIds)])) {
    for (const r of await base.leer<{ v: string; p: string }>(
      `select value v, person_id p from sport_external_id where scheme='fie_addr_id' and link_status='CONFIRMADO'
         and person_id is not null and value in (${marcas(t.length)})`, t)) porFie.set(r.v, r.p);
  }
  const porLicencia = new Map<string, string>();
  const licenciaOtra = new Map<string, Set<string>>();
  for (const t of trozos([...new Set(licencias)])) {
    for (const r of await base.leer<{ v: string; p: string; s: string }>(
      `select value v, person_id p, scope_season s from sport_external_id where scheme='rfee_license'
         and link_status='CONFIRMADO' and person_id is not null and value in (${marcas(t.length)})`, t)) {
      if (r.s === ctx.season) porLicencia.set(r.v, r.p);
      else (licenciaOtra.get(r.v) ?? licenciaOtra.set(r.v, new Set()).get(r.v)!).add(r.p);
    }
  }
  const raiz = await raices(base, [...porFie.values(), ...porLicencia.values(), ...[...licenciaOtra.values()].flatMap((s) => [...s])]);
  const r = (id: string) => raiz.get(id) ?? id;
  // Identifiers are reused or mis-assigned now and then (same initials, another family member):
  // an identifier never overrides a different gender or an incompatible birth year.
  const perfil = new Map<string, { gender: string | null; birthYear: number | null }>();
  for (const t of trozos([...new Set([...raiz.values()])])) {
    for (const x of await base.leer<{ id: string; g: string | null; b: number | null }>(
      `select id, gender g, birth_year b from sport_person where id in (${marcas(t.length)})`, t)) {
      perfil.set(x.id, { gender: x.g, birthYear: x.b === null ? null : Number(x.b) });
    }
  }
  const compatible = (id: string, f: ResultadoHecho) => {
    const p = perfil.get(id);
    if (!p) return true;
    if (ctx.gender !== 'MIXTO' && p.gender && p.gender !== ctx.gender) return false;
    return !(f.birthYear && p.birthYear && Math.abs(f.birthYear - p.birthYear) > 1);
  };
  const propuestas: { ref: string; personId: string; s: Sentencia }[] = [];
  const proponer = (f: ResultadoHecho, c: string, evidencia: string) => {
    const ref = `${ctx.source}|${ctx.season}|${ctx.competitionKey}|${f.factKey}`.slice(0, 500);
    propuestas.push({ ref, personId: c, s: {
      sql: `insert into sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence, created_at)
        values (?,?,?,?,?,'PROPUESTO',?,?) on conflict (source, source_ref, person_id) do nothing`,
      params: [ctx.uuid(), 'resultados_auto', ref, f.name, c, evidencia, ctx.ahora],
      filas: 1,
    } });
  };
  // Proposals already on file are not re-sent: each pass would otherwise plan rows that change nothing.
  const cerrar = async (): Promise<ResultadoPersonas> => {
    const existentes = new Set<string>();
    for (const t of trozos([...new Set(propuestas.map((p) => p.ref))])) {
      for (const x of await base.leer<{ r: string; p: string }>(`select source_ref r, person_id p from sport_link_candidate
          where source='resultados_auto' and source_ref in (${marcas(t.length)})`, t)) existentes.add(`${x.r}|${x.p}`);
    }
    for (const p of propuestas) if (!existentes.has(`${p.ref}|${p.personId}`)) sentencias.push(p.s);
    return { personas, decisiones, sentencias, nuevas };
  };

  const pendientes: ResultadoHecho[] = [];
  for (const f of filas) {
    const id = f.fieId ? porFie.get(f.fieId) : f.license ? porLicencia.get(f.license) : undefined;
    if (id && !usados.has(r(id)) && compatible(r(id), f)) {
      personas.set(f.factKey, r(id));
      usados.add(r(id));
      decisiones.set(f.factKey, { tipo: 'id_externo', personId: r(id) });
    } else if (!id) pendientes.push(f);
    else {
      decisiones.set(f.factKey, { tipo: 'sin_enlazar', candidatos: [r(id)] });
      personas.set(f.factKey, null);
      if (!compatible(r(id), f)) proponer(f, r(id), 'id_externo_con_genero_o_edad_incompatible');
    }
  }
  if (!pendientes.length) return cerrar();

  const { porNombreRaiz, datos, grupo } = await candidatasPorNombre(base, pendientes.map((f) => normalizarNombre(f.name)));
  const todasCandidatas = [...datos.keys()];
  // Conflicting identifiers and club context of every candidate group, in a few reads.
  const otrosIds = new Map<string, Set<string>>();
  const clubes = new Map<string, Set<string>>();
  const miembrosDe = new Map(todasCandidatas.map((c) => [c, grupo(c)]));
  const raizDeMiembro = new Map([...miembrosDe].flatMap(([c, ms]) => ms.map((m) => [m, c] as const)));
  const ids = [...raizDeMiembro.keys()];
  const desde = ctx.fecha ? `${Number(ctx.fecha.slice(0, 4)) - 3}${ctx.fecha.slice(4)}` : '1900-01-01';
  for (const t of trozos(ids)) {
    for (const x of await base.leer<{ p: string; scheme: string; v: string; s: string }>(
      `select person_id p, scheme, value v, scope_season s from sport_external_id where link_status='CONFIRMADO'
         and person_id in (${marcas(t.length)})`, t)) {
      const c = raizDeMiembro.get(x.p)!;
      const k = x.scheme === 'rfee_license' ? `rfee_license|${x.s}|${x.v}` : `${x.scheme}|${x.v}`;
      (otrosIds.get(c) ?? otrosIds.set(c, new Set()).get(c)!).add(k);
    }
    for (const x of await base.leer<{ p: string; club: string }>(
      `select distinct person_id p, source_club club from sport_result where person_id in (${marcas(t.length)})
         and source_club is not null and occurred_on >= ?`, [...t, desde])) {
      const c = raizDeMiembro.get(x.p)!;
      (clubes.get(c) ?? clubes.set(c, new Set()).get(c)!).add(x.club.trim().toUpperCase());
    }
  }
  const licenciaCandidata = (f: ResultadoHecho): string | null => {
    if (!f.license) return null;
    const otras = [...(licenciaOtra.get(f.license) ?? [])].map(r);
    const conNombre = [...new Set(otras)].filter((c) => compatible(c, f)).filter((c) => {
      const d = datos.get(c);
      const rel = mejorRelacion(d?.nombres ?? [], [{ nombre: f.name, fuente: ctx.source }]);
      return rel?.relacion === 'mismo';
    });
    return conNombre.length === 1 ? conNombre[0] : null;
  };
  const conflictoId = (c: string, f: ResultadoHecho) => {
    const ids = otrosIds.get(c) ?? new Set<string>();
    if (f.fieId) return [...ids].some((k) => k.startsWith('fie_addr_id|') && k !== `fie_addr_id|${f.fieId}`);
    if (f.license) return [...ids].some((k) => k.startsWith(`rfee_license|${ctx.season}|`) && k !== `rfee_license|${ctx.season}|${f.license}`);
    return false;
  };

  for (const f of pendientes) {
    const porOtra = licenciaCandidata(f);
    let elegida: { id: string; tipo: DecisionPersona['tipo'] } | null =
      porOtra && !usados.has(porOtra) ? { id: porOtra, tipo: 'licencia_otra_temporada' } : null;
    const homonimos = [...(porNombreRaiz.get(normalizarNombre(f.name)) ?? [])].filter((c) => datos.has(c));
    if (!elegida) {
      const validas = homonimos.filter((c) => {
        const d = datos.get(c)!;
        if (usados.has(c)) return false;
        if (mejorRelacion(d.nombres, [{ nombre: f.name, fuente: ctx.source }])?.relacion !== 'mismo') return false;
        if (ctx.gender !== 'MIXTO' && d.gender && d.gender !== ctx.gender) return false;
        if (f.birthYear && d.birthYear && Math.abs(f.birthYear - d.birthYear) > 1) return false;
        if (conflictoId(c, f)) return false;
        const pais = f.countryCode ?? null;
        const club = f.club?.trim().toUpperCase() ?? null;
        const enContexto = ctx.source === 'fie' || ctx.source === 'efc'
          ? pais !== null && d.country === pais
          : club !== null && (clubes.get(c)?.has(club) ?? false);
        return enContexto;
      });
      if (validas.length === 1) elegida = { id: validas[0], tipo: 'nombre_contexto' };
    }
    if (elegida) {
      personas.set(f.factKey, elegida.id);
      usados.add(elegida.id);
      decisiones.set(f.factKey, { tipo: elegida.tipo, personId: elegida.id } as DecisionPersona);
      // Record the identifier on the chosen person so that the next read resolves it directly.
      if (f.fieId || (f.license && rfee)) sentencias.push(...sentenciasId(ctx, f, elegida.id, `resultados_auto:${elegida.tipo}`));
      continue;
    }
    const candidatos = homonimos.filter((c) => !usados.has(c)).slice(0, 3);
    // A homonym may be this same fencer under another identifier: creating a person would split it.
    if ((f.fieId || (f.license && rfee)) && homonimos.length === 0) {
      const id = ctx.uuid();
      nuevas.push(id);
      personas.set(f.factKey, id);
      usados.add(id);
      decisiones.set(f.factKey, { tipo: 'nueva', personId: id });
      sentencias.push(...sentenciasPersonaNueva(ctx, f, id));
      sentencias.push(...sentenciasId(ctx, f, id, 'resultados_auto:id_publicado'));
    } else {
      personas.set(f.factKey, null);
      decisiones.set(f.factKey, { tipo: 'sin_enlazar', candidatos });
    }
    for (const c of candidatos) proponer(f, c, 'nombre_identico_sin_contexto_unico');
  }
  return cerrar();
}

function sentenciasPersonaNueva(ctx: ContextoPersonas, f: ResultadoHecho, id: string): Sentencia[] {
  const genero = ctx.gender === 'MIXTO' ? null : ctx.gender;
  return [
    {
      sql: `insert into sport_person (id, display_name, name_normalized, gender, country_code, birth_year, created_at, updated_at)
        values (?,?,?,?,?,?,?,?)`,
      params: [id, f.name, normalizarNombre(f.name), genero, f.countryCode ?? null, f.birthYear ?? null, ctx.ahora, ctx.ahora],
      filas: 1,
    },
    {
      sql: `insert into sport_person_alias (id, person_id, source, name_original, name_normalized, first_seen_at)
        values (?,?,?,?,?,?)`,
      params: [ctx.uuid(), id, ctx.source, f.name, normalizarNombre(f.name), ctx.ahora],
      filas: 1,
    },
  ];
}

function sentenciasId(ctx: ContextoPersonas, f: ResultadoHecho, personId: string, via: string): Sentencia[] {
  if (f.fieId) {
    return [{
      sql: `insert into sport_external_id (id, person_id, scheme, value, scope_source, scope_federation, scope_season,
          scope_weapon, valid_from, valid_to, link_status, linked_via, linked_at, evidence, created_at, updated_at)
        values (?,?,'fie_addr_id',?,'fie','','','','1900-01-01',null,'CONFIRMADO',?,?,?,?,?)`,
      params: [ctx.uuid(), personId, f.fieId, via, ctx.ahora,
        `ID FIE publicado en resultados ${ctx.season}/${ctx.competitionKey}`, ctx.ahora, ctx.ahora],
      filas: 1,
    }];
  }
  const m = temporadaRfee(ctx.season);
  if (!f.license || !m) return [];
  return [{
    sql: `insert into sport_external_id (id, person_id, scheme, value, scope_source, scope_federation, scope_season,
        scope_weapon, valid_from, valid_to, link_status, linked_via, linked_at, evidence, created_at, updated_at)
      values (?,?,'rfee_license',?,'skermo_rfee','RFEE',?,'',?,?,'CONFIRMADO',?,?,?,?,?)`,
    params: [ctx.uuid(), personId, f.license, ctx.season, `${m[1]}-09-01`, `${m[2]}-08-31`, via, ctx.ahora,
      `Licencia publicada en la clasificación ${ctx.competitionKey} (${ctx.season})`, ctx.ahora, ctx.ahora],
    filas: 1,
  }];
}
