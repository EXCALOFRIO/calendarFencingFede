/**
 * Banco de pruebas de modelos de Workers AI, con circulares DE VERDAD.
 *
 * POR QUÉ EXISTE
 * --------------
 * La extracción estuvo encendida en producción con
 * `@cf/google/gemma-4-26b-a4b-it` y devolvió cinco errores de cinco. Elegir el
 * recambio leyendo la tabla de precios de Cloudflare es exactamente el error
 * que llevó hasta ahí: la documentación dice qué ventana tiene cada modelo,
 * pero no dice que uno se gaste el presupuesto de salida razonando ni que otro
 * devuelva el JSON en `choices[0].message.content` en vez de en `response`.
 * Eso solo se sabe llamando.
 *
 * Esto NO es un test automático (no vive en `*.test.ts` a propósito): es la
 * herramienta con la que se compara modelo contra modelo sobre los mismos
 * documentos y con la MISMA petición que manda producción —el cuerpo lo
 * construye `entradasParaWorkersAi`, no este fichero—.
 *
 * CÓMO SE LE DA UN BINDING DE WORKERS AI DESDE EL PORTÁTIL
 * -------------------------------------------------------
 * El token de la cuenta NO tiene permiso de Workers AI, así que
 * `POST /accounts/{id}/ai/run/...` contesta 401 y la vía REST no sirve. Pero
 * `wrangler dev --remote` sí: sube un Worker de vista previa y le inyecta el
 * binding de verdad. Con un Worker de tres líneas que reexpone `env.AI.run`
 * ya se puede llamar a cualquier modelo desde aquí:
 *
 *   mkdir probador && cd probador
 *   cat > wrangler.jsonc <<'FIN'
 *   { "name": "probador-ia", "main": "index.js",
 *     "compatibility_date": "2026-09-15", "ai": { "binding": "AI" } }
 *   FIN
 *   cat > index.js <<'FIN'
 *   export default { async fetch(request, env) {
 *     const { modelo, entradas } = await request.json();
 *     try { return Response.json({ ok: true, crudo: await env.AI.run(modelo, entradas) }); }
 *     catch (e) { return Response.json({ ok: false, error: String(e?.message ?? e) }); }
 *   } };
 *   FIN
 *   npx wrangler dev --remote --port 8799
 *
 * Y entonces:
 *
 *   npx tsx tests/modelos-workers-ai.mts --probador http://127.0.0.1:8799
 *   npx tsx tests/modelos-workers-ai.mts --probador http://127.0.0.1:8799 \
 *       --modelos '@cf/zai-org/glm-5.3-flash,@cf/qwen/qwen3-30b-a3b-fp8' \
 *       --documentos 8 --detalle
 *
 * Sin `--probador` usa el cliente normal del proyecto, que es lo que pasa
 * cuando esto corre dentro del Worker.
 *
 * QUÉ MIDE, Y EN ESTE ORDEN (el que pidió el usuario)
 *  1. si el documento CABE: caracteres enviados y si hubo que recortar;
 *  2. si el modelo respeta el esquema: JSON válido y que pase Zod;
 *  3. cuántos campos salen y cuántos se caen por cita falsa;
 *  4. cuánto cuesta: neurons y milisegundos por documento.
 *
 * PRIVACIDAD: este fichero pasa por el mismo embudo que producción. El texto
 * se tacha (`redactarDatosDeContacto`) y se mira (`pareceContenerDatosPersonales`)
 * ANTES de mandar nada, y un documento con datos personales no se envía ni
 * para comparar modelos.
 */

import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { desc, eq } from 'drizzle-orm';
import {
  ESQUEMA_JSON_SALIDA,
  MODELO_POR_DEFECTO,
  PROMPT_SISTEMA,
  type ClienteModelo,
  type PropuestaCampo,
  aPropuestas,
  construirPromptUsuario,
  crearClienteModelo,
  descargarPdf,
  entradasParaWorkersAi,
  esquemaExtraccion,
  extraerTextoDePdf,
  hashDocumento,
  leerConfiguracionIa,
  pareceContenerDatosPersonales,
  perfilDeModelo,
  redactarDatosDeContacto,
  respuestaDeWorkersAi,
  verificarPropuestas,
} from '../src/lib/ai/extract.ts';
import { db } from '../src/db/index.ts';
import { event, eventDocument, officialDocument } from '../src/db/schema/index.ts';

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

