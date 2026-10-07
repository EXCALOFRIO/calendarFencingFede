import { cache } from 'react';
import { db } from '@/db';
import { contarNoLeidas } from '@/lib/notificaciones/bandeja';
import { CampanaCliente } from './campana-cliente';

/** Una consulta por petición aunque la campana se pinte en dos cabeceras (móvil y escritorio). */
const noLeidasDe = cache(async (profileId: string): Promise<{ numero: number; lectura: number }> => {
  try {
    return { numero: await contarNoLeidas(db, profileId), lectura: Date.now() };
  } catch {
    return { numero: 0, lectura: Date.now() };
  }
});

/**
 * La campana de la cabecera. Componente de servidor: lee el contador de la
 * cuenta y se lo pasa al botón, que lo mantiene al día. Si la tabla aún no
 * existe (sin migración 0014) o la base falla, se pinta sin punto: la
 * cabecera no puede caerse por un contador.
 *
 * La monta `src/app/(app)/layout.tsx`: en la cabecera compacta del
 * Calendario y de Explorar y, en escritorio, a la derecha de la cabecera,
 * antes del avatar.
 */
export async function CampanaNotificaciones({ profileId, className }: { profileId: string; className?: string }) {
  const noLeidas = await noLeidasDe(profileId);
  return <CampanaCliente inicial={noLeidas.numero} lectura={noLeidas.lectura} cuenta={profileId} className={className} />;
}
