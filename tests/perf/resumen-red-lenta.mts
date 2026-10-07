/** Dos JSON completos del arnés local → comparación; no mezcla perfiles de red. */
import { readFileSync } from 'node:fs';
const [antesRuta, despuesRuta] = process.argv.slice(2);
if (!antesRuta || !despuesRuta) throw new Error('uso: resumen-red-lenta.mts antes.json despues.json');
type Medida = { operacion: string; ms: number; peticiones: number; dinamicas: number; bytes: number; bloqueoMs: number };
type Informe = { repeticiones: number; red: unknown; resultados: Medida[]; errores: string[]; completo?: boolean };
const antes = JSON.parse(readFileSync(antesRuta, 'utf8')) as Informe;
const despues = JSON.parse(readFileSync(despuesRuta, 'utf8')) as Informe;
for (const x of [antes, despues]) {
  if (x.completo === false || x.errores.length || x.resultados.length !== 7 * x.repeticiones) throw new Error('medicion_incompleta');
}
if (JSON.stringify(antes.red) !== JSON.stringify(despues.red) || antes.repeticiones !== despues.repeticiones) {
  throw new Error('condiciones_distintas');
}
const mediana = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b);
  return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const comparacion = (a: Medida[], b: Medida[], campo: keyof Omit<Medida, 'operacion'>, divisor = 1) =>
  `${Math.round(mediana(a.map((x) => x[campo])) / divisor)} → ${Math.round(mediana(b.map((x) => x[campo])) / divisor)}`;
console.log(`Medianas de ${antes.repeticiones} repeticiones locales por operación. Datos, red y CPU iguales.`);
console.log('| Operación | Tiempo ms | Peticiones | Dinámicas | KiB transferidos | Bloqueo >50 ms |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const op of new Set(antes.resultados.map((m) => m.operacion))) {
  const a = antes.resultados.filter((m) => m.operacion === op);
  const b = despues.resultados.filter((m) => m.operacion === op);
  if (a.length !== b.length) throw new Error(`operacion_incompleta:${op}`);
  console.log(`| ${op} | ${comparacion(a, b, 'ms')} | ${comparacion(a, b, 'peticiones')} | ${comparacion(a, b, 'dinamicas')} | ${comparacion(a, b, 'bytes', 1024)} | ${comparacion(a, b, 'bloqueoMs')} |`);
}