const argumentos = process.argv.slice(2);
const valor = (nombre: string): string | null => {
  const i = argumentos.indexOf(`--${nombre}`);
  return i >= 0 ? (argumentos[i + 1] ?? null) : null;
};
const bandera = (nombre: string) => argumentos.includes(`--${nombre}`);

const urlProbador = valor('probador');
const detalle = bandera('detalle');
const cuantos = Number.parseInt(valor('documentos') ?? '', 10) || 6;
const cache = valor('cache') ?? '.cache-circulares';

/**
 * Los candidatos, con su ventana y su precio sacados de
 * https://developers.cloudflare.com/workers-ai/models/ (consultado al hacer
 * esta comparación). La ventana manda: una normativa de 27 páginas que no cabe
 * se recorta justo por donde están los horarios.
 */
const CANDIDATOS: { modelo: string; ventana: number; entrada: number; salida: number }[] = [
  { modelo: '@cf/zai-org/glm-5.3-flash', ventana: 1_310_720, entrada: 0.15, salida: 0.5 },
  {
    modelo: '@cf/deepseek-ai/deepseek-v4-flash-0731',
    ventana: 1_048_576,
    entrada: 0.44,
    salida: 1.32,
  },
  { modelo: '@cf/google/gemma-4-26b-a4b-it', ventana: 256_000, entrada: 0.1, salida: 0.3 },
  {
    modelo: '@cf/meta/llama-4-scout-17b-16e-instruct',
    ventana: 131_000,
    entrada: 0.27,
    salida: 0.85,
  },
  { modelo: '@cf/qwen/qwen3-30b-a3b-fp8', ventana: 32_768, entrada: 0.051, salida: 0.335 },
];

