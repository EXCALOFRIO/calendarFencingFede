import { Search, TriangleAlert, UserPlus } from 'lucide-react';
import Link from 'next/link';
import type { VistaListaSiguiendo } from '@/lib/sport/explorar/inicio-pantalla';
import { RUTA_SIGUIENDO } from '@/lib/sport/explorar/siguiendo-url';
import { RUTA_BUSCAR } from '@/lib/sport/explorar/url';
import { ListaSiguiendo } from './lista-siguiendo';
import { PropuestasParaSeguir } from './siguiendo';

const ENLACE =
  'inline-flex min-h-[44px] items-center gap-1.5 text-[14px] text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

function Aviso({ alerta = false, icono, titulo, children }: {
  alerta?: boolean;
  icono: React.ReactNode;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section role={alerta ? 'alert' : 'status'} className="flex min-w-0 flex-col items-start gap-1 py-2 lg:max-w-2xl">
      <div className="flex min-w-0 items-center gap-2">
        {icono}
        <h2 className="text-[16px] leading-tight font-semibold tracking-normal">{titulo}</h2>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1 text-[14px] text-muted-foreground">{children}</div>
    </section>
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
        <p className="text-[13px] text-muted-foreground">
          <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('es-ES')}</strong>{' '}
          {total === 1 ? 'persona' : 'personas'}
        </p>
      ) : null}

      {vista.tipo === 'ok' && vista.items.length > 0 ? (
        <ListaSiguiendo items={vista.items} siguiente={vista.siguiente} />
      ) : vista.tipo === 'ok' ? (
        <div className="flex min-w-0 flex-col gap-3">
          <Aviso icono={<UserPlus className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />} titulo="Aún no sigues a nadie">
            <p>Cuando sigas a alguien aparecerá aquí, y sus resultados en Explorar.</p>
            <Link href={RUTA_BUSCAR} prefetch={false} className={ENLACE}>
              <Search className="size-[16px]" aria-hidden />
              Buscar tiradores
            </Link>
          </Aviso>
          <PropuestasParaSeguir sugeridos={vista.sugeridos} />
        </div>
      ) : vista.tipo === 'cursor_invalido' ? (
        <Aviso alerta icono={<TriangleAlert className="size-[18px] shrink-0 text-warn" aria-hidden />} titulo="Página caducada">
          <Link href={RUTA_SIGUIENDO} prefetch={false} className={ENLACE}>Volver al principio</Link>
        </Aviso>
      ) : vista.tipo === 'no_disponible' ? (
        <Aviso alerta icono={<TriangleAlert className="size-[18px] shrink-0 text-warn" aria-hidden />} titulo="Siguiendo aún no está activo">
          <p>Aún no está activo en esta instalación.</p>
        </Aviso>
      ) : (
        <Aviso alerta icono={<TriangleAlert className="size-[18px] shrink-0 text-danger" aria-hidden />} titulo="No se ha podido abrir la lista">
          <Link href={RUTA_SIGUIENDO} prefetch={false} className={ENLACE}>Reintentar</Link>
        </Aviso>
      )}
    </div>
  );
}
