import { Suspense } from 'react';
import { BuscadorPaises } from '@/components/explorar/buscador-paises';
import { PropuestasBuscador } from '@/components/explorar/buscador-social-fila';
import { CabeceraExplorar } from '@/components/explorar/cabecera-explorar';
import { VistaBuscar } from '@/components/explorar/vista-buscar';
import { TransicionContenido } from '@/components/sistema/transicion';
import type { SessionProfile } from '@/lib/auth/session';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { cargarBuscarVacioCompartido } from '@/lib/sport/explorar/cache-real';
import type { VistaExplorar } from '@/lib/sport/explorar/pantalla';
import { opcionesTemporada, type CriteriosExplorar } from '@/lib/sport/explorar/url';

/** Sugerencias de Tiradores sin texto: llegan después de la barra, sin retrasarla, y salen de la caché compartida. */
async function Propuestas({ ctx }: { ctx: ContextoExplorador }) {
  const propuestas = await cargarBuscarVacioCompartido(ctx);
  if (propuestas?.length === 0) return null;
  return <PropuestasBuscador propuestas={propuestas} className="lg:max-w-2xl" />;
}

/** Ámbito Países (`/explorar/buscar?ver=paises`): lista fija, sin lecturas de la base. */
export function PantallaPaises({ q }: { q: string }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-3 lg:mx-auto lg:max-w-2xl">
      <TransicionContenido clave="paises" nombre="explorar-contenido">
        <div className="min-w-0">
          <BuscadorPaises qInicial={q} cabecera={<CabeceraExplorar activa="paises" q={q} />} />
        </div>
      </TransicionContenido>
    </div>
  );
}

/**
 * Ámbito Tiradores (`/explorar/buscar`, con o sin criterios). Las sugerencias
 * van en `Suspense`: la barra de búsqueda se pinta con el primer trozo del
 * HTML y ellas llegan en streaming.
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
