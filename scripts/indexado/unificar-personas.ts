/**
 * Une identidades deportivas en el SQLite de trabajo (idempotente). Se ejecuta
 * después de `cargar-hechos.ts`.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/unificar-personas.ts \
 *     [--db <nuevo.sqlite>] [--informe <unificacion-informe.json>]
 *
 * Pasos, en este orden:
 *  a) FIE: una persona por ID FIE publicado (reutiliza `fie_addr_id` existentes)
 *     y se rellenan `person_id` de puestos y asaltos FIE.
 *  c0) Personas con la misma licencia RFEE (una por temporada en Skermo) se
 *     funden en una, si comparten nombre normalizado y género.
 *  c1) FIE(ESP) ↔ licencia RFEE: fusión por nombre normalizado idéntico o
 *     superconjunto único en ambos sentidos, mismo género. La persona RFEE apunta
 *     a la FIE (`merged_into_person_id`, reversible, sin cadenas).
 *  e) Pruebas Engarde que ya existen en skermo_rfee, rfee_pdf o FIE
 *     (`depurarSolapesEngarde`): se retiran sus puestos; sus asaltos sólo se
 *     quedan, trasladados a la prueba existente, si traen más que ella (nunca
 *     frente a FIE). Va antes de b para no crear personas de pruebas retiradas.
 *  b) Puestos de PDF RFEE y de Engarde (sin IDs): vínculo por nombre normalizado
 *     único entre personas con licencia RFEE / país ESP / creadas desde PDF,
 *     contadas por su persona raíz; si no hay candidata, persona nueva por
 *     (nombre, género). En Engarde sólo puestos individuales de nación ESP o sin
 *     nación. Los asaltos heredan la persona del puesto de la misma prueba.
 *  c2) Personas creadas desde PDF que casan de forma única con una persona
 *     FIE/RFEE se funden en ella.
 * c1 va antes que b para que una persona FIE y su ficha RFEE no cuenten como dos
 * candidatas del mismo nombre. Skermo (enlazado por licencia) no se toca.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { depurarSolapes, depurarSolapesEngarde, type InformeDepuracion, type InformeSolapesEngarde } from './medir-solapes';
import {
  ahora,
  argumento,
  CARPETA_TRABAJO,
  normalizarNombre,
  NUEVO_POR_DEFECTO,
  palabrasNombre,
  prepararCopiaTrabajo,
  quitarGuardia,
  restaurarGuardia,
  uuid,
} from './comun';

type Genero = 'M' | 'F' | 'MIXTO';

/** Fuentes sin identificadores publicados, cuyos puestos se vinculan por nombre (paso b). */
const FUENTES_NOMBRE = ['rfee_pdf', 'engarde'] as const;
type FuenteNombre = (typeof FUENTES_NOMBRE)[number];
const FUENTES_NOMBRE_SQL = FUENTES_NOMBRE.map((f) => `'${f}'`).join(', ');

type Persona = {
  id: string;
  nombre: string;
  norm: string;
  genero: Genero | null;
  pais: string | null;
  fusionada: string | null;
  atleta: string | null;
  variantes: Set<string>;
  fuentesAlias: Set<string>;
};

export type Medida = {
  resultados: Record<string, { total: number; vinculados: number; pct: number }>;
  asaltos: Record<string, { total: number; ambos: number; pct: number }>;
  personas: number;
  fusionadas: number;
};

export type InformeUnificacion = {
  antes: Medida;
  despues: Medida;
  fie: {
    idsDistintos: number;
    personasReutilizadas: number;
    personasCreadas: number;
    aliasNuevos: number;
    resultadosVinculados: number;
    asaltosLadoVinculados: number;
  };
  fusionLicencia: { licenciasConVarias: number; fusiones: number; omitidas: number };
  fusionFieRfee: { fusiones: number; exactas: number; superconjunto: number; ambiguas: number; omitidasPorAtleta: number };
  pdf: {
    gruposNombre: number;
    vinculadosExacto: number;
    vinculadosSuperconjunto: number;
    personasCreadas: number;
    ambiguos: number;
    nombresCortos: number;
    resultadosVinculados: number;
    asaltosLadoVinculados: number;
    /** Puestos sin vincular porque su grupo de nombre se repite en la misma prueba individual. */
    puestosAmbiguosEnPrueba: number;
  };
  fusionPdf: { fusiones: number; ambiguas: number };
  /** Vínculos por nombre deshechos: la misma persona dos veces en una prueba individual rfee_pdf. */
  colisionesPdf: { pruebas: number; resultados: number; asaltosLado: number };
  /** Puestos y asaltos rfee_pdf que ya estaban en la misma prueba de skermo_rfee. */
  solapes: InformeDepuracion;
  /** Pruebas engarde que ya existían en otra fuente: puestos retirados, asaltos sólo si traen más. */
  solapesEngarde: InformeSolapesEngarde;
  candidatosRegistrados: number;
  segundos: number;
};

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 10000) / 100);

