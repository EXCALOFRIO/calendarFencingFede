import { CabeceraSeccion } from '@/components/sistema/cabecera-seccion';
import { FilaHorario, horaEnMadrid } from '@/components/sistema/hora-doble';
import { cn } from '@/lib/utils';

/**
 * Las piezas con las que está hecha «Mi estado»: bandas separadas por un
 * filete fino, una cifra grande con una palabra pequeña debajo, y los datos
 * con su rótulo delante.
 */

/** Banda de sección: la cabecera del sistema con el filete de un píxel debajo. */
export function Seccion({
  titulo,
  contexto,
  accion,
  children,
  className,
}: {
  titulo: string;
  contexto?: React.ReactNode;
  accion?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col', className)}>
      <CabeceraSeccion
        titulo={titulo}
        contexto={contexto}
        accion={accion}
        className="border-b border-border pb-2"
      />
      {children}
    </section>
  );
}

const TONO = {
  normal: 'text-foreground',
  ok: 'text-ok',
  aviso: 'text-warn',
  urgente: 'text-danger',
  oro: 'text-gold',
  carmesi: 'text-primary-text',
  apagado: 'text-muted-foreground',
} as const;

export type Tono = keyof typeof TONO;

/**
 * Cifra de marcador. El contraste entre el número y la palabra es la
 * jerarquía; el color nunca comunica solo, la palabra dice lo mismo.
 */
export function Cuenta({
  valor,
  palabra,
  tono = 'normal',
  tamano = 'grande',
  className,
}: {
  valor: React.ReactNode;
  palabra: string;
  tono?: Tono;
  tamano?: 'grande' | 'enorme';
  className?: string;
}) {
  return (
    <span className={cn('flex flex-col gap-1', className)}>
      <span className={cn('cifra', tamano === 'enorme' ? 'text-5xl' : 'text-4xl', TONO[tono])}>{valor}</span>
      <span className="text-xs leading-tight text-muted-foreground">{palabra}</span>
    </span>
  );
}

/**
 * El marcador de la pantalla: una cifra por pregunta, en una fila de móvil.
 * Con cuatro celdas (hay convocatoria sin contestar), dos por fila en el
 * móvil en vez de estrujar las tres primeras.
 */
export function Marcador({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border',
        '[&:has(>*:nth-child(4))]:grid-cols-2 sm:[&:has(>*:nth-child(4))]:grid-cols-4',
      )}
    >
      {children}
    </div>
  );
}

/**
 * Una celda del marcador: la cifra grande y el rótulo pequeño debajo.
 * `compacto` para cifras de cuatro dígitos o más («1387,77»), que a
 * `text-4xl` no caben en un tercio de móvil y se recortarían.
 */
export function CeldaMarcador({
  valor,
  palabra,
  tono = 'normal',
  tamano = 'normal',
}: {
  valor: React.ReactNode;
  palabra: string;
  tono?: Tono;
  tamano?: 'normal' | 'compacto';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-3 py-3 sm:px-4">
      <span
        className={cn(
          'cifra tabular-nums',
          tamano === 'compacto' ? 'text-2xl sm:text-3xl' : 'text-4xl sm:text-5xl',
          TONO[tono],
        )}
      >
        {valor}
      </span>
      <span className="text-xs leading-tight text-muted-foreground">{palabra}</span>
    </div>
  );
}

/**
 * Los horarios del día de la prueba, uno por fila: la hora oficial de la sede
 * y, si la sede está en otro huso, la de España a la derecha con su «+1 día».
 * Sin horarios publicados se dice; no se rellena con una hora plausible.
 */
export function Horarios({
  horas,
  fecha,
  huso,
}: {
  horas: [string, string | null][];
  /** Día de la prueba (`AAAA-MM-DD`), para pasar las horas a España. */
  fecha?: string | null;
  /** Huso de la sede. */
  huso?: string | null;
}) {
  const publicadas = horas
    .filter((h): h is [string, string] => Boolean(h[1]))
    .map(([rotulo, hora]) => {
      const oficial = hora.slice(0, 5);
      return { rotulo, oficial, local: fecha ? horaEnMadrid(fecha.slice(0, 10), oficial, huso) : null };
    });

  if (publicadas.length === 0) {
    return <p className="text-sm text-muted-foreground">Horarios sin publicar</p>;
  }

  const enOtroHuso = publicadas.some((h) => h.local);
  return (
    <div className="flex min-w-0 flex-col">
      {enOtroHuso ? (
        <p aria-hidden className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] gap-x-3 text-xs text-muted-foreground">
          <span>Sede</span>
          <span />
          <span className="text-right">España</span>
        </p>
      ) : null}
      <div className="flex min-w-0 flex-col divide-y divide-border">
        {publicadas.map((h) => (
          <FilaHorario key={h.rotulo} hora={h.oficial} titulo={h.rotulo} local={h.local} className="py-2" />
        ))}
      </div>
    </div>
  );
}
