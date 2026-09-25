import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn, formatDateEs } from '@/lib/utils';

/**
 * Piezas compartidas por las pantallas de gestión y por «Tiradores».
 *
 * No son componentes de interfaz genéricos —eso es `components/ui`— sino los
 * cuatro patrones que se repiten en estas pantallas: la cabecera, la cifra
 * grande, el estado vacío y la procedencia de un dato. Están juntos para que
 * las siete secciones del panel se lean como una sola aplicación.
 */

/**
 * Cabecera de pantalla: titular y una línea de contexto al lado, con las
 * acciones a la derecha. Nada de "eyebrow" en mayúsculas encima del título.
 */
export function Cabecera({
  titulo,
  contexto,
  acciones,
}: {
  titulo: string;
  contexto?: string;
  acciones?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">{titulo}</h1>
        {contexto ? (
          <p className="medida text-sm text-muted-foreground">{contexto}</p>
        ) : null}
      </div>
      {acciones ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div>
      ) : null}
    </div>
  );
}

const TONO_CIFRA = {
  normal: 'text-foreground',
  ok: 'text-ok',
  aviso: 'text-warn',
  urgente: 'text-danger',
  apagado: 'text-muted-foreground',
} as const;

export type TonoCifra = keyof typeof TONO_CIFRA;

/**
 * Una cifra grande y una palabra pequeña al lado.
 *
 * Es el recurso de jerarquía más fuerte que tiene la aplicación, así que se
 * reserva para los números por los que alguien entra al panel: cuántas
 * inscripciones esperan, cuántas filas han quedado fuera.
 *
 * El color nunca comunica solo: la palabra de debajo dice lo mismo.
 */
export function Cifra({
  valor,
  palabra,
  tono = 'normal',
  href,
  detalle,
}: {
  valor: number | string;
  palabra: string;
  tono?: TonoCifra;
  href?: string;
  detalle?: string;
}) {
  const contenido = (
    <>
      <span className={cn('cifra text-2xl sm:text-4xl', TONO_CIFRA[tono])}>
        {valor}
      </span>
      <span className="text-xs leading-tight text-muted-foreground">{palabra}</span>
      {/*
        La línea de matiz solo en pantalla ancha. En un móvil de 390 px, cinco
        cifras con su matiz ocupaban la pantalla entera y había que bajar dos
        veces para ver el primer dato: el resumen tapaba lo resumido.
      */}
      {detalle ? (
        <span className="hidden text-[11px] leading-tight text-muted-foreground/80 sm:block">
          {detalle}
        </span>
      ) : null}
    </>
  );

  const clases =
    'flex min-w-0 flex-1 basis-32 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 sm:flex-none sm:basis-auto sm:gap-1 sm:py-2.5';

  if (href) {
    return (
      <Link href={href} className={cn(clases, 'transition-colors hover:bg-accent')}>
        {contenido}
      </Link>
    );
  }

  return <div className={clases}>{contenido}</div>;
}

/**
 * Estado vacío: qué pasará ahí y qué hacer ahora, en dos líneas.
 * Nunca "No hay datos".
 */
export function Vacio({
  titulo,
  explicacion,
  accion,
}: {
  titulo: string;
  explicacion: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed px-4 py-8">
      <p className="font-medium">{titulo}</p>
      <p className="medida text-sm text-muted-foreground">{explicacion}</p>
      {accion ? <div className="mt-1">{accion}</div> : null}
    </div>
  );
}

/**
 * De dónde sale un valor de la normativa.
 *
 * Un importe sin procedencia no se puede defender cuando alguien lo discuta,
 * así que se enseña siempre; y cuando la fuente no lo ha rellenado se dice
 * «sin documento de origen» en lugar de dejar el hueco en blanco, que se lee
 * como si el dato fuera oficial.
 */
export function Procedencia({
  documento,
  url,
  fecha,
  className,
}: {
  documento: string | null;
  url?: string | null;
  fecha?: Date | string | null;
  className?: string;
}) {
  const cuando = fecha ? formatDateEs(fecha) : null;

  if (!documento) {
    return (
      <span className={cn('text-xs text-warn', className)}>
        Sin documento de origen
        {cuando ? ` · actualizado el ${cuando}` : ''}
      </span>
    );
  }

  return (
    <span className={cn('text-xs text-muted-foreground', className)}>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          {documento}
        </a>
      ) : (
        documento
      )}
      {cuando ? ` · actualizado el ${cuando}` : ''}
    </span>
  );
}

/** Pastilla de arma con su color. El texto dice el arma; el color acompaña. */
export function PastillaArma({ arma }: { arma: 'FLORETE' | 'ESPADA' | 'SABLE' }) {
  const etiqueta = { FLORETE: 'Florete', ESPADA: 'Espada', SABLE: 'Sable' }[arma];
  return (
    <Badge variant="outline" className="font-normal">
      {etiqueta}
    </Badge>
  );
}
