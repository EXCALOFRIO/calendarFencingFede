import type { PruebaCompartida } from '@/lib/sport/explorar/rendimiento';
import { cn } from '@/lib/utils';
import { COLOR, fraccionDelante, MARCAS_PERCENTIL, mesAnio, tinte, yPercentil } from './comun';
import { ALTO, EjeX, Guias, Leyenda, Punto, type Alto } from './eje';
import { Lectura } from './lectura';

export function lecturaPrueba(p: PruebaCompartida, yo: string, rival: string): string {
  const cuadro = p.participantes ? ` de ${p.participantes}` : '';
  return `${yo} ${p.puestoYo}º, ${rival} ${p.puestoRival}º${cuadro}, ${p.torneo}, ${mesAnio(p.fecha)}`;
}

/**
 * Puestos de las dos en cada prueba común, en orden cronológico: una
 * columna por prueba con los dos puntos unidos. La unión toma el color de
 * quien acabó delante. Vertical: puesto relativo al cuadro (arriba, ganar).
 */
export function PuestosComparados({
  pruebas,
  yo,
  rival,
  titulo,
  alto = 'lg',
  inicial,
  className,
}: {
  pruebas: PruebaCompartida[];
  yo: string;
  rival: string;
  titulo: string;
  alto?: Alto;
  inicial?: string | null;
  className?: string;
}) {
  const n = pruebas.length;
  if (n === 0) return null;
  const x = (i: number) => (n === 1 ? 50 : 3 + (i / (n - 1)) * 94);
  // Sin cuadro publicado, el peor de los dos puestos hace de cuadro: la distancia se ve igual.
  const rel = (puesto: number, p: PruebaCompartida) =>
    fraccionDelante(puesto, p.participantes ?? Math.max(p.puestoYo, p.puestoRival, 2)) ?? 1;
  const anios: { x: number; texto: string }[] = [];
  let previo = '';
  pruebas.forEach((p, i) => {
    const anio = p.fecha?.slice(0, 4) ?? '';
    if (anio && anio !== previo) anios.push({ x: x(i), texto: anio });
    previo = anio || previo;
  });
  return (
    <Lectura inicial={inicial} className={className}>
      <div role="img" aria-label={titulo} className="flex min-w-0 flex-col gap-1">
        <div className={cn('relative mt-3', ALTO[alto])}>
          <Guias
            marcas={[
              { y: 0, rotulo: '1º', fuerte: true },
              ...MARCAS_PERCENTIL.map((m) => ({ y: yPercentil(m.p), rotulo: m.rotulo })),
              { y: 100, fuerte: true },
            ]}
          />
          {pruebas.map((p, i) => {
            const a = yPercentil(rel(p.puestoYo, p));
            const b = yPercentil(rel(p.puestoRival, p));
            const lectura = lecturaPrueba(p, yo, rival);
            return (
              <div key={p.pruebaId} data-lectura={lectura}>
                <span
                  aria-hidden
                  className="absolute w-0.5 -translate-x-1/2 rounded-full"
                  style={{
                    left: `${x(i)}%`,
                    top: `${Math.min(a, b)}%`,
                    height: `${Math.abs(a - b)}%`,
                    background: p.delante === 'yo' ? tinte(COLOR.marca, 70) : tinte('var(--muted-foreground)', 55),
                  }}
                />
                <Punto x={x(i)} y={b} color={COLOR.texto} tamano={6} lectura={lectura} />
                <Punto x={x(i)} y={a} color={COLOR.marca} tamano={7} lectura={lectura} className="z-[1]" />
              </div>
            );
          })}
        </div>
        <EjeX rotulos={anios} />
      </div>
      <Leyenda items={[{ color: COLOR.marca, texto: yo }, { color: COLOR.texto, texto: rival }]} />
    </Lectura>
  );
}
