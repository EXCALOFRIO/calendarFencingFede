import 'dotenv/config';
import {
  depsInventarioFieRed,
  depsInventarioSkermoRed,
  federacionesSkermo,
} from '../src/lib/ingest/historico-red';
import {
  inventariarFie,
  inventariarSkermo,
  resumirInventario,
  type ResultadoInventario,
} from '../src/lib/ingest/sources/historico-indice';

/**
 * Inventario de fuentes históricas (temporadas, federaciones, pruebas y
 * documentos) de Skermo y la FIE:
 *
 *   npm run inventario-historico -- --fuente skermo --max 40
 *   npm run inventario-historico -- --fuente fie --max 30 --temporadas 2027,2018
 *   npm run inventario-historico -- --fuente skermo --federaciones RFEE,FCE
 *   npm run inventario-historico -- --fuente skermo --aplicar
 *
 * Sin `--aplicar` sólo hace GET públicos e imprime recuentos agregados (ni
 * nombres ni filas). `--aplicar` guarda sólo la cobertura `index` por
 * temporada y exige el esquema 0017 aplicado por el propietario.
 * `--max` limita las peticiones de esta ejecución: no recorta temporadas, lo
 * no leído sale como pendiente.
 */

const args = process.argv.slice(2);
const valor = (nombre: string) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fuente = valor('fuente') ?? 'skermo';
const max = valor('max') ? Number(valor('max')) : undefined;
const delayMs = Number(valor('delay') ?? 300);
const aplicar = args.includes('--aplicar');
const lista = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

if (!['skermo', 'fie'].includes(fuente) || (max !== undefined && !Number.isInteger(max))) {
  console.error('Uso: npm run inventario-historico -- --fuente skermo|fie [--max N] [--delay ms] [--federaciones A,B] [--temporadas 2027,2018] [--aplicar]');
  process.exit(1);
}

let resultado: ResultadoInventario;
if (fuente === 'fie') {
  const temporadas = lista(valor('temporadas'))?.map(Number);
  resultado = await inventariarFie(depsInventarioFieRed, { maxPeticiones: max, delayMs, temporadas });
} else {
  const fed = lista(valor('federaciones'));
  const todas = federacionesSkermo();
  resultado = await inventariarSkermo(
    depsInventarioSkermoRed,
    fed ? fed.map((c) => todas.find((f) => f.codigo === c) ?? { codigo: c, verificada: false }) : todas,
    { maxPeticiones: max, delayMs },
  );
}

console.log(`Inventario ${fuente}: ${resultado.peticiones} peticiones`);
for (const u of resultado.unidades) {
  console.log(
    `  ${u.federacion}/${u.temporada || '*'} ${u.estado} filas=${u.filas} publicado=${u.publicado ?? '-'} ` +
      `html=${u.enlaces.html} pdf=${u.enlaces.pdf} externo=${u.enlaces.externo} api=${u.enlaces.api} ` +
      `sinDoc=${u.sinDocumento}${u.error ? ` error=${u.error}` : ''}`,
  );
}
console.log('Resumen:', JSON.stringify(resumirInventario(resultado)));

if (!aplicar) {
  console.log('Modo lectura: no se ha escrito nada. Añade --aplicar para guardar la cobertura del índice.');
} else {
  const { db } = await import('../src/db');
  const { esquemaDeportivo } = await import('../src/lib/sport/esquema-db');
  const { guardarInventario } = await import('../src/lib/ingest/inventario-historico-db');
  if (!(await esquemaDeportivo()).identidad) {
    console.log('El esquema deportivo (migración 0017) no está aplicado: no se escribió nada.');
    process.exitCode = 2;
  } else {
    console.log('Guardado:', JSON.stringify(await guardarInventario(db, resultado.unidades)));
  }
}
