/**
 * Regenera la tabla ISO2 → código FIE de `src/components/bandera.tsx`.
 *
 *   node scripts/regenerar-paises.cjs
 *
 * La imprime por pantalla para pegarla; no pisa el fichero a propósito,
 * porque alrededor de la tabla hay comentarios que explican por qué existe y
 * un guion no tiene que poder borrarlos.
 *
 * Existe porque la tabla buena —la que está comprobada contra los códigos que
 * publica la FIE— vive en `src/lib/ingest/mappers.ts` y va en el sentido
 * contrario (tres letras → dos). Mientras esa no se exporte, aquí hay una
 * copia invertida, y una copia solo es aceptable si regenerarla cuesta un
 * comando.
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(raiz, 'src/lib/ingest/mappers.ts'), 'utf8');

const i = src.indexOf('const FIE_COUNTRY_TO_ISO2');
const j = src.indexOf('};', i);
if (i < 0 || j < 0) {
  console.error(
    'No se encuentra FIE_COUNTRY_TO_ISO2 en src/lib/ingest/mappers.ts.\n' +
      'Si la han renombrado, hay que ajustar este guion.',
  );
  process.exit(1);
}

const pares = [...src.slice(i, j).matchAll(/^\s*([A-Z]{3}):\s*'([A-Z]{2})',/gm)].map((m) => [
  m[1],
  m[2],
]);

// Si dos códigos FIE apuntan al mismo ISO, gana el primero: la tabla original
// está ordenada por uso real, así que el primero es el que sale de verdad.
const inverso = {};
for (const [fie, iso] of pares) if (!(iso in inverso)) inverso[iso] = fie;

const filas = Object.entries(inverso).sort((a, b) => a[0].localeCompare(b[0]));
const lineas = [];
for (let k = 0; k < filas.length; k += 6) {
  lineas.push(
    '  ' +
      filas
        .slice(k, k + 6)
        .map(([iso, fie]) => `${iso}: '${fie}',`)
        .join(' '),
  );
}

console.log(`// ${filas.length} países, generado por scripts/regenerar-paises.cjs`);
console.log(lineas.join('\n'));
