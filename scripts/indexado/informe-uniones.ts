/**
 * Informe de uniones de personas entre dos copias (solo lectura): qué fusiones son nuevas y
 * cuáles se deshicieron, con los nombres originales de cada lado (nombre visible y alias, con
 * su fuente) y la evidencia del candidato que la decidió (`sport_link_candidate`).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/informe-uniones.ts --antes <a.sqlite> --despues <b.sqlite> \
 *     [--informe <uniones-informe.json>] [--ejemplos 2000]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, CARPETA_TRABAJO } from './comun';
import { mejorRelacion } from './nombres-union';

type Lado = { id: string; nombres: string[] };
export type UnionCambiada = {
  persona: Lado; raiz: Lado;
  /** Evidencia del candidato (fusión nueva) o de la separación (`separacion_nombre`). */
  evidencia: string; fuente: string;
  /** Relación entre los nombres (el par más compatible, `nombres-union.ts`). */
  relacion: string | null;
};
export type InformeUniones = {
  personas: { antes: number; despues: number; soloAntes: number; soloDespues: number };
  nuevas: { total: number; porEvidencia: Record<string, number>; porRelacion: Record<string, number>; ejemplos: UnionCambiada[] };
  deshechas: { total: number; porEvidencia: Record<string, number>; porRelacion: Record<string, number>; ejemplos: UnionCambiada[] };
};

type Base = {
  db: DatabaseSync;
  fundida: Map<string, string | null>;
  nombres: Map<string, { nombre: string; fuente: string | null }[]>;
};

function cargar(db: DatabaseSync): Base {
  const fundida = new Map<string, string | null>();
  const nombres = new Map<string, { nombre: string; fuente: string | null }[]>();
  for (const p of db.prepare(`SELECT id, display_name n, merged_into_person_id m FROM sport_person`).iterate() as Iterable<{ id: string; n: string; m: string | null }>) {
    fundida.set(p.id, p.m);
    nombres.set(p.id, p.n ? [{ nombre: p.n, fuente: null }] : []);
  }
  for (const a of db.prepare(`SELECT person_id p, source s, name_original n FROM sport_person_alias`).iterate() as Iterable<{ p: string; s: string; n: string | null }>) {
    const l = nombres.get(a.p);
    if (l && a.n && !l.some((x) => x.nombre === a.n)) l.push({ nombre: a.n, fuente: a.s });
  }
  return { db, fundida, nombres };
}

function raizEn(b: Base, id: string): string {
  let a = id;
  for (let i = 0; i < 4; i += 1) {
    const m = b.fundida.get(a);
    if (!m) return a;
    a = m;
  }
  return a;
}

const tipo = (evidencia: string) => evidencia.split(/[:|]/)[0] || 'sin_evidencia';

export function informeUniones(antes: DatabaseSync, despues: DatabaseSync, maxEjemplos = 2000): InformeUniones {
  const A = cargar(antes);
  const B = cargar(despues);
  const inf: InformeUniones = {
    personas: { antes: A.fundida.size, despues: B.fundida.size, soloAntes: 0, soloDespues: 0 },
    nuevas: { total: 0, porEvidencia: {}, porRelacion: {}, ejemplos: [] },
    deshechas: { total: 0, porEvidencia: {}, porRelacion: {}, ejemplos: [] },
  };
  for (const id of A.fundida.keys()) if (!B.fundida.has(id)) inf.personas.soloAntes += 1;
  for (const id of B.fundida.keys()) if (!A.fundida.has(id)) inf.personas.soloDespues += 1;
  const candidato = despues.prepare(
    `SELECT source s, evidence e FROM sport_link_candidate WHERE source_ref = ? AND person_id = ? ORDER BY created_at DESC LIMIT 1`,
  );
  const cualquiera = despues.prepare(
    `SELECT source s, evidence e FROM sport_link_candidate WHERE source_ref = ? AND status = 'CONFIRMADO' ORDER BY created_at DESC LIMIT 1`,
  );
  const lado = (b: Base, id: string): Lado => ({ id, nombres: (b.nombres.get(id) ?? []).map((x) => (x.fuente ? `${x.fuente}: ${x.nombre}` : x.nombre)) });
  const anotar = (destino: InformeUniones['nuevas'], b: Base, p: string, r: string, fuente: string, evidencia: string) => {
    const m = mejorRelacion(b.nombres.get(p) ?? [], b.nombres.get(r) ?? []);
    destino.total += 1;
    const k = `${fuente}:${tipo(evidencia)}`;
    destino.porEvidencia[k] = (destino.porEvidencia[k] ?? 0) + 1;
    const rel = m?.relacion ?? 'sin_nombres';
    destino.porRelacion[rel] = (destino.porRelacion[rel] ?? 0) + 1;
    if (destino.ejemplos.length < maxEjemplos) {
      destino.ejemplos.push({ persona: lado(b, p), raiz: lado(b, r), evidencia, fuente, relacion: m?.relacion ?? null });
    }
  };
  for (const p of B.fundida.keys()) {
    const rb = raizEn(B, p);
    const ra = A.fundida.has(p) ? raizEn(A, p) : p;
    if (rb === ra) continue;
    // Fusión nueva: en «después» apunta a una raíz a la que antes no apuntaba.
    if (rb !== p) {
      const c = (candidato.get(p, rb) ?? cualquiera.get(p)) as { s: string; e: string | null } | undefined;
      anotar(inf.nuevas, B, p, rb, c?.s ?? 'sin_candidato', c?.e ?? '');
    }
    // Fusión deshecha: antes apuntaba a otra raíz que ya no es la suya.
    if (ra !== p) {
      const c = candidato.get(p, ra) as { s: string; e: string | null } | undefined;
      anotar(inf.deshechas, A, p, ra, c?.s ?? (rb === p ? 'raiz' : 'otra_raiz'), c?.e ?? '');
    }
  }
  return inf;
}

function main(): void {
  const antes = new DatabaseSync(argumento('antes', join(CARPETA_TRABAJO, 'nuevo.sqlite')), { readOnly: true });
  const despues = new DatabaseSync(argumento('despues', join(CARPETA_TRABAJO, 'nuevo.sqlite')), { readOnly: true });
  const salida = argumento('informe', join(CARPETA_TRABAJO, 'uniones-informe.json'));
  const inf = informeUniones(antes, despues, Number(argumento('ejemplos', '2000')));
  antes.close();
  despues.close();
  writeFileSync(salida, JSON.stringify(inf, null, 2));
  const resumen = (x: InformeUniones['nuevas']) => ({ ...x, ejemplos: x.ejemplos.slice(0, 10) });
  console.log(JSON.stringify({ personas: inf.personas, nuevas: resumen(inf.nuevas), deshechas: resumen(inf.deshechas) }, null, 2));
  console.log(`Informe: ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
