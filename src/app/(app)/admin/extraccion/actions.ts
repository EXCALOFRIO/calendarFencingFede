'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { extraccionDocumento, extraccionPropuesta } from '@/db/schema';
import {
  VERSION_ESQUEMA,
  crearClienteModelo,
  documentosPendientesDeExtraer,
  huellaDeExtraccion,
  leerConfiguracionIa,
  procesarDocumentoOficial,
} from '@/lib/ai/extract';
import { requireRole } from '@/lib/auth/session';

/**
 * Acciones de la revisión de extracciones.
 *
 * Aprobar significa "una persona ha comprobado que esto lo pone el documento",
 * y deja constancia de quién y cuándo. Nada de esto escribe en el calendario:
 * el modelo no publica, y el dato aprobado se queda aquí, firmado, hasta que
 * alguien decida llevarlo a la ficha de la prueba. Rechazar tampoco borra: la
 * fila es la prueba de qué propuso el modelo y por qué no valía.
 */

export type ResultadoAccion =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** Cuántas circulares se leen de una tacada desde el botón de la pantalla. */
const LOTE_MANUAL = 3;

async function marcar(
  ids: string[],
  estado: 'aprobada' | 'rechazada' | 'pendiente',
): Promise<number> {
  const perfil = await requireRole('admin');

  const filas = await db
    .update(extraccionPropuesta)
    .set({
      estado,
      revisadoPorPerfilId: estado === 'pendiente' ? null : perfil.profileId,
      revisadoEn: estado === 'pendiente' ? null : new Date(),
    })
    .where(inArray(extraccionPropuesta.id, ids))
    .returning({ id: extraccionPropuesta.id });

  revalidatePath('/admin/extraccion');
  revalidatePath('/admin');
  return filas.length;
}

/** Da por bueno un campo: lo dice el documento y alguien lo ha comprobado. */
export async function aprobarPropuesta(id: string): Promise<ResultadoAccion> {
  const n = await marcar([id], 'aprobada');
  if (n === 0) return { ok: false, error: 'Esa propuesta ya no existe.' };
  return { ok: true, message: 'Aprobada.' };
}

/** Descarta un campo. No se borra: queda con quién lo rechazó y cuándo. */
export async function rechazarPropuesta(id: string): Promise<ResultadoAccion> {
  const n = await marcar([id], 'rechazada');
  if (n === 0) return { ok: false, error: 'Esa propuesta ya no existe.' };
  return { ok: true, message: 'Rechazada.' };
}

/** Deshace una revisión hecha por error. */
export async function reabrirPropuesta(id: string): Promise<ResultadoAccion> {
  const n = await marcar([id], 'pendiente');
  if (n === 0) return { ok: false, error: 'Esa propuesta ya no existe.' };
  return { ok: true, message: 'Vuelve a estar pendiente de revisar.' };
}

/**
 * Aprueba de golpe todos los campos pendientes de una circular.
 *
 * Existe porque revisar es leer el PDF una vez y comprobar cinco datos que
 * están en la misma página: obligar a cinco clics separados no aporta
 * seguridad, solo cansancio. Los campos siguen firmados uno a uno.
 */
export async function aprobarCircular(extraccionId: string): Promise<ResultadoAccion> {
  await requireRole('admin');

  const pendientes = await db
    .select({ id: extraccionPropuesta.id })
    .from(extraccionPropuesta)
    // Solo las pendientes: lo ya rechazado no se resucita con un clic de más.
    .where(
      and(
        eq(extraccionPropuesta.extraccionId, extraccionId),
        eq(extraccionPropuesta.estado, 'pendiente'),
      ),
    );

  const ids = pendientes.map((p) => p.id);
  if (ids.length === 0) return { ok: false, error: 'No queda nada por revisar ahí.' };

  const n = await marcar(ids, 'aprobada');
  return { ok: true, message: `${n} campos aprobados.` };
}

/**
 * Confirma a qué torneo se refiere la circular, y con eso los datos llegan a
 * la ficha.
 *
 * ES LA SEGUNDA FIRMA, y hace falta porque son dos preguntas distintas:
 * «¿esto lo pone el documento?» (aprobar un campo) y «¿de qué torneo habla?».
 * Se puede acertar la primera y fallar la segunda, y el fallo de la segunda es
 * el peor de los dos: un horario correcto en la ficha del torneo equivocado no
 * se detecta mirando la ficha, porque el dato parece bueno.
 *
 * Las circulares de la federación llegan con una sugerencia de certeza
 * 'dudoso' como mucho (ver `resolverEvento`), y mientras nadie la confirme sus
 * propuestas se encolan SIN evento, así que no aparecen en ninguna ficha.
 * Confirmar aquí es lo que las reparte: se copia el evento a todas las
 * propuestas de esa extracción de una sola vez.
 *
 * Los dossieres que cuelgan del propio torneo no pasan por aquí: su certeza ya
 * es 'seguro' porque lo dice la fuente, no una heurística.
 */
