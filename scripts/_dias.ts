/** Reparto de días de competición por día de la semana. Temporal. */
import 'dotenv/config';
import { db } from '../src/db';
import { event } from '../src/db/schema';
import { inArray } from 'drizzle-orm';

const filas = await db
  .select({ s: event.startDate, e: event.endDate })
  .from(event)
  .where(inArray(event.scope, ['NACIONAL', 'INTERNACIONAL']));

const dias = [0, 0, 0, 0, 0, 0, 0];
const arranques = [0, 0, 0, 0, 0, 0, 0];
let total = 0;
for (const f of filas) {
  const a = new Date(`${f.s}T12:00:00`);
  const b = new Date(`${(f.e ?? f.s)}T12:00:00`);
  arranques[(a.getDay() + 6) % 7] += 1;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    dias[(d.getDay() + 6) % 7] += 1;
    total += 1;
  }
}
const N = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
console.log(`eventos ${filas.length} · días-evento ${total}`);
console.log('día  ocupados  %      arranques');
for (let i = 0; i < 7; i += 1) {
  console.log(
    `${N[i]}    ${String(dias[i]).padStart(4)}   ${((dias[i] / total) * 100).toFixed(1).padStart(5)}%  ${String(arranques[i]).padStart(4)}`,
  );
}
process.exit(0);
