import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { callUp, event } from '@/db/schema';
import type { SessionProfile } from '@/lib/auth/session';
import { storeFile, storageBackend } from '@/lib/storage';
import { parseFechaMadrid } from './fechas';

export type ResultadoCrear =
  | { ok: true; message: string; callUpId: string }
  | { ok: false; error: string };

/** Tope del PDF de convocatoria. Una circular escaneada rara vez pasa de 3 MB. */
export const MAX_PDF_CONVOCATORIA = 8 * 1024 * 1024;

/**
 * Clave nueva del PDF en R2: un UUID aleatorio, no la hora ni el nombre del
 * fichero, para que conocer el id del evento (público) no permita adivinarla.
 * El acceso lo decide de todos modos /api/archivos contra D1.
 */
export function clavePdfConvocatoria(eventId: string): string {
  return `convocatorias/${eventId}/${crypto.randomUUID()}.pdf`;
}

/**
 * Crea la convocatoria en borrador. La llaman la acción de servidor (sin PDF
 * grande: las acciones admiten 1 MB) y la ruta /api/admin/convocatorias, que
 * es por donde sube el PDF. Quien llama ya ha comprobado que es admin con
 * permiso de escritura.
 */
export async function crearConvocatoriaPara(
  profile: Pick<SessionProfile, 'profileId'>,
  formData: FormData,
): Promise<ResultadoCrear> {
  const eventId = String(formData.get('eventId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const travelNotes = String(formData.get('travelNotes') ?? '').trim();
  const respondBy = parseFechaMadrid(String(formData.get('respondBy') ?? ''));

  if (!eventId) return { ok: false, error: 'Elige el evento de la convocatoria.' };
  if (title.length < 3) return { ok: false, error: 'Ponle un título a la convocatoria.' };

  const [evento] = await db
    .select({ id: event.id, name: event.name })
    .from(event)
    .where(eq(event.id, eventId))
    .limit(1);
  if (!evento) return { ok: false, error: 'Ese evento ya no existe.' };

  let pdfUrl: string | null = null;
  let pdfName: string | null = null;

  const pdf = formData.get('pdf');
  if (pdf instanceof File && pdf.size > 0) {
    if (pdf.type && pdf.type !== 'application/pdf') {
      return { ok: false, error: 'El documento de la convocatoria tiene que ser un PDF.' };
    }
    if (pdf.size > MAX_PDF_CONVOCATORIA) {
      return { ok: false, error: 'El PDF pasa de 8 MB. Comprímelo o divídelo antes de subirlo.' };
    }
    if (!storageBackend()) {
      return {
        ok: false,
        error:
          'No hay almacenamiento de ficheros configurado, así que el PDF no se ' +
          'puede guardar. Crea la convocatoria sin PDF o configura el almacenamiento.',
      };
    }
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    const guardado = await storeFile(clavePdfConvocatoria(evento.id), bytes, {
      contentType: 'application/pdf',
    });
    pdfUrl = guardado?.url ?? null;
    pdfName = pdf.name.slice(-200);
  }

  const [creada] = await db
    .insert(callUp)
    .values({
      eventId,
      title,
      body: body || null,
      travelNotes: travelNotes || null,
      respondBy,
      pdfUrl,
      pdfName,
      createdByProfileId: profile.profileId,
    })
    .returning({ id: callUp.id });

  revalidatePath('/admin/convocatorias');

  return {
    ok: true,
    callUpId: creada.id,
    message: `Convocatoria creada en borrador para "${evento.name}". Ahora elige a quién convocas.`,
  };
}
