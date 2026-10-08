import {
  Bell,
  ChevronRight,
  ClipboardCheck,
  LogOut,
  Megaphone,
  Settings,
  UserCheck,
  UserCog,
  UserRound,
  Users,
} from 'lucide-react';
import { EnlacePrecarga } from '@/components/sistema/enlace-precarga';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import type { ClaveFila, SeccionTu } from './filas';

const ICONO: Record<ClaveFila, React.ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>> = {
  'perfil-deportivo': UserRound,
  siguiendo: UserCheck,
  estado: ClipboardCheck,
  convocatorias: Megaphone,
  tiradores: Users,
  gestion: Settings,
  notificaciones: Bell,
  cuenta: UserCog,
};

const FILA =
  'flex min-h-[48px] w-full items-center gap-3 px-3 text-left text-sm leading-5 font-medium outline-none transition-colors duration-150 ease-out [-webkit-tap-highlight-color:transparent] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-secondary';

/** Quién eres: el avatar y tu nombre, arriba de la lista (el avatar ya no está en la cabecera del móvil). */
export function IdentidadTu({ nombre, iniciales, segundaLinea }: { nombre: string; iniciales: string; segundaLinea: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-1">
      <Avatar className="size-[56px]">
        <AvatarFallback className="text-base font-semibold">{iniciales}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col">
        <p className="truncate text-base leading-5 font-semibold">{nombre}</p>
        {segundaLinea ? <p className="truncate text-xs leading-4 text-muted-foreground">{segundaLinea}</p> : null}
      </div>
    </div>
  );
}

/**
 * Filas de 48 px agrupadas en bloques opacos (`--card`) separados por un
 * filete. Cada fila avanza (`nav-avanzar`) a su subpantalla y precarga por
 * intención.
 */
export function ListaTu({ secciones }: { secciones: SeccionTu[] }) {
  return (
    <>
      {secciones.map((s) => (
        <section key={s.clave} aria-labelledby={s.titulo ? `tu-${s.clave}` : undefined} className="flex min-w-0 flex-col gap-[8px]">
          {s.titulo ? (
            <h2 id={`tu-${s.clave}`} className="px-1 font-sans text-xs leading-4 font-semibold tracking-normal text-muted-foreground">
              {s.titulo}
            </h2>
          ) : null}
          <ul className="sis-aparecer-lista flex flex-col divide-y divide-filete overflow-hidden rounded-[12px] bg-card">
            {s.filas.map((f) => {
              const Icono = ICONO[f.clave];
              return (
                <li key={f.clave}>
                  <EnlacePrecarga href={f.href} transitionTypes={[TIPO_TRANSICION.avanzar]} data-fila={f.clave} className={FILA}>
                    <Icono className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.etiqueta}</span>
                    {f.detalle ? <span className="shrink-0 text-xs leading-4 font-normal text-muted-foreground">{f.detalle}</span> : null}
                    <ChevronRight className="size-[16px] shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden />
                  </EnlacePrecarga>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** «Cerrar sesión», la última fila, sola en su bloque. */
export function FilaSalir({ accion }: { accion: () => Promise<void> }) {
  return (
    <form action={accion} className="overflow-hidden rounded-[12px] bg-card">
      <button type="submit" className={cn(FILA, 'text-danger')}>
        <LogOut className="size-[18px] shrink-0" strokeWidth={2} aria-hidden />
        Cerrar sesión
      </button>
    </form>
  );
}
