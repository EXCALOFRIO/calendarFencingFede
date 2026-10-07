/**
 * Lote 13, punto 2: copias nacionales del mismo evento a 3 días (PDF de la RFEE frente a Engarde),
 * que `dedupe-pruebas.ts` no fundía (±2 días). La regla de 3 días es `mismoEvento` con
 * `ESTRICTO` (mismo género y categoría, 8+ nombres, 90 % en común en los dos sentidos).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-duplicados.ts [--db <nuevo13.sqlite>] [--informe <json>]
 *   node node_modules/tsx/dist/cli.mjs scripts/indexado/lote13-duplicados.ts --db <copia.sqlite> --aplicar [--informe <json>]
 *
 * Ensayo por defecto (sólo lectura): los pares a 3 días que casan, los grupos que formarían y lo
 * que `fundirDuplicados` haría con ellos (simulado). Con `--aplicar` (nunca en las bases
 * protegidas) `fundirDuplicados` sólo sobre esos grupos (`soloCon`), con las conjuntas de Engarde
 * excluidas como en `unificar-personas.ts`. Idempotente: tras fundir, las copias ya no existen.
 * Después: `vincular-asaltos.ts` como siempre.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { argumento, bandera } from './comun';
import { hayTablaConjuntas, TABLA_CONJUNTAS } from './dedupe-conjuntas';
import {
  cargarPruebasNacionales,
  emparejarDuplicados,
  enlacesDelCatalogo,
  fundirDuplicados,
  leerCatalogoNacional,
  mismoEvento,
  nombresEnComun,
  VENTANA_NORMAL,
  type InformeDuplicados,
  type PruebaNacional,
} from './dedupe-pruebas';
import { asegurarCarpetaInformes, conBase, corto, NUEVO13 } from './lote13-comun';

const dia = (f: string) => Math.round(Date.parse(`${f.slice(0, 10)}T00:00:00Z`) / 86_400_000);

export type ParTresDias = { a: string; b: string; comunes: number; nombres: [number, number]; texto: string };

/** Pares de pruebas a más de `VENTANA_NORMAL` días que `mismoEvento` casa (sólo puede ser con la regla estricta). */
export function paresTresDias(pruebas: readonly PruebaNacional[]): ParTresDias[] {
  const porClave = new Map<string, PruebaNacional[]>();
  for (const p of pruebas) {
    const k = `${p.weapon}|${p.category}`;
    (porClave.get(k) ?? porClave.set(k, []).get(k)!).push(p);
  }
  const out: ParTresDias[] = [];
  const describir = (p: PruebaNacional) => `${p.source}:${corto(p.id)} ${p.competition_key} ${p.weapon} ${p.gender} ${p.category} ${p.fecha}`;
  for (const lista of porClave.values()) {
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        if (Math.abs(dia(lista[i].fecha) - dia(lista[j].fecha)) <= VENTANA_NORMAL) continue;
        const comunes = mismoEvento(lista[i], lista[j]);
        if (comunes === 0) continue;
        const [x, y] = lista[i].id < lista[j].id ? [lista[i], lista[j]] : [lista[j], lista[i]];
        out.push({ a: x.id, b: y.id, comunes, nombres: [x.nombres.length, y.nombres.length],
          texto: `${describir(x)} ≈ ${describir(y)}: ${comunes} en común (${nombresEnComun(x.nombres, y.nombres)}/${x.nombres.length}, ${nombresEnComun(y.nombres, x.nombres)}/${y.nombres.length})` });
      }
    }
  }
  return out.sort((p, q) => (p.texto < q.texto ? -1 : 1));
}

export function conjuntasEngarde(db: DatabaseSync): Set<string> {
  if (!hayTablaConjuntas(db)) return new Set();
  return new Set((db.prepare(
    `SELECT DISTINCT k.combined_competition_id id FROM ${TABLA_CONJUNTAS} k JOIN sport_competition c ON c.id = k.combined_competition_id WHERE c.source = 'engarde'`,
  ).all() as { id: string }[]).map((r) => r.id));
}

export type InformeDuplicados13 = {
  pares: ParTresDias[];
  grupos: { destino: string; otras: string[] }[];
  fusion: InformeDuplicados;
};

function main(): void {
  const rutaDb = argumento('db', NUEVO13);
  const aplicar = bandera('aplicar');
  const carpeta = asegurarCarpetaInformes();
  const catalogo = leerCatalogoNacional();
  const inf = conBase(rutaDb, aplicar, (db): InformeDuplicados13 => {
    const excluir = conjuntasEngarde(db);
    const pruebas = cargarPruebasNacionales(db).filter((p) => !excluir.has(p.id));
    const pares = paresTresDias(pruebas);
    const soloCon = new Set(pares.flatMap((p) => [p.a, p.b]));
    const { grupos } = emparejarDuplicados(pruebas, 0.5, enlacesDelCatalogo(pruebas, catalogo));
    const afectados = grupos.filter((g) => [g.destino, ...g.otras].some((p) => soloCon.has(p.id)))
      .map((g) => ({ destino: `${g.destino.source}:${corto(g.destino.id)}`, otras: g.otras.map((o) => `${o.source}:${corto(o.id)}`) }));
    const fusion = fundirDuplicados(db, { simular: !aplicar, catalogo, excluir, soloCon });
    return { pares, grupos: afectados, fusion };
  }, { transaccion: false });
  const salida = argumento('informe', join(carpeta, aplicar ? 'duplicados-aplicado.json' : 'duplicados-ensayo.json'));
  writeFileSync(salida, JSON.stringify(inf, null, 2));
  const f = inf.fusion;
  console.log(JSON.stringify({
    pares: inf.pares.length, grupos: inf.grupos.length, gruposOmitidosRondasDistintas: f.gruposOmitidosRondasDistintas,
    gruposOmitidosPuestosDistintos: f.gruposOmitidosPuestosDistintos, gruposConVariasSkermo: f.gruposConVariasSkermo, porFuentes: f.porFuentes,
    fasesTrasladadas: f.fasesTrasladadas, asaltosTrasladados: f.asaltosTrasladados, resultadosDuplicadosBorrados: f.resultadosDuplicadosBorrados,
    resultadosTrasladados: f.resultadosTrasladados, resultadosPuestoOcupado: f.resultadosPuestoOcupado, competicionesBorradas: f.competicionesBorradas,
  }, null, 2));
  for (const p of inf.pares) console.log(p.texto);
  if (!aplicar) console.log(`Ensayo: nada guardado. Informe: ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
