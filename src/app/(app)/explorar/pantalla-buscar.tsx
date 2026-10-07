import { Suspense } from 'react';
import { PropuestasBuscador } from '@/components/explorar/buscador-social-fila';
import { VistaBuscar } from '@/components/explorar/vista-buscar';
import type { SessionProfile } from '@/lib/auth/session';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { cargarBuscarVacioCompartido } from '@/lib/sport/explorar/cache-real';
import type { VistaExplorar } from '@/lib/sport/explorar/pantalla';
import { opcionesTemporada, type CriteriosExplorar } from '@/lib/sport/explorar/url';

/** Sugerencias de Buscar sin texto: llegan después de la barra, sin retrasarla, y salen de la caché compartida. */
async function Propuestas({ ctx }: { ctx: ContextoExplorador }) {
  const propuestas = await cargarBuscarVacioCompartido(ctx);
  if (propuestas?.length === 0) return null;
  return <PropuestasBuscador propuestas={propuestas} className="lg:max-w-2xl" />;
}

/**
 * Pestaña Buscar de `/explorar?…` (con criterios) y de `/explorar/buscar`
 * (sin ellos). Las sugerencias van en `Suspense`: la barra de búsqueda se
 * pinta con el primer trozo del HTML y ellas llegan en streaming.
 */
export function PantallaBuscar({
  perfil,
  ctx,
  criterios,
  cursor,
  vista,
}: {
  perfil: Pick<SessionProfile, 'role' | 'profileId'>;
  ctx: ContextoExplorador;
  criterios: CriteriosExplorar;
  cursor: string | undefined;
  vista: Exclude<VistaExplorar, { tipo: 'sin_sesion' }>;
}) {
  return (
    <VistaBuscar
      criterios={criterios}
      cursor={cursor}
      vista={vista}
      temporadas={opcionesTemporada(new Date().toISOString().slice(0, 10))}
      atajoEspana={perfil.role === 'coach' || perfil.role === 'admin'}
      profileId={perfil.profileId}
      sugerencias={(
        // Sin esqueleto: las sugerencias van por debajo del campo y aparecen cuando llegan.
        <Suspense fallback={null}>
          <Propuestas ctx={ctx} />
        </Suspense>
      )}
    />
  );
}
