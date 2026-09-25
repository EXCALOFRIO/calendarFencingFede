import 'dotenv/config';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../src/db';
import { event } from '../src/db/schema';
import { inferScope, refineCircuitByName } from '../src/lib/ingest/mappers';

/**
 * Reclasifica el circuito de lo YA ingerido aplicando las reglas de nombre.
 *
 *   npx tsx scripts/reclasificar-circuitos.ts          -> solo enseña qué haría
 *   npx tsx scripts/reclasificar-circuitos.ts --aplicar -> lo escribe
 *
 * Es el mismo `refineCircuitByName` que usa la ingestión, así que ejecutarlo
 * dos veces no cambia nada: la segunda pasada no encuentra nada que tocar.
 *
 * No borra ni inventa: solo cambia `circuit` (y `scope`, si el circuito nuevo
 * implica que la prueba es internacional) en las filas cuyo NOMBRE lo dice
 * explícitamente. Lo que no encaja en ninguna regla se queda como está.
 */

const aplicar = process.argv.includes('--aplicar');

const filas = await db
  .select({
    id: event.id,
    source: event.source,
    name: event.name,
    circuit: event.circuit,
    scope: event.scope,
  })
  .from(event);

type Cambio = {
  id: string;
  name: string;
  de: string;
  a: string;
  scopeDe: string;
  scopeA: string;
};

const cambios: Cambio[] = [];

for (const f of filas) {
  // La FIE publica su propio tipo y ya viene bien clasificada; estas reglas
  // están escritas contra los nombres en español de Skermo.
  if (f.source === 'fie') continue;

  const nuevo = refineCircuitByName(f.name, f.circuit);
  if (nuevo === f.circuit) continue;

  const scopeNuevo = inferScope(nuevo, f.scope);
  cambios.push({
    id: f.id,
    name: f.name,
    de: f.circuit,
    a: nuevo,
    scopeDe: f.scope,
    scopeA: scopeNuevo,
  });
}

const resumen = new Map<string, number>();
for (const c of cambios) {
  const clave = `${c.name}  ::  ${c.de} -> ${c.a}`;
  resumen.set(clave, (resumen.get(clave) ?? 0) + 1);
}

console.log(`\n== ${cambios.length} filas cambian de circuito ==`);
for (const [clave, n] of [...resumen.entries()].sort()) {
  console.log(`  ${String(n).padStart(3)} × ${clave}`);
}

const cambiosDeScope = cambios.filter((c) => c.scopeDe !== c.scopeA);
if (cambiosDeScope.length > 0) {
  console.log(`\n  (${cambiosDeScope.length} cambian además de ámbito)`);
  for (const c of cambiosDeScope) {
    console.log(`    ${c.name}: ${c.scopeDe} -> ${c.scopeA}`);
  }
}

if (!aplicar) {
  console.log('\nEnsayo. Vuelve a lanzarlo con --aplicar para escribirlo.');
  process.exit(0);
}

/**
 * Se escribe agrupando por destino: son unas pocas sentencias en lote, no un
 * UPDATE por fila. El driver de Neon es HTTP y cada consulta es un viaje.
 */
const porDestino = new Map<string, string[]>();
for (const c of cambios) {
  const clave = `${c.a}|${c.scopeA}`;
  const lista = porDestino.get(clave) ?? [];
  lista.push(c.id);
  porDestino.set(clave, lista);
}

for (const [clave, ids] of porDestino) {
  const [circuito, ambito] = clave.split('|');
  await db
    .update(event)
    .set({
      circuit: circuito as typeof event.$inferInsert.circuit,
      scope: ambito as typeof event.$inferInsert.scope,
    })
    .where(ids.length === 1 ? eq(event.id, ids[0]) : inArray(event.id, ids));
  console.log(`  escritas ${ids.length} filas -> ${circuito} / ${ambito}`);
}

console.log('\nHecho.');