const modelos = (valor('modelos') ?? '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const aProbar =
  modelos.length > 0
    ? modelos.map(
        (modelo) =>
          CANDIDATOS.find((c) => c.modelo === modelo) ?? {
            modelo,
            ventana: 0,
            entrada: 0,
            salida: 0,
          },
      )
    : CANDIDATOS;

// ---------------------------------------------------------------------------
// Documentos de verdad
// ---------------------------------------------------------------------------

type Documento = {
  origen: 'dossier' | 'circular';
  titulo: string;
  url: string;
  evento: string | null;
  paginas: number;
  texto: string;
  hash: string;
};

/**
 * Descarga y lee los documentos, con caché en disco.
 *
 * La caché no es un lujo: comparar cinco modelos sobre seis documentos son
 * treinta llamadas al modelo, y no tiene ningún sentido descargar seis PDFs y
 * volver a pasarles `unpdf` cada vez que se cambia un candidato de la lista.
 */
async function documentos(): Promise<Documento[]> {
  await mkdir(cache, { recursive: true });
  const rutaIndice = `${cache}/indice.json`;
  try {
    const guardado = JSON.parse(await readFile(rutaIndice, 'utf8')) as Documento[];
    if (guardado.length >= cuantos) {
      console.log(`Documentos de la caché (${cache}).\n`);
      return guardado.slice(0, cuantos);
    }
  } catch {
    // Sin caché: se descarga. No es un error.
  }

  /**
   * Primero los DOSSIERES de torneo y después las circulares, igual que el
   * cron: un dossier de convocatoria es el que lleva el pabellón con su
   * dirección y los horarios por día, que es lo que hay que comprobar que el
   * modelo sabe sacar.
   */
  const dossieres = await db
    .select({
      titulo: eventDocument.title,
      url: eventDocument.url,
      evento: event.name,
    })
    .from(eventDocument)
    .innerJoin(event, eq(event.id, eventDocument.eventId))
    .orderBy(desc(event.startDate))
    .limit(40);

  const circulares = await db
    .select({ titulo: officialDocument.title, url: officialDocument.pdfUrl })
    .from(officialDocument)
    .orderBy(desc(officialDocument.publishedAt))
    .limit(40);

  const candidatos = [
    ...dossieres.map((d) => ({ ...d, origen: 'dossier' as const })),
    ...circulares.map((c) => ({ ...c, evento: null, origen: 'circular' as const })),
  ];

  const listos: Documento[] = [];
  const vistos = new Set<string>();

  for (const candidato of candidatos) {
    if (listos.length >= cuantos) break;
    try {
      const pdf = await descargarPdf(candidato.url);
      const hash = await hashDocumento(pdf);
      // El mismo PDF republicado en tres URLs no son tres pruebas.
      if (vistos.has(hash)) continue;
      vistos.add(hash);

      const lectura = await extraerTextoDePdf(pdf);
      if (!lectura.tieneCapaDeTexto) {
        console.log(`  · escaneado, no se envía: ${candidato.titulo}`);
        continue;
      }
      const { texto } = redactarDatosDeContacto(lectura.texto);
      const privacidad = pareceContenerDatosPersonales(texto);
      if (privacidad.contieneDatosPersonales) {
        console.log(`  · bloqueado por privacidad: ${candidato.titulo}`);
        continue;
      }
      listos.push({
        origen: candidato.origen,
        titulo: candidato.titulo,
        url: candidato.url,
        evento: candidato.evento,
        paginas: lectura.paginas,
        texto,
        hash,
      });
    } catch (error) {
      console.log(
        `  · ERROR al leer ${candidato.titulo}: ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
  }

  await writeFile(rutaIndice, JSON.stringify(listos, null, 1), 'utf8');
  return listos;
}

// ---------------------------------------------------------------------------
// Cliente contra el probador
// ---------------------------------------------------------------------------

type Medida = { neurons: number; tokensEntrada: number; tokensSalida: number };

/**
 * Habla con el Worker de vista previa. Usa `entradasParaWorkersAi` y
 * `respuestaDeWorkersAi` —las de producción— para que lo que se mida sea el
 * camino real y no una imitación.
 */
function clientePorProbador(
  url: string,
  modelo: string,
  medidas: Medida[],
): ClienteModelo {
  return {
    modelo,
    async generarJson(peticion) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelo, entradas: entradasParaWorkersAi(peticion, modelo) }),
        signal: AbortSignal.timeout(240_000),
      });
      const sobre = (await res.json()) as {
        ok?: boolean;
        crudo?: unknown;
        error?: string;
      };
      if (sobre.ok === false) throw new Error(sobre.error ?? 'el probador falló');
      const uso = (sobre.crudo as { usage?: Record<string, number> })?.usage ?? {};
      medidas.push({
        neurons: uso.neurons ?? 0,
        tokensEntrada: uso.prompt_tokens ?? 0,
        tokensSalida: uso.completion_tokens ?? 0,
      });
      return respuestaDeWorkersAi(sobre.crudo);
    },
    async transcribirPdf() {
      throw new Error('El probador no transcribe escaneados.');
    },
  };
}

// ---------------------------------------------------------------------------
// Una pasada
// ---------------------------------------------------------------------------

type Resultado = {
  modelo: string;
  documento: string;
  estado: 'ok' | 'json_invalido' | 'esquema_invalido' | 'fallo_modelo';
  motivo?: string;
  verificadas: PropuestaCampo[];
  descartadas: PropuestaCampo[];
  ms: number;
  medida: Medida | null;
};

async function probar(
  cliente: ClienteModelo,
  documento: Documento,
  medidas: Medida[],
): Promise<Resultado> {
  const base = {
    modelo: cliente.modelo,
    documento: documento.titulo,
    verificadas: [] as PropuestaCampo[],
    descartadas: [] as PropuestaCampo[],
  };
  const antes = Date.now();
  const antesMedidas = medidas.length;
  const medida = () => (medidas.length > antesMedidas ? medidas[medidas.length - 1] : null);

  let crudo: string;
  try {
    crudo = await cliente.generarJson({
      sistema: PROMPT_SISTEMA,
      usuario: construirPromptUsuario(documento.texto, { documentUrl: documento.url }),
      esquemaJson: ESQUEMA_JSON_SALIDA,
    });
  } catch (error) {
    return {
      ...base,
      estado: 'fallo_modelo',
      motivo: error instanceof Error ? error.message : String(error),
      ms: Date.now() - antes,
      medida: medida(),
    };
  }

  let bruto: unknown;
  try {
    const limpio = crudo.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    bruto = JSON.parse(limpio);
  } catch (error) {
    return {
      ...base,
      estado: 'json_invalido',
      motivo: `${error instanceof Error ? error.message : error} · empieza por: ${crudo.slice(0, 120)}`,
      ms: Date.now() - antes,
      medida: medida(),
    };
  }

  const validado = esquemaExtraccion.safeParse(bruto);
  if (!validado.success) {
    return {
      ...base,
      estado: 'esquema_invalido',
      motivo: validado.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(' · '),
      ms: Date.now() - antes,
      medida: medida(),
    };
  }

  const { verificadas, descartadas } = verificarPropuestas(
    aPropuestas(validado.data),
    documento.texto,
  );

  return {
    ...base,
    estado: 'ok',
    verificadas,
    descartadas,
    ms: Date.now() - antes,
    medida: medida(),
  };
}

// ---------------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------------

const config = leerConfiguracionIa();
console.log('Modelo configurado hoy:', config.modelo);
console.log('Modelo por defecto del código:', MODELO_POR_DEFECTO.workers_ai);
console.log('Probador:', urlProbador ?? '(cliente normal del proyecto)');
console.log('');

const docs = await documentos();
if (docs.length === 0) {
  console.log('No hay ningún documento con capa de texto que se pueda enviar.');
  process.exit(1);
}

console.log(`${docs.length} documentos:`);
for (const d of docs) {
  console.log(
    `  [${d.origen}] ${d.paginas}p · ${d.texto.length} caracteres · ${d.titulo}` +
      (d.evento ? ` → ${d.evento}` : ''),
  );
}
console.log('');

const todos: Resultado[] = [];

for (const candidato of aProbar) {
  const medidas: Medida[] = [];
  const cliente = urlProbador
    ? clientePorProbador(urlProbador, candidato.modelo, medidas)
    : crearClienteModelo({ ...config, modelo: candidato.modelo });
  if (!cliente) {
    console.log(`${candidato.modelo}: sin cliente disponible, se salta.`);
    continue;
  }

  const perfil = perfilDeModelo(candidato.modelo);
  console.log('═'.repeat(78));
  console.log(
    `${candidato.modelo}  ·  ventana ${candidato.ventana.toLocaleString('es-ES')} tokens` +
      `  ·  ${candidato.entrada} $/${candidato.salida} $ por millón` +
      `  ·  tope como "${perfil.claveTopeSalida}"` +
      `  ·  reasoning_effort ${perfil.esfuerzoRazonamiento ?? 'no aplica'}`,
  );

  for (const documento of docs) {
    const resultado = await probar(cliente, documento, medidas);
    todos.push(resultado);
    const u = resultado.medida;
    console.log(
      `  ${resultado.estado.padEnd(16)} ${String(resultado.verificadas.length).padStart(3)} campos` +
        ` · ${String(resultado.descartadas.length).padStart(2)} descartados` +
        ` · ${String(resultado.ms).padStart(6)} ms` +
        ` · ${(u?.neurons ?? 0).toFixed(1).padStart(7)} neurons` +
        ` · ${documento.titulo.slice(0, 40)}`,
    );
    if (resultado.motivo) console.log(`      ↳ ${resultado.motivo.slice(0, 220)}`);
    if (detalle && resultado.estado === 'ok') {
      for (const campo of resultado.verificadas) {
        console.log(
          `        ✓ ${campo.field} = ${campo.proposedValue}` +
            `${campo.prueba ? ` [${campo.prueba}]` : ''}`,
        );
        console.log(`          «${campo.quote.slice(0, 110)}»`);
      }
      for (const campo of resultado.descartadas) {
        console.log(`        ✗ ${campo.field} = ${campo.proposedValue} — ${campo.motivoDescarte}`);
        console.log(`          «${campo.quote.slice(0, 110)}»`);
      }
    }
  }
}

console.log('═'.repeat(78));
console.log('RESUMEN (el orden de las columnas es el orden de los criterios)');
console.log(
  'modelo'.padEnd(44) +
    'ok'.padStart(4) +
    'campos'.padStart(8) +
    'descart'.padStart(9) +
    'neurons'.padStart(9) +
    'ms/doc'.padStart(9),
);
for (const candidato of aProbar) {
  const mios = todos.filter((r) => r.modelo === candidato.modelo);
  if (mios.length === 0) continue;
  const ok = mios.filter((r) => r.estado === 'ok').length;
  const campos = mios.reduce((s, r) => s + r.verificadas.length, 0);
  const descartados = mios.reduce((s, r) => s + r.descartadas.length, 0);
  const neurons = mios.reduce((s, r) => s + (r.medida?.neurons ?? 0), 0);
  const ms = mios.reduce((s, r) => s + r.ms, 0) / mios.length;
  console.log(
    candidato.modelo.padEnd(44) +
      `${ok}/${mios.length}`.padStart(4) +
      String(campos).padStart(8) +
      String(descartados).padStart(9) +
      neurons.toFixed(1).padStart(9) +
      ms.toFixed(0).padStart(9),
  );
}

process.exit(0);
