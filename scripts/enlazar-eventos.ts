import 'dotenv/config';
import { recalcularEnlaces } from '../src/lib/ingest/enlazar';

/**
 * Recalcula a mano el emparejado entre los registros de Skermo y los de la FIE
 * e imprime la lista COMPLETA de pares para revisarla a ojo.
 *
 *   npx tsx scripts/enlazar-eventos.ts
 *
 * No borra nada: recalcula. Volver a ejecutarlo dos veces seguidas da el mismo
 * resultado, que es justo lo que se quiere de un emparejador que corre en cada
 * ingestión.
 */
const r = await recalcularEnlaces();

console.log('\n== PARES ENLAZADOS ==');
for (const p of [...r.pares].sort((a, b) => a.canonicalLabel.localeCompare(b.canonicalLabel))) {
  console.log(`\n  Skermo : ${p.canonicalLabel}`);
  console.log(`  FIE    : ${p.linkedLabel}`);
  console.log(`  regla  : ${p.rule}${p.aportaCartel ? '  [aporta cartel]' : ''}`);
}

console.log('\n== DUDOSOS (NO se han unido) ==');
if (r.dudas.length === 0) console.log('  ninguno');
for (const d of r.dudas) {
  console.log(`\n  Skermo : ${d.canonicalLabel}`);
  console.log(`  FIE    : ${d.linkedLabel}`);
  console.log(`  motivo : ${d.note}`);
}

console.log('\n== RESUMEN ==');
console.log(`  filas de la FIE absorbidas : ${r.enlazados}`);
console.log(`  tarjetas con dos fuentes   : ${r.gruposConEnlace}`);
console.log(`  eventos que ganan cartel   : ${r.cartelesHeredados}`);
console.log(`  candidatos dudosos         : ${r.dudosos}`);
console.log(`  confirmados a mano         : ${r.confirmadosAMano}`);
console.log(`  rechazados a mano          : ${r.rechazadosAMano}`);
