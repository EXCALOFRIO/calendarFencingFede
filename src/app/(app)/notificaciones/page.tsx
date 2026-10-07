import { AccionesNotificaciones, BandejaNotificaciones } from '@/components/notificaciones/bandeja';
import { db } from '@/db';
import { requireProfile } from '@/lib/auth/session';
import { hoyMadrid, parseFechaMadrid } from '@/lib/callups/fechas';
import { agruparBandeja, leerBandeja, type FilaBandeja } from '@/lib/notificaciones/bandeja';
import { esFaltaDeTabla } from '@/lib/notificaciones/db';
import { abrirAvisoAccion, marcarTodasLeidasAccion } from './acciones';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notificaciones' };

export default async function Pagina() {
  const perfil = await requireProfile();
  let filas: FilaBandeja[] = [];
  let sinMigracion = false;
  try {
    filas = await leerBandeja(db, perfil.profileId);
  } catch (error) {
    sinMigracion = esFaltaDeTabla(error);
    if (!sinMigracion) throw error;
  }
  const ahora = new Date();
  // «Hoy» es el día de Madrid, no el del servidor (UTC).
  const inicioDeHoy = parseFechaMadrid(`${hoyMadrid()}T00:00`)?.getTime();
  const secciones = agruparBandeja(filas, ahora, inicioDeHoy);

  // El título «Notificaciones» y la flecha los pone la cabecera compacta (`cabeceraDeRuta`).
  return (
    <div className="mx-auto flex w-full max-w-[640px] min-w-0 flex-col gap-[8px]">
      <AccionesNotificaciones hayNoLeidas={filas.some((f) => !f.leida)} marcarTodas={marcarTodasLeidasAccion} />
      <BandejaNotificaciones secciones={secciones} ahora={ahora.getTime()} abrir={abrirAvisoAccion} sinMigracion={sinMigracion} />
    </div>
  );
}