export function medir(db: DatabaseSync): Medida {
  const resultados: Medida['resultados'] = {};
  for (const r of db.prepare(
    `SELECT source, count(*) n, sum(person_id IS NOT NULL) v FROM sport_result GROUP BY source ORDER BY source`,
  ).all() as { source: string; n: number; v: number }[]) {
    resultados[r.source] = { total: Number(r.n), vinculados: Number(r.v), pct: pct(Number(r.v), Number(r.n)) };
  }
  const asaltos: Medida['asaltos'] = {};
  for (const r of db.prepare(
    `SELECT source, count(*) n, sum(fencer_a_person_id IS NOT NULL AND fencer_b_person_id IS NOT NULL) v
       FROM sport_bout GROUP BY source ORDER BY source`,
  ).all() as { source: string; n: number; v: number }[]) {
    asaltos[r.source] = { total: Number(r.n), ambos: Number(r.v), pct: pct(Number(r.v), Number(r.n)) };
  }
  const p = db.prepare(`SELECT count(*) n, sum(merged_into_person_id IS NOT NULL) f FROM sport_person`).get() as {
    n: number; f: number | null;
  };
  return { resultados, asaltos, personas: Number(p.n), fusionadas: Number(p.f ?? 0) };
}

const generoDe = (g: string | null): Genero | null => (g === 'M' || g === 'F' || g === 'MIXTO' ? g : null);

function esSubconjunto(pequeno: readonly string[], grande: ReadonlySet<string>): boolean {
  for (const w of pequeno) if (!grande.has(w)) return false;
  return true;
}

class Unificador {
  readonly personas = new Map<string, Persona>();
  /** Valor `fie_addr_id` confirmado → persona. */
  readonly fieDe = new Map<string, string>();
  readonly conFie = new Set<string>();
  readonly conLicencia = new Set<string>();
  readonly conIdExterno = new Set<string>();
  private readonly st: Record<string, StatementSync> = {};
  candidatos = 0;

  constructor(private readonly db: DatabaseSync) {
    for (const p of db.prepare(
      `SELECT id, display_name, name_normalized, gender, country_code, merged_into_person_id, athlete_id FROM sport_person`,
    ).all() as Record<string, string | null>[]) {
      this.personas.set(p.id!, {
        id: p.id!,
        nombre: p.display_name!,
        norm: p.name_normalized!,
        genero: generoDe(p.gender),
        pais: p.country_code,
        fusionada: p.merged_into_person_id,
        atleta: p.athlete_id,
        variantes: new Set(p.name_normalized ? [p.name_normalized] : []),
        fuentesAlias: new Set(),
      });
    }
    for (const a of db.prepare(`SELECT person_id, source, name_normalized FROM sport_person_alias`).all() as {
      person_id: string; source: string; name_normalized: string;
    }[]) {
      const p = this.personas.get(a.person_id);
      if (!p) continue;
      if (a.name_normalized) p.variantes.add(a.name_normalized);
      p.fuentesAlias.add(a.source);
    }
    for (const e of db.prepare(
      `SELECT person_id, scheme, value, scope_source, scope_season FROM sport_external_id
        WHERE link_status='CONFIRMADO' AND person_id IS NOT NULL`,
    ).all() as { person_id: string; scheme: string; value: string; scope_source: string; scope_season: string }[]) {
      this.conIdExterno.add(e.person_id);
      if (e.scheme === 'fie_addr_id' && e.scope_source === 'fie') {
        this.fieDe.set(e.value.trim(), e.person_id);
        this.conFie.add(e.person_id);
      }
      if (e.scheme === 'rfee_license') {
        this.conLicencia.add(e.person_id);
        const v = e.value.trim().toUpperCase();
        const g = this.porLicencia.get(v) ?? new Map<string, string>();
        if ((g.get(e.person_id) ?? '') < e.scope_season) g.set(e.person_id, e.scope_season);
        this.porLicencia.set(v, g);
      }
    }
  }

  /** Licencia RFEE → (persona → temporada más reciente en la que se publicó). */
  readonly porLicencia = new Map<string, Map<string, string>>();

  private q(sql: string): StatementSync {
    return (this.st[sql] ??= this.db.prepare(sql));
  }

  transaccion<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Raíz de la fusión; las cadenas de más de 3 saltos no se resuelven (igual que la app). */
  raiz(id: string): string {
    let actual = id;
    for (let i = 0; i < 4; i += 1) {
      const p = this.personas.get(actual);
      if (!p?.fusionada) return actual;
      actual = p.fusionada;
    }
    return actual;
  }