export async function confirmarEventoDeExtraccion(
  extraccionId: string,
): Promise<ResultadoAccion> {
  const perfil = await requireRole('admin');

  const [extraccion] = await db
    .select({
      id: extraccionDocumento.id,
      eventoId: extraccionDocumento.eventoId,
      certeza: extraccionDocumento.eventoCerteza,
    })
    .from(extraccionDocumento)
    .where(eq(extraccionDocumento.id, extraccionId))
    .limit(1);

  if (!extraccion) return { ok: false, error: 'Esa extracción ya no existe.' };
  if (!extraccion.eventoId) {
    return {
      ok: false,
      error:
        'No hay ningún torneo que confirmar: el documento no dice de qué competición ' +
        'habla, o había varias candidatas empatadas. Los datos se quedan aquí.',
    };
  }

  await db
    .update(extraccionDocumento)
    .set({
      eventoCerteza: 'seguro',
      eventoConfirmadoEn: new Date(),
      eventoConfirmadoPorPerfilId: perfil.profileId,
      eventoMotivo: 'Confirmado a mano en la pantalla de revisión.',
    })
    .where(eq(extraccionDocumento.id, extraccionId));

  const repartidas = await db
    .update(extraccionPropuesta)
    .set({ eventoId: extraccion.eventoId })
    .where(eq(extraccionPropuesta.extraccionId, extraccionId))
    .returning({ id: extraccionPropuesta.id });

  revalidatePath('/admin/extraccion');
  // La ficha del torneo ya puede enseñar estos datos.
  revalidatePath('/');

  return {
    ok: true,
    message:
      `Confirmado. ${repartidas.length} campos van a la ficha de ese torneo; ` +
      'los que estén sin aprobar se enseñarán en gris hasta que los firmes.',
  };
}

/**
 * Dice que NO es ese torneo. La sugerencia se borra y los datos se quedan en
 * la cola sin aplicarse a nada, que es donde tienen que estar mientras no se
 * sepa de qué competición hablan.
 */
export async function descartarEventoDeExtraccion(
  extraccionId: string,
): Promise<ResultadoAccion> {
  await requireRole('admin');

  const filas = await db
    .update(extraccionDocumento)
    .set({
      eventoId: null,
      eventoCerteza: 'desconocido',
      eventoMotivo:
        'Una persona ha dicho que el torneo sugerido no era el correcto. Los datos ' +
        'se quedan sin aplicar.',
      eventoConfirmadoEn: null,
      eventoConfirmadoPorPerfilId: null,
    })
    .where(eq(extraccionDocumento.id, extraccionId))
    .returning({ id: extraccionDocumento.id });

  if (filas.length === 0) return { ok: false, error: 'Esa extracción ya no existe.' };

  await db
    .update(extraccionPropuesta)
    .set({ eventoId: null })
    .where(eq(extraccionPropuesta.extraccionId, extraccionId));

  revalidatePath('/admin/extraccion');
  revalidatePath('/');
  return { ok: true, message: 'Descartado: estos datos no van a ninguna ficha.' };
}

/**
 * Lee ahora mismo las siguientes circulares sin procesar.
 *
 * Es el mismo camino que el cron, con un lote más corto: aquí hay alguien
 * esperando delante de la pantalla. Si no hay modelo configurado se dice por
 * qué, con el nombre exacto de las variables que faltan, en vez de dejar un
 * botón que no hace nada.
 */
export async function procesarSiguientes(): Promise<ResultadoAccion> {
  await requireRole('admin');

  const config = leerConfiguracionIa();
  if (!config.activa) {
    return {
      ok: false,
      error:
        'La extracción asistida está apagada. Se enciende poniendo ' +
        'AI_EXTRACTION_ENABLED="true" en el entorno del Worker.',
    };
  }

  const cliente = crearClienteModelo(config);
  if (!cliente) {
    return {
      ok: false,
      error:
        'No hay ningún modelo disponible: falta el binding de Workers AI en el ' +
        'Worker o, fuera de él, CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_API_TOKEN con ' +
        'permiso de Workers AI.',
    };
  }

  const huella = { hashPrompt: await huellaDeExtraccion(), versionEsquema: VERSION_ESQUEMA };
  const pendientes = await documentosPendientesDeExtraer(LOTE_MANUAL, huella);

  if (pendientes.length === 0) {
    return {
      ok: false,
      error: 'No queda ninguna circular por leer con el prompt y el esquema de hoy.',
    };
  }

  let encoladas = 0;
  let sinDatos = 0;

  for (const documento of pendientes) {
    const resultado = await procesarDocumentoOficial({
      documentoId: documento.id,
      origen: documento.origen,
      documentoUrl: documento.pdfUrl,
      documentoTitulo: documento.titulo,
      fileHash: documento.fileHash,
      eventId: documento.eventId,
      cliente,
      config,
      huella,
    });
    if (resultado.estado === 'ok' && (resultado.encoladas ?? 0) > 0) {
      encoladas += resultado.encoladas ?? 0;
    } else {
      sinDatos += 1;
    }
  }

  revalidatePath('/admin/extraccion');

  return {
    ok: true,
    message:
      `${pendientes.length} circulares leídas · ${encoladas} campos para revisar` +
      (sinDatos > 0 ? ` · ${sinDatos} sin datos aprovechables` : ''),
  };
}
