import { Bell, BellOff, CalendarClock, CheckCheck, Settings, Trophy, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import type { FilaBandeja, GrupoBandeja, SeccionBandeja } from '@/lib/notificaciones/bandeja';
import { puestoTexto, tiempoRelativo } from '@/lib/notificaciones/textos';
import { ETIQUETA_TIPO, type TipoNotificacion } from '@/lib/notificaciones/tipos';
import { cn } from '@/lib/utils';
import { CAJA_TACTIL, clasesCirculo, clasesPastilla } from './control';

type AccionFormulario = NonNullable<React.ComponentProps<'form'>['action']>;

const ICONO: Record<TipoNotificacion, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  inscripciones: Trophy,
  seguidos: Users,
  perfil: UserRound,
  calendario: CalendarClock,
  prueba: Bell,
};

/** Cuántas personas se nombran en un aviso de resultados; el resto, «y N más». */
const MAX_PERSONAS = 3;

/** El icono dice el tipo; el lector de pantalla lo oye como texto. */
function Icono({ tipo }: { tipo: TipoNotificacion }) {
  const Componente = ICONO[tipo] ?? Bell;
  return (
    <span className="flex size-[36px] shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
      <Componente aria-hidden className="size-[18px]" />
      <span className="sr-only">{ETIQUETA_TIPO[tipo]}: </span>
    </span>
  );
}

/** «Ana García 3.º · Luis Pérez 12.º y 2 más», en una línea que envuelve. */
function Personas({ fila }: { fila: FilaBandeja }) {
  const lineas = fila.datos?.lineas ?? [];
  if (lineas.length < 2) return null;
  const vistas = lineas.slice(0, MAX_PERSONAS);
  return (
    <ul className="flex flex-wrap gap-x-[8px] text-[13px] leading-[16px] text-muted-foreground" aria-label="Personas">
      {vistas.map((l, i) => (
        <li key={`${l.nombre}-${i}`} className="min-w-0 break-words">
          <span className="text-foreground">{l.nombre}</span> <span className="whitespace-nowrap tabular-nums">{puestoTexto(l.puesto)}</span>
        </li>
      ))}
      {lineas.length > vistas.length ? <li className="whitespace-nowrap">y {lineas.length - vistas.length} más</li> : null}
    </ul>
  );
}

/**
 * Una competición o un evento: el aviso más reciente de su grupo. La fila
 * entera es el botón (56 px), que marca leído el grupo y lleva a su pantalla.
 * Los avisos anteriores del mismo grupo no se repiten: solo se cuentan.
 */
function Grupo({ grupo, ahora, abrir }: { grupo: GrupoBandeja; ahora: number; abrir: AccionFormulario }) {
  const fila = grupo.principal;
  // Con varias personas el cuerpo (pensado para el móvil) repite la lista: aquí va solo el torneo.
  const cuerpo = (fila.datos?.lineas?.length ?? 0) >= 2 && fila.datos?.contexto ? fila.datos.contexto : fila.cuerpo;
  const nueva = grupo.noLeidas > 0;
  const total = grupo.anteriores.length + 1;
  return (
    <li className="min-w-0">
      <form action={abrir} className="min-w-0">
        <input type="hidden" name="id" value={fila.id} />
        <input type="hidden" name="url" value={fila.url} />
        <button
          type="submit"
          data-leida={nueva ? 'no' : 'si'}
          className="flex min-h-[56px] w-full min-w-0 items-start gap-[12px] rounded-[12px] px-[8px] py-[10px] text-left transition-colors duration-150 outline-none [-webkit-tap-highlight-color:transparent] hover:bg-card focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          <Icono tipo={fila.tipo} />
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className={cn('text-[14px] leading-[20px] break-words text-foreground', nueva ? 'font-semibold' : 'font-normal')}>
              {fila.titulo}
            </span>
            {cuerpo ? <span className="line-clamp-2 text-[13px] leading-[16px] break-words text-muted-foreground">{cuerpo}</span> : null}
            <Personas fila={fila} />
            <span className="text-[12px] leading-[16px] text-muted-foreground">
              <time dateTime={new Date(fila.actualizadaEn).toISOString()}>{tiempoRelativo(fila.actualizadaEn, ahora)}</time>
              {total > 1 ? ` · ${total} avisos` : null}
            </span>
          </span>
          {nueva ? (
            <span className="mt-[6px] size-[8px] shrink-0 rounded-full bg-primary">
              <span className="sr-only">Sin leer</span>
            </span>
          ) : null}
        </button>
      </form>
    </li>
  );
}

/**
 * Las acciones de la bandeja, en una fila a la derecha bajo la cabecera
 * compacta (que lleva el título y la flecha, ver `navegacion-app.ts`).
 */
export function AccionesNotificaciones({ hayNoLeidas, marcarTodas }: { hayNoLeidas: boolean; marcarTodas: AccionFormulario }) {
  return (
    <div className="flex items-center justify-end gap-[4px]">
      {hayNoLeidas ? (
        <form action={marcarTodas}>
          <button type="submit" className={CAJA_TACTIL}>
            <span className={clasesPastilla('secundario')}>
              <CheckCheck aria-hidden />
              Marcar todo leído
            </span>
          </button>
        </form>
      ) : null}
      <Link href="/ajustes/notificaciones" aria-label="Ajustes de notificaciones" className={CAJA_TACTIL}>
        <span className={clasesCirculo('fantasma')}>
          <Settings aria-hidden />
        </span>
      </Link>
    </div>
  );
}

/**
 * La bandeja, compacta como la actividad de Instagram: por tramos de tiempo,
 * una fila por competición o evento y un punto rojo en lo no leído. Sin
 * estado de cliente ni contenido oculto: cada fila es un formulario.
 */
export function BandejaNotificaciones({
  secciones,
  ahora,
  abrir,
  sinMigracion = false,
}: {
  secciones: SeccionBandeja[];
  ahora: number;
  abrir: AccionFormulario;
  sinMigracion?: boolean;
}) {
  if (secciones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-[12px] py-[48px] text-center">
        <span className="flex size-[48px] items-center justify-center rounded-full bg-secondary">
          <BellOff aria-hidden className="size-[20px] text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-[4px]">
          <p className="text-[16px] leading-[20px] font-semibold">{sinMigracion ? 'Avisos sin activar' : 'Sin avisos'}</p>
          <p className="text-[14px] leading-[20px] text-muted-foreground">
            {sinMigracion ? 'El servidor aún no tiene las notificaciones.' : 'Aquí verás resultados, ranking y plazos.'}
          </p>
        </div>
        <Link href="/ajustes/notificaciones" className={CAJA_TACTIL}>
          <span className={clasesPastilla('secundario')}>Elegir avisos</span>
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[16px]">
      {secciones.map((s) => (
        <section key={s.titulo} aria-labelledby={`notif-${s.titulo}`} className="min-w-0">
          <h2 id={`notif-${s.titulo}`} className="px-[8px] pb-[4px] font-sans text-[13px] leading-[16px] font-semibold tracking-normal text-muted-foreground">
            {s.titulo}
          </h2>
          <ul className="flex flex-col">
            {s.grupos.map((g) => (
              <Grupo key={g.grupo} grupo={g} ahora={ahora} abrir={abrir} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
