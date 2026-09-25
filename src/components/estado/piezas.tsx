import { cn } from '@/lib/utils';

/**
 * Las tres piezas con las que está hecha «Mi estado».
 *
 * Salen de la pista y del marcador, que es de donde sale el aspecto de toda
 * la aplicación: una línea blanca fina que separa bandas horizontales, una
 * cifra enorme con una palabra diminuta al lado, y los datos en columnas con
 * su rótulo en lugar de encadenados con puntos medios.
 */

/**
 * Banda de sección: titular, contexto al lado y el filete de un píxel debajo.
 *
 * El filete es la línea de la pista. Hace el trabajo que antes hacía meter
 * cada sección en su propia tarjeta, y a diferencia de la tarjeta no sugiere
 * que todas las secciones pesen lo mismo.
 */
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h2 className="text-xl">{titulo}</h2>
          {contexto ? (
            <p className="text-sm text-muted-foreground">{contexto}</p>
          ) : null}
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}

/**
 * El tamaño de una cifra depende de cuántos dígitos tiene.
 *
 * Con la columna a 5 rem, «8» y «22» entran de sobra a `text-5xl` pero
 * «102» se salía y el navegador lo recortaba por la derecha: la cuenta
 * atrás de un plazo a tres meses vista se leía «10». Tres dígitos bajan un
 * escalón, que sigue siendo enorme al lado del rótulo.
 */
export function tamanoCifra(valor: number): string {
  return Math.abs(valor) >= 100 ? 'text-4xl' : 'text-5xl';
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
 * Cifra de marcador.
 *
 * El contraste entre el número y la palabra ES la jerarquía: por eso la
 * palabra va deliberadamente pequeña y apagada, y por eso no hay un tamaño
 * intermedio. El color nunca comunica solo; la palabra dice lo mismo.
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
    <span className={cn('flex flex-col gap-0.5', className)}>
      <span
        className={cn(
          'cifra',
          tamano === 'enorme' ? 'text-5xl' : 'text-4xl',
          TONO[tono],
        )}
      >
        {valor}
      </span>
      <span className="text-xs leading-tight text-muted-foreground">
        {palabra}
      </span>
    </span>
  );
}

/**
 * El marcador de la pantalla: de dos a cuatro cifras en una chapa.
 *
 * Es lo primero que se ve en el móvil y contesta «¿cómo voy?» sin tocar
 * nada. La chapa se separa del fondo con un filete de luz arriba, no con una
 * sombra, y las celdas se separan entre sí con líneas de un píxel.
 */
export function Marcador({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border-t border-filete bg-border sm:grid-cols-4">
      {children}
    </div>
  );
}

/**
 * Una celda del marcador: la cifra enorme y el rótulo diminuto AL LADO.
 *
 * Al lado y no debajo. Apilados, el rótulo de tres palabras hacía la celda
 * el doble de alta que la cifra y el conjunto dejaba de parecer un marcador
 * para parecer cuatro párrafos con un número encima.
 */
export function CeldaMarcador({
  valor,
  palabra,
  tono = 'normal',
}: {
  valor: React.ReactNode;
  palabra: string;
  tono?: Tono;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 bg-card px-3 py-3 sm:px-4">
      <span className={cn('cifra shrink-0 text-5xl', TONO[tono])}>{valor}</span>
      <span className="min-w-0 text-xs leading-tight text-muted-foreground">
        {palabra}
      </span>
    </div>
  );
}

/**
 * Datos con rótulo, en fila.
 *
 * Sustituye a `Espada · Femenino · Absoluto`. Cuesta dos líneas más de
 * marcado y es la diferencia entre una ficha y un volcado de base de datos:
 * con el rótulo delante, «Absoluto» se lee como una categoría y no como una
 * palabra suelta en una cadena.
 */
export function Rotulos({
  datos,
  /**
   * `linea` pone el rótulo delante del valor en la misma fila. Es lo que se
   * usa en las listas largas: apilado, cada fila de una lista de seis medía
   * media pantalla de móvil y la sección dejaba de verse de un vistazo, que
   * era justo lo que se pedía.
   */
  disposicion = 'columna',
  className,
}: {
  datos: [string, React.ReactNode][];
  disposicion?: 'columna' | 'linea';
  className?: string;
}) {
  const linea = disposicion === 'linea';

  return (
    <dl
      className={cn(
        'flex flex-wrap',
        linea ? 'gap-x-4 gap-y-1' : 'gap-x-6 gap-y-2',
        className,
      )}
    >
      {datos.map(([rotulo, valor]) => (
        <div
          key={rotulo}
          className={cn(
            'flex min-w-0',
            linea ? 'items-baseline gap-1.5' : 'flex-col',
          )}
        >
          <dt className="shrink-0 text-xs text-muted-foreground">{rotulo}</dt>
          <dd className="min-w-0 text-sm">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}
