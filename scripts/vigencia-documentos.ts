/**
 * Recalcula qué circulares están en vigor, cuáles han quedado superadas y
 * cuáles están canceladas.
 *
 *   npx tsx scripts/vigencia-documentos.ts
 *
 * Normalmente no hace falta lanzarlo a mano: la ingestión de `rfee_wp` lo llama
 * sola cada noche, porque depende solo de los títulos y las fechas que acaba de
 * escribir. Está aquí para poder recalcular después de una pasada de hashes
 * —que es cuando aparecen los duplicados exactos— y para poder comprobar el
 * resultado sin esperar al cron.
 *
 * NO DESCARGA NADA y NO LLAMA A NINGÚN MODELO: solo mira lo que ya está en la
 * base. Es una lectura, el cálculo en memoria y dos escrituras en lote.
 */
import 'dotenv/config';
import { recalcularVigencia } from '../src/lib/documentos/recalcular';

const r = await recalcularVigencia();

const n = (v: number) => new Intl.NumberFormat('es-ES').format(v);

console.log('Vigencia de las circulares recalculada.');
console.log('');
console.log(`  Documentos            ${n(r.total)}`);
console.log(`  Familias              ${n(r.familias)}`);
console.log(`  Con varias versiones  ${n(r.familiasConVarias)}`);
console.log('');
console.log(`  En vigor              ${n(r.vigentes)}`);
console.log(`  Superadas             ${n(r.superadas)}`);
console.log(`  Canceladas            ${n(r.canceladas)}`);
console.log(`  Duplicadas exactas    ${n(r.duplicadas)}`);
console.log('');
console.log(`  Coste: ${r.consultas} consultas a la base, ${r.duracionMs} ms, 0 descargas.`);
