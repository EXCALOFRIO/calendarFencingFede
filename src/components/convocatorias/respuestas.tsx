import { cn } from '@/lib/utils';

/**
 * Las tres respuestas de una convocatoria: sí, sin contestar, no.
 *
 * Es la única pregunta por la que un seleccionador abre esta pantalla —«¿a quién
 * tengo que llamar?»— así que va en cifra y en la fila cerrada, sin desplegar
 * nada.
 *
 * Debajo, una barra de tres tramos con el reparto. No es un adorno: con tres
 * cifras sueltas hay que leerlas y compararlas, y con la barra se ve de un
 * vistazo si la convocatoria está resuelta o si falta media lista. Y el color
 * **no comunica solo**: cada tramo tiene su cifra y su palabra encima, y la
 * barra lleva `role="img"` con el reparto escrito para quien no la ve.
 *
 * Los tres colores son los del semáforo (`--ok`, `--muted-foreground`,
 * `--danger`), que aquí significan lo mismo que en el resto de la aplicación:
 * bien, pendiente, mal. No se inventa una paleta nueva para tres estados.
 */
export function Respuestas({
  confirmados,
  pendientes,
  rechazados,
  className,
}: {
  confirmados: number;
  pendientes: number;
  rechazados: number;
  className?: string;
}) {
  const total = confirmados + pendientes + rechazados;

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      {/*
        Tres columnas iguales, no tres cajas que se ajustan a su rótulo.
        Con `flex` normal, «sin contestar» es tres veces más ancho que «sí» y
        las tres cifras salían a distancias distintas: se leían como tres datos
        sueltos en vez de un marcador. Y así cada cifra cae justo encima de su
        tramo de la barra.
      */}
      <div className="grid min-w-0 grid-cols-3 items-start gap-2">
        <Cuenta valor={confirmados} palabra="sí" clase="text-ok" />
        <Cuenta valor={pendientes} palabra="sin contestar" clase="text-warn" />
        <Cuenta valor={rechazados} palabra="no" clase="text-danger" />
      </div>

      {/* Sin nadie convocado no hay reparto que dibujar, y una barra vacía
          parecería un cero. Se dice con palabras, que es lo que hace falta. */}
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">Sin convocados todavía</p>
      ) : (
        <div
          className="flex h-1.5 min-w-0 gap-px overflow-hidden rounded-full"
          role="img"
          aria-label={`${confirmados} confirmados, ${pendientes} sin contestar y ${rechazados} rechazados de ${total} convocados`}
        >
          <Tramo n={confirmados} total={total} clase="bg-ok" />
          <Tramo n={pendientes} total={total} clase="bg-off" />
          <Tramo n={rechazados} total={total} clase="bg-danger" />
        </div>
      )}
    </div>
  );
}

function Cuenta({
  valor,
  palabra,
  clase,
}: {
  valor: number;
  palabra: string;
  clase: string;
}) {
  return (
    <span className="flex min-w-0 flex-col leading-none">
      <span
        className={cn(
          'cifra text-3xl',
          // Un cero no grita: no hay nada que atender ahí.
          valor === 0 ? 'text-muted-foreground' : clase,
        )}
      >
        {valor}
      </span>
      <span className="mt-1 text-xs leading-tight text-muted-foreground">
        {palabra}
      </span>
    </span>
  );
}

function Tramo({
  n,
  total,
  clase,
}: {
  n: number;
  total: number;
  clase: string;
}) {
  if (n === 0) return null;
  return (
    <span
      aria-hidden
      className={clase}
      style={{ flexGrow: n, flexBasis: 0, minWidth: 2 }}
    />
  );
}