  crearPersona(nombre: string, norm: string, genero: Genero | null, pais: string | null, fuenteAlias: string): Persona {
    const t = ahora();
    const p: Persona = {
      id: uuid(), nombre, norm, genero: genero === 'MIXTO' ? null : genero, pais,
      fusionada: null, atleta: null, variantes: new Set([norm]), fuentesAlias: new Set([fuenteAlias]),
    };
    this.q(
      `INSERT INTO sport_person (id, display_name, name_normalized, gender, country_code, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(p.id, nombre, norm, p.genero, pais, t, t);
    this.alias(p, fuenteAlias, nombre, norm);
    this.personas.set(p.id, p);
    return p;
  }

  alias(p: Persona, fuente: string, nombre: string, norm: string): boolean {
    const r = this.q(
      `INSERT OR IGNORE INTO sport_person_alias (id, person_id, source, name_original, name_normalized, first_seen_at)
       VALUES (?,?,?,?,?,?)`,
    ).run(uuid(), p.id, fuente, nombre, norm, ahora());
    p.variantes.add(norm);
    p.fuentesAlias.add(fuente);
    return Number(r.changes) > 0;
  }

  candidato(fuente: string, ref: string, nombre: string, personaId: string, estado: 'PROPUESTO' | 'CONFIRMADO', evidencia: string): void {
    const t = ahora();
    const r = this.q(
      `INSERT OR IGNORE INTO sport_link_candidate (id, source, source_ref, source_name, person_id, status, evidence,
         decided_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(uuid(), fuente, ref, nombre, personaId, estado, evidencia, estado === 'CONFIRMADO' ? t : null, t);
    this.candidatos += Number(r.changes);
  }

  /** Funde `origen` en la raíz de `destino`; las fundidas en `origen` pasan a apuntar a esa raíz. */
  fundir(origenId: string, destinoId: string): boolean {
    const destino = this.raiz(destinoId);
    const origen = this.personas.get(origenId);
    if (!origen || origen.fusionada || destino === origenId) return false;
    const t = ahora();
    this.q(`UPDATE sport_person SET merged_into_person_id=?, updated_at=? WHERE id=? AND merged_into_person_id IS NULL`)
      .run(destino, t, origenId);
    origen.fusionada = destino;
    this.q(`UPDATE sport_person SET merged_into_person_id=?, updated_at=? WHERE merged_into_person_id=?`)
      .run(destino, t, origenId);
    for (const p of this.personas.values()) if (p.fusionada === origenId) p.fusionada = destino;
    return true;
  }

  pasoFie(inf: InformeUnificacion['fie']): void {
    type Agregado = {
      nombre: string; fecha: string; paises: Map<string, number>; m: number; f: number;
      nombres: Map<string, string>; deResultados: boolean;
    };
    const agregados = new Map<string, Agregado>();
    const anotar = (ref: string, nombre: string, pais: string | null, fecha: string | null, genero: string | null, deResultados: boolean) => {
      if (!/^\d+$/.test(ref)) return;
      let a = agregados.get(ref);
      if (!a) {
        a = { nombre, fecha: fecha ?? '', paises: new Map(), m: 0, f: 0, nombres: new Map(), deResultados };
        agregados.set(ref, a);
      } else if (a.deResultados && !deResultados) return;
      else if (!a.deResultados && deResultados) {
        a.deResultados = true;
        a.nombre = nombre;
        a.fecha = fecha ?? '';
      } else if ((fecha ?? '') >= a.fecha) {
        a.nombre = nombre;
        a.fecha = fecha ?? '';
      }
      if (pais) a.paises.set(pais, (a.paises.get(pais) ?? 0) + 1);
      if (genero === 'M') a.m += 1;
      if (genero === 'F') a.f += 1;
      const n = normalizarNombre(nombre);
      if (n && !a.nombres.has(n)) a.nombres.set(n, nombre);
    };
    for (const r of this.db.prepare(
      `SELECT r.source_fact_key ref, r.source_name nombre, r.source_country_code pais, r.occurred_on fecha, c.gender genero
         FROM sport_result r JOIN sport_competition c ON c.id = r.competition_id WHERE r.source='fie'`,
    ).iterate() as Iterable<{ ref: string; nombre: string; pais: string | null; fecha: string | null; genero: string }>) {
      anotar(r.ref.trim(), r.nombre, r.pais, r.fecha, r.genero, true);
    }
    for (const b of this.db.prepare(
      `SELECT b.fencer_a_ref a, b.fencer_a_name an, b.fencer_b_ref b, b.fencer_b_name bn, b.occurred_on fecha,
              c.gender genero
         FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
        WHERE b.source='fie' AND (b.fencer_a_person_id IS NULL OR b.fencer_b_person_id IS NULL)`,
    ).iterate() as Iterable<{ a: string; an: string; b: string; bn: string; fecha: string | null; genero: string }>) {
      anotar(b.a.trim(), b.an, null, b.fecha, b.genero, false);
      anotar(b.b.trim(), b.bn, null, b.fecha, b.genero, false);
    }
    inf.idsDistintos = agregados.size;

    this.transaccion(() => {
      this.db.exec('DROP TABLE IF EXISTS temp._mapa_fie');
      this.db.exec('CREATE TEMP TABLE _mapa_fie (ref TEXT PRIMARY KEY, person_id TEXT NOT NULL)');
      const mapa = this.db.prepare('INSERT INTO temp._mapa_fie (ref, person_id) VALUES (?, ?)');
      const t = ahora();
      for (const [ref, a] of agregados) {
        let personaId = this.fieDe.get(ref);
        let persona = personaId ? this.personas.get(personaId) : undefined;
        if (persona) inf.personasReutilizadas += 1;
        else {
          const norm = normalizarNombre(a.nombre);
          if (!norm) continue;
          let pais: string | null = null;
          let max = 0;
          for (const [k, v] of a.paises) if (v > max || (v === max && pais !== null && k < pais)) [pais, max] = [k, v];
          const genero: Genero | null = a.m > a.f ? 'M' : a.f > a.m ? 'F' : null;
          persona = this.crearPersona(a.nombre, norm, genero, pais, 'fie');
          personaId = persona.id;
          this.q(
            `INSERT INTO sport_external_id (id, person_id, scheme, value, scope_source, link_status, linked_via,
               linked_at, evidence, created_at, updated_at)
             VALUES (?,?,'fie_addr_id',?,'fie','CONFIRMADO','fie_id_publicado',?,?,?,?)`,
          ).run(uuid(), personaId, ref, t, 'ID FIE publicado en resultados/asaltos FIE', t, t);
          this.fieDe.set(ref, personaId);
          this.conFie.add(personaId);
          this.conIdExterno.add(personaId);
          inf.personasCreadas += 1;
        }
        for (const [n, original] of a.nombres) {
          if (!persona.variantes.has(n) && this.alias(persona, 'fie', original, n)) inf.aliasNuevos += 1;
        }
        mapa.run(ref, personaId!);
      }
      inf.resultadosVinculados = Number(this.db.prepare(
        `UPDATE sport_result SET person_id = m.person_id FROM temp._mapa_fie m
          WHERE sport_result.source='fie' AND sport_result.person_id IS NULL AND m.ref = sport_result.source_fact_key`,
      ).run().changes);
      const a = this.db.prepare(
        `UPDATE sport_bout SET fencer_a_person_id = m.person_id FROM temp._mapa_fie m
          WHERE sport_bout.source='fie' AND sport_bout.fencer_a_person_id IS NULL AND m.ref = sport_bout.fencer_a_ref
            AND (sport_bout.fencer_b_person_id IS NULL OR sport_bout.fencer_b_person_id <> m.person_id)`,
      ).run().changes;
      const b = this.db.prepare(
        `UPDATE sport_bout SET fencer_b_person_id = m.person_id FROM temp._mapa_fie m
          WHERE sport_bout.source='fie' AND sport_bout.fencer_b_person_id IS NULL AND m.ref = sport_bout.fencer_b_ref
            AND (sport_bout.fencer_a_person_id IS NULL OR sport_bout.fencer_a_person_id <> m.person_id)`,
      ).run().changes;
      inf.asaltosLadoVinculados = Number(a) + Number(b);
      this.db.exec('DROP TABLE temp._mapa_fie');
    });
  }

  /** Índices de nombre (exacto y por palabra) sobre un conjunto de personas. */
  private indice(ids: Iterable<string>) {
    const exacto = new Map<string, Set<string>>();
    const palabra = new Map<string, Set<string>>();
    const palabrasDe = new Map<string, Set<string>[]>();
    for (const id of ids) {
      const p = this.personas.get(id)!;
      const conjuntos: Set<string>[] = [];
      for (const v of p.variantes) {
        if (!v) continue;
        (exacto.get(v) ?? exacto.set(v, new Set()).get(v)!).add(id);
        const ws = new Set(v.split(' '));
        conjuntos.push(ws);
        for (const w of ws) (palabra.get(w) ?? palabra.set(w, new Set()).get(w)!).add(id);
      }
      palabrasDe.set(id, conjuntos);
    }
    /** Personas con alguna variante que contiene todas las `palabras`. */
    const superconjunto = (palabras: readonly string[]): string[] => {
      let menor: Set<string> | undefined;
      for (const w of palabras) {
        const s = palabra.get(w);
        if (!s) return [];
        if (!menor || s.size < menor.size) menor = s;
      }
      if (!menor) return [];
      return [...menor].filter((id) => palabrasDe.get(id)!.some((ws) => esSubconjunto(palabras, ws)));
    };
    return { exacto, palabra, palabrasDe, superconjunto };
  }

  /**
   * La importación Skermo creó una persona por (licencia, temporada): 8.825
   * personas para 3.611 licencias. La licencia publicada identifica a la misma
   * persona, así que se funden en una, salvo que bajo la misma licencia aparezcan
   * nombres o géneros distintos (licencia reasignada: se deja para revisión).
   */
  pasoFusionLicencia(inf: InformeUnificacion['fusionLicencia']): void {
    this.transaccion(() => {
      for (const [licencia, miembros] of this.porLicencia) {
        const ids = [...miembros.keys()].map((id) => this.raiz(id));
        const unicos = [...new Set(ids)];
        if (unicos.length < 2) continue;
        inf.licenciasConVarias += 1;
        const firmas = new Set(unicos.map((id) => {
          const p = this.personas.get(id)!;
          return `${p.norm}|${p.genero ?? ''}`;
        }));
        const atletas = unicos.filter((id) => this.personas.get(id)!.atleta);
        if (firmas.size > 1 || atletas.length > 1) {
          inf.omitidas += 1;
          continue;
        }
        const temporada = (id: string) =>
          Math.max(...[...miembros].filter(([m]) => this.raiz(m) === id).map(([, s]) => Number(s.slice(0, 4)) || 0));
        const raiz = atletas[0] ?? [...unicos].sort((a, b) => temporada(b) - temporada(a) || (a < b ? -1 : 1))[0];
        for (const id of unicos) {
          if (id === raiz) continue;
          if (this.fundir(id, raiz)) {
            inf.fusiones += 1;
            this.candidato('fusion_licencia_rfee', id, this.personas.get(id)!.nombre, raiz, 'CONFIRMADO',
              `misma_licencia_rfee:${licencia}`);
          }
        }
      }
    });
  }

  pasoFusionFieRfee(inf: InformeUnificacion['fusionFieRfee']): void {
    const fies = [...this.conFie].filter((id) => {
      const p = this.personas.get(id);
      return p && !p.fusionada && p.pais === 'ESP' && (p.genero === 'M' || p.genero === 'F');
    });
    const rfees = [...this.conLicencia].filter((id) => {
      const p = this.personas.get(id);
      return p && !p.fusionada && !this.conFie.has(id) && (p.genero === 'M' || p.genero === 'F');
    });
    const iF = this.indice(fies);
    const iR = this.indice(rfees);
    const genero = (id: string) => this.personas.get(id)!.genero;
    type Cand = Map<string, boolean>;
    const deF = new Map<string, Cand>();
    for (const f of fies) {
      const c: Cand = new Map();
      for (const v of this.personas.get(f)!.variantes) {
        for (const r of iR.exacto.get(v) ?? []) if (genero(r) === genero(f)) c.set(r, true);
        const ws = v.split(' ');
        if (ws.length >= 2) for (const r of iR.superconjunto(ws)) if (genero(r) === genero(f) && !c.has(r)) c.set(r, false);
      }
      deF.set(f, c);
    }
    const deR = new Map<string, Set<string>>();
    for (const [f, c] of deF) for (const r of c.keys()) (deR.get(r) ?? deR.set(r, new Set()).get(r)!).add(f);

    this.transaccion(() => {
      for (const [f, c] of deF) {
        if (c.size === 0) continue;
        const pf = this.personas.get(f)!;
        if (c.size > 1) {
          inf.ambiguas += 1;
          for (const r of [...c.keys()].slice(0, 10)) {
            this.candidato('fusion_fie_rfee', r, this.personas.get(r)!.nombre, f, 'PROPUESTO', 'nombre_varias_candidatas');
          }
          continue;
        }
        const [[r, exacta]] = [...c];
        if (deR.get(r)!.size !== 1) {
          inf.ambiguas += 1;
          for (const otra of [...deR.get(r)!].slice(0, 10)) {
            this.candidato('fusion_fie_rfee', r, this.personas.get(r)!.nombre, otra, 'PROPUESTO', 'nombre_varias_candidatas');
          }
          continue;
        }
        const pr = this.personas.get(r)!;
        if (pr.atleta && pf.atleta) {
          inf.omitidasPorAtleta += 1;
          continue;
        }
        const evidencia = exacta ? 'nombre_normalizado_unico' : 'nombre_superconjunto_unico';
        if (this.fundir(r, f)) {
          inf.fusiones += 1;
          if (exacta) inf.exactas += 1;
          else inf.superconjunto += 1;
          this.candidato('fusion_fie_rfee', r, pr.nombre, this.raiz(f), 'CONFIRMADO', evidencia);
        }
      }
    });
  }

  pasoPdf(inf: InformeUnificacion['pdf']): Map<string, string> {
    type Grupo = {
      norm: string; genero: Genero; palabras: string[]; nombres: Map<string, number>;
      persona?: string; resultados: string[]; fuente: FuenteNombre;
    };
    const grupos = new Map<string, Grupo>();
    const grupoDe = (nombre: string, genero: string, fuente: string): Grupo | null => {
      const palabras = palabrasNombre(nombre).sort();
      const g = generoDe(genero) ?? 'MIXTO';
      const norm = palabras.join(' ');
      if (!norm) return null;
      const k = `${norm}|${g}`;
      let gr = grupos.get(k);
      if (!gr) {
        gr = { norm, genero: g, palabras, nombres: new Map(), resultados: [], fuente: fuente as FuenteNombre };
        grupos.set(k, gr);
      }
      if (fuente === 'rfee_pdf') gr.fuente = 'rfee_pdf';
      gr.nombres.set(nombre, (gr.nombres.get(nombre) ?? 0) + 1);
      return gr;
    };
    // Engarde publica tiradores extranjeros con su nación: sólo se vinculan por nombre los
    // de nación española o sin nación, igual que el resto del grupo de candidatas (RFEE/ESP).
    // Dos puestos de la misma prueba individual con el mismo grupo de nombre son dos personas
    // («LACASTA AREN» trunca a Sergio y a Daniel; «ORTIN ROMERO» y «ROMERO ORTIN» ordenan igual):
    // ninguno se vincula por nombre en esa prueba.
    const puestosEnPrueba = new Map<string, Map<string, string[]>>();
    const resultadoAmbiguo = new Set<string>();
    for (const r of this.db.prepare(
      `SELECT r.id, r.source_name nombre, c.gender genero, r.source fuente, r.competition_id comp, c.format formato
         FROM sport_result r
         JOIN sport_competition c ON c.id = r.competition_id
        WHERE r.source IN (${FUENTES_NOMBRE_SQL}) AND r.person_id IS NULL
          AND NOT (r.source='engarde' AND (c.format='EQUIPOS' OR coalesce(r.source_country_code, 'ESP') <> 'ESP'))`,
    ).all() as { id: string; nombre: string; genero: string; fuente: string; comp: string; formato: string }[]) {
      const g = grupoDe(r.nombre, r.genero, r.fuente);
      if (!g) continue;
      g.resultados.push(r.id);
      if (r.formato !== 'INDIVIDUAL') continue;
      const k = `${g.norm}|${g.genero}`;
      const m = puestosEnPrueba.get(k) ?? puestosEnPrueba.set(k, new Map()).get(k)!;
      m.set(r.comp, [...(m.get(r.comp) ?? []), r.id]);
    }
    const pruebasAmbiguas = new Map<string, Set<string>>();
    for (const [k, m] of puestosEnPrueba) {
      for (const [comp, ids] of m) {
        if (ids.length < 2) continue;
        (pruebasAmbiguas.get(k) ?? pruebasAmbiguas.set(k, new Set()).get(k)!).add(comp);
        for (const id of ids) resultadoAmbiguo.add(id);
      }
    }
    inf.puestosAmbiguosEnPrueba = resultadoAmbiguo.size;
    type Asalto = {
      id: string; competicion: string; a: string; an: string; ap: string | null; b: string; bn: string; bp: string | null;
      genero: string; fuente: string;
    };
    const asaltos = this.db.prepare(
      `SELECT b.id, b.competition_id competicion, b.fencer_a_ref a, b.fencer_a_name an, b.fencer_a_person_id ap,
              b.fencer_b_ref b, b.fencer_b_name bn, b.fencer_b_person_id bp, c.gender genero, b.source fuente
         FROM sport_bout b JOIN sport_competition c ON c.id = b.competition_id
        WHERE b.source IN (${FUENTES_NOMBRE_SQL}) AND (b.fencer_a_person_id IS NULL OR b.fencer_b_person_id IS NULL)`,
    ).all() as Asalto[];
    for (const b of asaltos) {
      // En Engarde el asalto hereda la persona del puesto de su prueba; no abre grupos de nombre propios.
      if (b.fuente === 'engarde') continue;
      if (!b.ap) grupoDe(b.an, b.genero, b.fuente);
      if (!b.bp) grupoDe(b.bn, b.genero, b.fuente);
    }
    inf.gruposNombre = grupos.size;

    // Las fundidas también cuentan: su nombre (p. ej. el de la ficha RFEE) lleva a la raíz FIE.
    const pool = [...this.personas.values()]
      .filter((p) => this.conLicencia.has(p.id) || p.pais === 'ESP' || FUENTES_NOMBRE.some((f) => p.fuentesAlias.has(f)))
      .map((p) => p.id);
    const idx = this.indice(pool);
    const compatible = (id: string, g: Genero) => {
      const pg = this.personas.get(id)!.genero;
      return g === 'MIXTO' || pg === null || pg === g;
    };
    const raices = (ids: Iterable<string>, g: Genero) =>
      [...new Set([...ids].filter((id) => compatible(id, g)).map((id) => this.raiz(id)))];

    const resolucion = new Map<string, string>();
    this.transaccion(() => {
      this.db.exec('DROP TABLE IF EXISTS temp._mapa_pdf');
      this.db.exec('CREATE TEMP TABLE _mapa_pdf (id TEXT PRIMARY KEY, person_id TEXT NOT NULL)');
      const mapa = this.db.prepare('INSERT INTO temp._mapa_pdf (id, person_id) VALUES (?, ?)');
      const ordenados = [...grupos.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
      for (const [k, g] of ordenados) {
        if (g.palabras.length < 2) {
          inf.nombresCortos += 1;
          continue;
        }
        const visible = [...g.nombres].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0];
        const ref = `nombre:${g.norm}|${g.genero}`;
        let cands = raices(idx.exacto.get(g.norm) ?? [], g.genero);
        let evidencia = 'nombre_normalizado_unico';
        if (cands.length === 0 && g.palabras.length >= 3) {
          cands = raices(idx.superconjunto(g.palabras), g.genero);
          evidencia = 'nombre_superconjunto_unico';
        }
        if (cands.length > 1) {
          inf.ambiguos += 1;
          for (const c of cands.slice(0, 10)) this.candidato(g.fuente, ref, visible, c, 'PROPUESTO', 'nombre_varias_candidatas');
          continue;
        }
        if (cands.length === 1) {
          g.persona = cands[0];
          if (evidencia === 'nombre_normalizado_unico') inf.vinculadosExacto += 1;
          else inf.vinculadosSuperconjunto += 1;
          this.candidato(g.fuente, ref, visible, g.persona, 'CONFIRMADO', evidencia);
        } else {
          g.persona = this.crearPersona(visible, g.norm, g.genero, null, g.fuente).id;
          inf.personasCreadas += 1;
        }
        resolucion.set(k, g.persona);
        for (const id of g.resultados) if (!resultadoAmbiguo.has(id)) mapa.run(id, g.persona);
      }
      inf.resultadosVinculados = Number(this.db.prepare(
        `UPDATE sport_result SET person_id = m.person_id FROM temp._mapa_pdf m
          WHERE m.id = sport_result.id AND sport_result.person_id IS NULL`,
      ).run().changes);
      this.db.exec('DROP TABLE temp._mapa_pdf');

      // Asaltos: misma referencia o mismo nombre en la misma prueba; si no, el grupo de nombre.
      const porComp = new Map<string, { ref: Map<string, string>; nombre: Map<string, string | null> }>();
      for (const r of this.db.prepare(
        `SELECT competition_id c, source_fact_key k, source_name n, person_id p FROM sport_result
          WHERE person_id IS NOT NULL AND (source IN (${FUENTES_NOMBRE_SQL}) OR competition_id IN (
            -- Asaltos de Engarde trasladados a una prueba skermo_rfee: se vinculan con sus puestos.
            SELECT competition_id FROM sport_bout
             WHERE source='engarde' AND (fencer_a_person_id IS NULL OR fencer_b_person_id IS NULL)))`,
      ).iterate() as Iterable<{ c: string; k: string; n: string; p: string }>) {
        let m = porComp.get(r.c);
        if (!m) porComp.set(r.c, (m = { ref: new Map(), nombre: new Map() }));
        m.ref.set(r.k, r.p);
        const n = normalizarNombre(r.n);
        m.nombre.set(n, m.nombre.has(n) && m.nombre.get(n) !== r.p ? null : r.p);
      }
      const persona = (comp: string, ref: string, nombre: string, genero: string, fuente: string): string | null => {
        const m = porComp.get(comp);
        const norm = normalizarNombre(nombre);
        const enPrueba = m?.ref.get(ref) ?? m?.nombre.get(norm) ?? null;
        // Un tirador de Engarde sin puesto vinculado en su prueba (extranjero, nombre repetido)
        // no se resuelve por el nombre de otras pruebas.
        if (fuente === 'engarde') return enPrueba;
        const k = `${palabrasNombre(nombre).sort().join(' ')}|${generoDe(genero) ?? 'MIXTO'}`;
        if (pruebasAmbiguas.get(k)?.has(comp)) return enPrueba;
        return enPrueba ?? resolucion.get(`${norm}|${generoDe(genero) ?? 'MIXTO'}`) ?? null;
      };
      this.db.exec('DROP TABLE IF EXISTS temp._mapa_asalto');
      this.db.exec('CREATE TEMP TABLE _mapa_asalto (id TEXT PRIMARY KEY, a TEXT, b TEXT)');
      const ma = this.db.prepare('INSERT INTO temp._mapa_asalto (id, a, b) VALUES (?, ?, ?)');
      let lados = 0;
      for (const b of asaltos) {
        const a = b.ap ?? persona(b.competicion, b.a, b.an, b.genero, b.fuente);
        let bb = b.bp ?? persona(b.competicion, b.b, b.bn, b.genero, b.fuente);
        if (a !== null && bb === a) bb = b.bp;
        const nuevaA = b.ap ? null : a;
        const nuevaB = b.bp ? null : bb;
        if (nuevaA === null && nuevaB === null) continue;
        if (nuevaA !== null && nuevaA === (b.bp ?? nuevaB)) continue;
        ma.run(b.id, nuevaA, nuevaB);
        lados += (nuevaA ? 1 : 0) + (nuevaB ? 1 : 0);
      }
      this.db.prepare(
        `UPDATE sport_bout SET fencer_a_person_id = coalesce(sport_bout.fencer_a_person_id, m.a),
                               fencer_b_person_id = coalesce(sport_bout.fencer_b_person_id, m.b)
           FROM temp._mapa_asalto m WHERE m.id = sport_bout.id`,
      ).run();
      inf.asaltosLadoVinculados = lados;
      this.db.exec('DROP TABLE temp._mapa_asalto');
    });
    return resolucion;
  }

  pasoFusionPdf(inf: InformeUnificacion['fusionPdf']): void {
    const creadas = [...this.personas.values()].filter(
      (p) => !p.fusionada && FUENTES_NOMBRE.some((f) => p.fuentesAlias.has(f)) && !this.conIdExterno.has(p.id),
    );
    if (creadas.length === 0) return;
    // Destinos: raíces con ID FIE (ESP) o licencia RFEE, con las variantes de todo su grupo.
    const grupos = new Map<string, { genero: Genero | null; variantes: Set<string> }>();
    for (const p of this.personas.values()) {
      if (!(this.conLicencia.has(p.id) || (this.conFie.has(p.id) && p.pais === 'ESP'))) continue;
      const r = this.raiz(p.id);
      const raiz = this.personas.get(r)!;
      const g = grupos.get(r) ?? { genero: raiz.genero, variantes: new Set<string>() };
      for (const v of p.variantes) g.variantes.add(v);
      for (const v of raiz.variantes) g.variantes.add(v);
      grupos.set(r, g);
    }
    const exacto = new Map<string, Set<string>>();
    const palabra = new Map<string, Set<string>>();
    const conjuntos = new Map<string, Set<string>[]>();
    for (const [r, g] of grupos) {
      const cs: Set<string>[] = [];
      for (const v of g.variantes) {
        (exacto.get(v) ?? exacto.set(v, new Set()).get(v)!).add(r);
        const ws = new Set(v.split(' '));
        cs.push(ws);
        for (const w of ws) (palabra.get(w) ?? palabra.set(w, new Set()).get(w)!).add(r);
      }
      conjuntos.set(r, cs);
    }
    const compatible = (r: string, g: Genero | null) => {
      const rg = grupos.get(r)!.genero;
      return g === null || rg === null || rg === g;
    };
    const propuestas = new Map<string, { destino: string; exacta: boolean }>();
    const porDestino = new Map<string, number>();
    for (const p of creadas) {
      let cands = [...(exacto.get(p.norm) ?? [])].filter((r) => compatible(r, p.genero));
      let exacta = true;
      const ws = p.norm.split(' ');
      if (cands.length === 0 && ws.length >= 3) {
        exacta = false;
        let menor: Set<string> | undefined;
        for (const w of ws) {
          const s = palabra.get(w);
          if (!s) { menor = new Set(); break; }
          if (!menor || s.size < menor.size) menor = s;
        }
        cands = [...(menor ?? [])].filter(
          (r) => compatible(r, p.genero) && conjuntos.get(r)!.some((c) => esSubconjunto(ws, c)),
        );
      }
      if (cands.length > 1) {
        inf.ambiguas += 1;
        this.transaccion(() => {
          for (const c of cands.slice(0, 10)) this.candidato('fusion_rfee_pdf', p.id, p.nombre, c, 'PROPUESTO', 'nombre_varias_candidatas');
        });
        continue;
      }
      if (cands.length === 1) {
        propuestas.set(p.id, { destino: cands[0], exacta });
        porDestino.set(cands[0], (porDestino.get(cands[0]) ?? 0) + 1);
      }
    }
    this.transaccion(() => {
      for (const [pid, { destino, exacta }] of propuestas) {
        if (!exacta && porDestino.get(destino)! > 1) {
          inf.ambiguas += 1;
          continue;
        }
        if (this.fundir(pid, destino)) {
          inf.fusiones += 1;
          this.candidato('fusion_rfee_pdf', pid, this.personas.get(pid)!.nombre, this.raiz(destino), 'CONFIRMADO',
            exacta ? 'nombre_normalizado_unico' : 'nombre_superconjunto_unico');
        }
      }
    });
  }
}

/**
 * Una persona no puede tener dos puestos en la misma prueba individual. En rfee_pdf todo
 * vínculo es por nombre, así que dos puestos con la misma raíz son dos tiradores que el
 * nombre (truncado o con los apellidos en otro orden) no distingue: se desvinculan los
 * puestos y los asaltos de esa persona en esa prueba.
 */
export function desvincularColisionesPdf(db: DatabaseSync): InformeUnificacion['colisionesPdf'] {
  const inf = { pruebas: 0, resultados: 0, asaltosLado: 0 };
  const colisiones = db.prepare(
    `SELECT r.competition_id comp, coalesce(p.merged_into_person_id, p.id) raiz, group_concat(r.id, ',') ids
       FROM sport_result r JOIN sport_person p ON p.id = r.person_id JOIN sport_competition c ON c.id = r.competition_id
      WHERE r.source = 'rfee_pdf' AND c.format = 'INDIVIDUAL'
      GROUP BY 1, 2 HAVING count(*) > 1`,
  ).all() as { comp: string; raiz: string; ids: string }[];
  if (colisiones.length === 0) return inf;
  const resultado = db.prepare('UPDATE sport_result SET person_id = NULL WHERE id = ?');
  const ladoA = db.prepare(
    `UPDATE sport_bout SET fencer_a_person_id = NULL WHERE competition_id = ? AND source = 'rfee_pdf' AND fencer_a_person_id IN
       (SELECT id FROM sport_person WHERE id = ? OR merged_into_person_id = ?)`,
  );
  const ladoB = db.prepare(
    `UPDATE sport_bout SET fencer_b_person_id = NULL WHERE competition_id = ? AND source = 'rfee_pdf' AND fencer_b_person_id IN
       (SELECT id FROM sport_person WHERE id = ? OR merged_into_person_id = ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const c of colisiones) {
      inf.pruebas += 1;
      for (const id of c.ids.split(',')) inf.resultados += Number(resultado.run(id).changes);
      inf.asaltosLado += Number(ladoA.run(c.comp, c.raiz, c.raiz).changes) + Number(ladoB.run(c.comp, c.raiz, c.raiz).changes);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return inf;
}

export function unificarPersonas(db: DatabaseSync): InformeUnificacion {
  const inicio = Date.now();
  const informe: InformeUnificacion = {
    antes: medir(db),
    despues: undefined as unknown as Medida,
    fie: { idsDistintos: 0, personasReutilizadas: 0, personasCreadas: 0, aliasNuevos: 0, resultadosVinculados: 0, asaltosLadoVinculados: 0 },
    fusionLicencia: { licenciasConVarias: 0, fusiones: 0, omitidas: 0 },
    fusionFieRfee: { fusiones: 0, exactas: 0, superconjunto: 0, ambiguas: 0, omitidasPorAtleta: 0 },
    pdf: {
      gruposNombre: 0, vinculadosExacto: 0, vinculadosSuperconjunto: 0, personasCreadas: 0, ambiguos: 0,
      nombresCortos: 0, resultadosVinculados: 0, asaltosLadoVinculados: 0, puestosAmbiguosEnPrueba: 0,
    },
    fusionPdf: { fusiones: 0, ambiguas: 0 },
    colisionesPdf: { pruebas: 0, resultados: 0, asaltosLado: 0 },
    solapes: undefined as unknown as InformeDepuracion,
    solapesEngarde: undefined as unknown as InformeSolapesEngarde,
    candidatosRegistrados: 0,
    segundos: 0,
  };
  const u = new Unificador(db);
  u.pasoFie(informe.fie);
  u.pasoFusionLicencia(informe.fusionLicencia);
  u.pasoFusionFieRfee(informe.fusionFieRfee);
  // Antes del paso por nombre: las pruebas Engarde repetidas no deben crear personas.
  informe.solapesEngarde = depurarSolapesEngarde(db);
  u.pasoPdf(informe.pdf);
  u.pasoFusionPdf(informe.fusionPdf);
  informe.colisionesPdf = desvincularColisionesPdf(db);
  informe.solapes = depurarSolapes(db);
  informe.candidatosRegistrados = u.candidatos;
  informe.despues = medir(db);
  informe.segundos = Math.round((Date.now() - inicio) / 100) / 10;
  return informe;
}

function main(): void {
  const rutaDb = argumento('nuevo', argumento('db', NUEVO_POR_DEFECTO));
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'unificacion-informe.json'));
  const db = new DatabaseSync(rutaDb);
  prepararCopiaTrabajo(db);
  restaurarGuardia(db);
  quitarGuardia(db);
  let informe: InformeUnificacion;
  try {
    informe = unificarPersonas(db);
  } finally {
    restaurarGuardia(db);
    db.close();
  }
  writeFileSync(salida, JSON.stringify(informe, null, 2));
  console.log(JSON.stringify(informe, null, 2));
  console.log(`Informe: ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
