/**
 * Pasa circulares DE VERDAD por el embudo de extracción, desde la línea de
 * órdenes y con la base de datos delante.
 *
 * No es un test automático (no vive en `*.test.ts` a propósito): es la
 * herramienta con la que se comprueba qué saca el modelo de las 278
 * circulares reales antes de encender el cron, y con la que se depura un
 * descarte concreto.
 *
 *   npx tsx tests/extraccion-real.mts                 # 3 circulares pendientes
 *   npx tsx tests/extraccion-real.mts 5               # 5
 *   npx tsx tests/extraccion-real.mts --texto 3       # solo vuelca el texto leído
 *   npx tsx tests/extraccion-real.mts --simular respuestas.json
 *
 * `--simular` inyecta respuestas guardadas en lugar de llamar al modelo. Sirve
 * para dos cosas: probar el embudo entero sin gastar una sola llamada, y
 * reproducir un fallo concreto con la respuesta exacta que lo provocó.
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import {
  VERSION_ESQUEMA,
  type ClienteModelo,
  crearClienteModelo,
  descargarPdf,
  documentosPendientesDeExtraer,
  extraerTextoDePdf,
  hashDocumento,
  huellaDeExtraccion,
  leerConfiguracionIa,
  pareceContenerDatosPersonales,
  procesarDocumentoOficial,
} from '../src/lib/ai/extract.ts';

const argumentos = process.argv.slice(2);
const soloTexto = argumentos.includes('--texto');
const indiceSimular = argumentos.indexOf('--simular');
const ficheroSimulado = indiceSimular >= 0 ? argumentos[indiceSimular + 1] : null;
const cuantas =
  Number.parseInt(argumentos.find((a) => /^\d+$/.test(a)) ?? '', 10) || 3;

const config = leerConfiguracionIa();
const huella = { hashPrompt: await huellaDeExtraccion(), versionEsquema: VERSION_ESQUEMA };

console.log('Proveedor:', config.proveedor);
console.log('Modelo:', config.modelo);
console.log('Extracción activa:', config.activa);
console.log('Huella del prompt:', `${huella.hashPrompt.slice(0, 16)}…`);
console.log('Versión del esquema:', huella.versionEsquema);
console.log('');

/**
 * `--titulo <trozo>` (repetible) elige circulares concretas en vez de las
 * siguientes pendientes. Sirve para volver una y otra vez sobre la misma
 * mientras se afina el prompt.
 */
const titulosPedidos = argumentos
  .map((a, i) => (a === '--titulo' ? argumentos[i + 1] : null))
  .filter((t): t is string => Boolean(t));

async function porTitulo(trozos: string[]) {
  const { db } = await import('../src/db/index.ts');
  const { officialDocument } = await import('../src/db/schema/index.ts');
  const { ilike, or } = await import('drizzle-orm');
  return db
    .select({
      id: officialDocument.id,
      titulo: officialDocument.title,
      pdfUrl: officialDocument.pdfUrl,
      eventId: officialDocument.eventId,
      fileHash: officialDocument.fileHash,
    })
    .from(officialDocument)
    .where(or(...trozos.map((t) => ilike(officialDocument.title, `%${t}%`))))
    .limit(20);
}

const pendientes =
  titulosPedidos.length > 0
    ? await porTitulo(titulosPedidos)
    : await documentosPendientesDeExtraer(cuantas, huella);
console.log(`Circulares en esta pasada: ${pendientes.length}\n`);

/**
 * Cliente falso alimentado por un fichero: `{ "<trozo de la url>": { … } }`.
 * La clave se busca por inclusión para no tener que copiar URLs enteras.
 */
async function clienteSimulado(ruta: string): Promise<ClienteModelo> {
  const guardadas = JSON.parse(await readFile(ruta, 'utf8')) as Record<string, unknown>;
  let urlActual = '';
  return {
    modelo: `${config.modelo} (simulado)`,
    async generarJson(peticion) {
      const clave = Object.keys(guardadas).find((k) => peticion.usuario.includes(k));
      if (!clave) throw new Error(`No hay respuesta guardada para ${urlActual}`);
      return JSON.stringify(guardadas[clave]);
    },
    async transcribirPdf() {
      throw new Error('El cliente simulado no transcribe escaneados.');
    },
  };
}

const cliente = ficheroSimulado
  ? await clienteSimulado(ficheroSimulado)
  : crearClienteModelo(config);

if (!soloTexto && !cliente) {
  console.log(
    'No hay modelo disponible. Hace falta el binding de Workers AI (dentro del ' +
      'Worker) o CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN con permiso de ' +
      'Workers AI. Se sigue igualmente para enseñar la lectura local.\n',
  );
}

for (const documento of pendientes) {
  console.log('─'.repeat(78));
  console.log(documento.titulo);
  console.log(documento.pdfUrl);

  if (soloTexto || !cliente) {
    // Camino sin modelo: descarga, hash, texto local y cortafuegos. Es todo lo
    // que se puede comprobar sin gastar una llamada, y es bastante.
    try {
      const pdf = await descargarPdf(documento.pdfUrl);
      const hash = await hashDocumento(pdf);
      const lectura = await extraerTextoDePdf(pdf);
      const privacidad = pareceContenerDatosPersonales(lectura.texto);
      console.log(`  hash SHA-256: ${hash.slice(0, 24)}…`);
      console.log(
        `  páginas: ${lectura.paginas} · caracteres: ${lectura.texto.length} · ` +
          `capa de texto: ${lectura.tieneCapaDeTexto ? 'sí' : 'NO (escaneado)'}`,
      );
      console.log(
        `  datos personales: ${
          privacidad.contieneDatosPersonales
            ? `SÍ → no se envía · ${privacidad.motivos.join(' ')}`
            : 'no detectados'
        }`,
      );
      if (soloTexto) {
        console.log('  ---- texto ----');
        console.log(lectura.texto.slice(0, 4000));
      }
    } catch (error) {
      console.log('  ERROR:', error instanceof Error ? error.message : error);
    }
    continue;
  }

  const resultado = await procesarDocumentoOficial({
    documentoId: documento.id,
    documentoUrl: documento.pdfUrl,
    documentoTitulo: documento.titulo,
    fileHash: documento.fileHash,
    eventId: documento.eventId,
    cliente,
    config,
    huella,
  });

  console.log(`  estado: ${resultado.estado}`);
  if (resultado.motivo) console.log(`  motivo: ${resultado.motivo}`);
  if (resultado.estado === 'ok') {
    console.log(
      `  campos encolados: ${resultado.encoladas} · descartados por cita falsa: ${resultado.descartadas}`,
    );
    await enseñarCola(resultado.hashDocumento ?? '');
  }
}

/** Lo que ha quedado en la cola de revisión de ese documento, tal cual. */
async function enseñarCola(hash: string) {
  if (!hash) return;
  const { db } = await import('../src/db/index.ts');
  const { extraccionPropuesta } = await import('../src/db/schema/index.ts');
  const { eq } = await import('drizzle-orm');
  const filas = await db
    .select()
    .from(extraccionPropuesta)
    .where(eq(extraccionPropuesta.hashDocumento, hash));
  for (const fila of filas) {
    console.log(
      `    · ${fila.campo} = ${fila.valorPropuesto}` +
        `  [cita ${fila.citaVerificada ? 'VERIFICADA' : 'sin verificar'}]`,
    );
    console.log(`      «${fila.cita.slice(0, 120)}»`);
  }
}

console.log('─'.repeat(78));
console.log('Listo.');
