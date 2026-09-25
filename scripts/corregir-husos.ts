import 'dotenv/config';
import { eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../src/db';
import { event } from '../src/db/schema';
import { timezoneForCountry } from '../src/lib/ingest/mappers';

/**
 * Corrige los husos horarios imposibles que dejó la API de la FIE.
 *
 *   npx tsx scripts/corregir-husos.ts            -> solo enseña qué haría
 *   npx tsx scripts/corregir-husos.ts --aplicar  -> lo escribe
 *
 * Qué pasaba: la FIE devuelve `"Asia\/Riyadh"` —con la barra escapada, que ya
 * de por sí no es un identificador IANA válido— como valor de relleno cuando
 * no sabe dónde se tira el torneo. Estaba guardado en 36 filas: las 34 que
 * todavía tienen la sede sin decidir, Reikiavik y San Salvador.
 *
 * Con esos valores puestos, el aviso de diferencia horaria de la app dice una
 * mentira. Y desde que el mismo torneo de Skermo y el de la FIE se colapsan en
 * una tarjeta, la mentira se propagaba también a la ficha española.
 *
 * Qué hace: recalcula el huso a partir del país, que sí se lee bien, y lo deja
 * a null cuando el país no está en la tabla. No inventa ninguno: sin huso, la
 * app simplemente no enseña el aviso, que es la verdad.
 *
 * El arreglo de raíz está en `src/lib/ingest/sources/fie.ts`, que ya no usa el
 * huso de la FIE ni como respaldo. Este script es solo para lo ya ingerido.
 */

const aplicar = process.argv.includes('--aplicar');

/** Un identificador IANA de verdad: `Región/Ciudad`, sin barras invertidas. */
const IANA = /^[A-Za-z]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?$/;

const filas = await db
  .select({
    id: event.id,
    name: event.name,
    city: event.city,
    country: event.country,
    timezone: event.timezone,
  })
  .from(event)
  .where(isNotNull(event.timezone));

const cambios = filas
  .filter((f) => f.timezone !== null && !IANA.test(f.timezone))
  .map((f) => ({ ...f, nuevo: timezoneForCountry(f.country) }));

console.log(`\n== ${cambios.length} filas con un huso imposible ==`);
const resumen = new Map<string, number>();
for (const c of cambios) {
  const clave = `${c.timezone} -> ${c.nuevo ?? 'null (sin dato, no se inventa)'}  [país ${c.country ?? 'desconocido'}]`;
  resumen.set(clave, (resumen.get(clave) ?? 0) + 1);
}
for (const [clave, n] of [...resumen.entries()].sort()) {
  console.log(`  ${String(n).padStart(3)} × ${clave}`);
}

if (!aplicar) {
  console.log('\nEnsayo. Vuelve a lanzarlo con --aplicar para escribirlo.');
  process.exit(0);
}

const porDestino = new Map<string | null, string[]>();
for (const c of cambios) {
  const lista = porDestino.get(c.nuevo) ?? [];
  lista.push(c.id);
  porDestino.set(c.nuevo, lista);
}

for (const [destino, ids] of porDestino) {
  await db
    .update(event)
    .set({ timezone: destino })
    .where(ids.length === 1 ? eq(event.id, ids[0]) : inArray(event.id, ids));
  console.log(`  escritas ${ids.length} filas -> ${destino ?? 'null'}`);
}

console.log('\nHecho.');
