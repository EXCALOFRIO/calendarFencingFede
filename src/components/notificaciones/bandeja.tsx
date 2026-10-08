import { Bell, BellOff, CalendarClock, CheckCheck, Settings, Trophy, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import type * as React from 'react';
import type { FilaBandeja, GrupoBandeja, SeccionBandeja } from '@/lib/notificaciones/bandeja';
import { puestoTexto, tiempoRelativo } from '@/lib/notificaciones/textos';
import { ETIQUETA_TIPO, type TipoNotificacion } from '@/lib/notificaciones/tipos';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
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
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
      <Componente aria-hidden className="size-[18px]" />
      <span className="sr-only">{ETIQUETA_TIPO[tipo]}: </span>
    </span>
  );
}

/**
 * «Ana García 3.º · Luis Pérez 12.º y 2 más», en una línea que envuelve.
 * Sin `<ul>`: va dentro del `<button>` de la fila, que sólo admite contenido
 * de frase. Las comas para el lector van en `sr-only`.
 */
function Personas({ fila }: { fila: FilaBandeja }) {
  const lineas = fila.datos?.lineas ?? [];
  if (lineas.length < 2) return null;
  const vistas = lineas.slice(0, MAX_PERSONAS);
  const resto = lineas.length - vistas.length;
  return (
    <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      {vistas.map((l, i) => (
        // Nombre y puesto como piezas separadas: un nombre que envuelve no monta sobre su puesto.
        <span key={`${l.nombre}-${i}`} className="flex min-w-0 flex-wrap items-baseline gap-x-1 break-words">
          <span className="min-w-0 text-foreground">{l.nombre}</span> <span className="whitespace-nowrap tabular-nums">{puestoTexto(l.puesto)}</span>
          {i < vistas.length - 1 || resto > 0 ? <span className="sr-only">,</span> : null}
        </span>
      ))}
      {resto > 0 ? <span className="whitespace-nowrap">y {resto} más</span> : null}
    </span>
  );
}

/** «Esta semana» no vale como `id`: un `id` no lleva espacios. */
function idSeccion(titulo: string): string {
  const limpio = titulo
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `notif-${limpio || 'seccion'}`;
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
          className="flex min-h-[56px] w-full min-w-0 items-start gap-3 rounded-xl px-2 py-3 text-left transition-colors duration-150 outline-none [-webkit-tap-highlight-color:transparent] hover:bg-card focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        >
          {/* Lo primero que se oye; el punto rojo, al final, es sólo para la vista. */}
          {nueva ? <span className="sr-only">Sin leer. </span> : null}
          <Icono tipo={fila.tipo} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cn('text-sm break-words text-foreground', nueva ? 'font-semibold' : 'font-normal')}>
              {fila.titulo}
            </span>
            {cuerpo ? <span className="line-clamp-2 text-xs break-words text-muted-foreground">{cuerpo}</span> : null}
            <Personas fila={fila} />
            <span className="text-xs text-muted-foreground">
              <time dateTime={new Date(fila.actualizadaEn).toISOString()}>{tiempoRelativo(fila.actualizadaEn, ahora)}</time>
              {total > 1 ? (
                <>
                  <span aria-hidden> · </span>
                  <span className="sr-only">, </span>
                  {total} avisos
                </>
              ) : null}
            </span>
          </span>
          {nueva ? (
            <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" />
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
    <div className="flex items-center justify-end gap-1">
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
      <EstadoVacio
        icono={BellOff}
        className="py-12"
        titulo={sinMigracion ? 'Avisos sin activar' : 'Sin avisos'}
        descripcion={sinMigracion ? 'El servidor aún no tiene las notificaciones.' : 'Aquí verás resultados, ranking y plazos.'}
        accion={
          <Link href="/ajustes/notificaciones" className={CAJA_TACTIL}>
            <span className={clasesPastilla('secundario')}>Elegir avisos</span>
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {secciones.map((s) => (
        <section key={s.titulo} aria-labelledby={idSeccion(s.titulo)} className="min-w-0">
          <h2 id={idSeccion(s.titulo)} className="px-2 pb-1 font-sans text-sm font-semibold tracking-normal text-muted-foreground">
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
