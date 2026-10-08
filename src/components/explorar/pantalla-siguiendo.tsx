import { TriangleAlert, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { Boton } from '@/components/sistema/boton';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import type { VistaListaSiguiendo } from '@/lib/sport/explorar/inicio-pantalla';
import { RUTA_SIGUIENDO } from '@/lib/sport/explorar/siguiendo-url';
import { RUTA_BUSCAR } from '@/lib/sport/explorar/url';
import { ListaSiguiendo } from './lista-siguiendo';
import { PropuestasParaSeguir } from './siguiendo';

function Accion({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Boton asChild variante="contorno">
      <Link href={href} prefetch={false}>{children}</Link>
    </Boton>
  );
}

/**
 * Tú › Siguiendo: a quién sigues, con su número, y dejar de seguir en la
 * misma fila. El título y la flecha de volver están en la cabecera compacta.
 */
export function PantallaListaSiguiendo({ vista }: { vista: Exclude<VistaListaSiguiendo, { tipo: 'sin_sesion' }> }) {
  const total = vista.tipo === 'ok' ? vista.total : null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 lg:mx-auto lg:max-w-2xl">
      {total !== null && total > 0 ? (
        <p className="text-sm text-muted-foreground">
          <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('es-ES')}</strong>{' '}
          {total === 1 ? 'persona' : 'personas'}
        </p>
      ) : null}

      {vista.tipo === 'ok' && vista.items.length > 0 ? (
        <ListaSiguiendo items={vista.items} siguiente={vista.siguiente} />
      ) : vista.tipo === 'ok' ? (
        <div className="flex min-w-0 flex-col gap-3">
          <EstadoVacio
            icono={UserPlus}
            titulo="Aún no sigues a nadie"
            descripcion="Sus resultados saldrán en Explorar."
            accion={<Accion href={RUTA_BUSCAR}>Buscar tiradores</Accion>}
          />
          <PropuestasParaSeguir sugeridos={vista.sugeridos} />
        </div>
      ) : vista.tipo === 'cursor_invalido' ? (
        <EstadoVacio tipo="error" icono={TriangleAlert} titulo="Página caducada" accion={<Accion href={RUTA_SIGUIENDO}>Volver al principio</Accion>} />
      ) : vista.tipo === 'no_disponible' ? (
        <EstadoVacio tipo="error" icono={TriangleAlert} titulo="Siguiendo aún no está activo" descripcion="Aún no está activo en esta instalación." />
      ) : (
        <EstadoVacio tipo="error" icono={TriangleAlert} titulo="No se ha podido abrir la lista" accion={<Accion href={RUTA_SIGUIENDO}>Reintentar</Accion>} />
      )}
    </div>
  );
}
