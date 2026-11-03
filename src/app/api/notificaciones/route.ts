import { db } from '@/db';
import { getSessionProfile } from '@/lib/auth/session';
import { contarNoLeidas } from '@/lib/notificaciones/bandeja';
import { esFaltaDeTabla } from '@/lib/notificaciones/db';

/**
 * Contador de la campana: `{ noLeidas }` de la cuenta de la sesión. Lo sondea
 * `CampanaNotificaciones` mientras la pestaña está visible y cuando el
 * trabajador de servicio avisa de un push. Sin sesión, 401 sin cuerpo útil.
 */
export const dynamic = 'force-dynamic';

const CABECERAS = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const perfil = await getSessionProfile().catch(() => null);
  if (!perfil) return Response.json({ ok: false }, { status: 401, headers: CABECERAS });
  try {
    return Response.json({ ok: true, noLeidas: await contarNoLeidas(db, perfil.profileId) }, { headers: CABECERAS });
  } catch (error) {
    // Sin la migración 0014 la campana se pinta sin número y ya está.
    if (esFaltaDeTabla(error)) {
      return Response.json({ ok: true, noLeidas: 0 }, { headers: CABECERAS });
    }
    // Otro fallo (la base no responde, p.ej.) no se disfraza de «sin avisos»:
    // un 0 fabricado sobrescribiría el contador y no dejaría señal del fallo.
    console.error(`[notificaciones] ${error instanceof Error ? error.name : String(error)}`);
    return Response.json({ ok: false }, { status: 500, headers: CABECERAS });
  }
}
