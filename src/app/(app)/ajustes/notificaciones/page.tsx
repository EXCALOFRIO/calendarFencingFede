import { AjustesNotificaciones } from '@/components/notificaciones/ajustes';
import { db } from '@/db';
import { requireProfile } from '@/lib/auth/session';
import { leerPreferenciasDe } from '@/lib/notificaciones/bandeja';
import { esFaltaDeTabla } from '@/lib/notificaciones/db';
import { leerClavesVapid } from '@/lib/notificaciones/push/vapid';
import { PREFERENCIAS_POR_DEFECTO, type Preferencias } from '@/lib/notificaciones/tipos';
import {
  desuscribirAccion, guardarPreferenciaAccion, notificacionPruebaAccion, suscribirAccion,
} from '../../notificaciones/acciones';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notificaciones · Ajustes' };

export default async function Pagina() {
  const perfil = await requireProfile();
  let preferencias: Preferencias = { ...PREFERENCIAS_POR_DEFECTO };
  let sinMigracion = false;
  try {
    preferencias = await leerPreferenciasDe(db, perfil.profileId);
  } catch (error) {
    sinMigracion = esFaltaDeTabla(error);
    if (!sinMigracion) throw error;
  }
  // Solo la clave pública sale al navegador; la privada no se lee aquí.
  const vapidPublica = leerClavesVapid()?.publica ?? null;

  // El título y la flecha los pone la cabecera compacta (`cabeceraDeRuta`): sin migas ni subtítulo.
  return (
    <div className="mx-auto flex w-full max-w-[640px] min-w-0 flex-col pt-[8px]">
      <AjustesNotificaciones
        preferencias={preferencias}
        vapidPublica={vapidPublica}
        soloLectura={Boolean(perfil.preview || perfil.qa) || sinMigracion}
        avisoSoloLectura={sinMigracion ? 'Notificaciones aún sin activar en el servidor.' : undefined}
        acciones={{
          guardarPreferencia: guardarPreferenciaAccion,
          suscribir: suscribirAccion,
          desuscribir: desuscribirAccion,
          probar: notificacionPruebaAccion,
        }}
      />
    </div>
  );
}
