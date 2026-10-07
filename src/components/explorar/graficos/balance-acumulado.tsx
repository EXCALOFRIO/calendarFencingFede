import type { AsaltoCaraACaraRendimiento } from '@/lib/sport/explorar/rendimiento';
import { cn } from '@/lib/utils';
import { camino, COLOR, mesAnio, tinte } from './comun';
import { ALTO, EjeX, Guias, Lienzo, Punto, type Alto } from './eje';
import { Lectura } from './lectura';

const FASE = { POULE: 'poule', TABLEAU: 'directa' } as const;

export function lecturaAsalto(a: AsaltoCaraACaraRendimiento): string {
  const r = a.mios > a.suyos ? 'V' : a.mios < a.suyos ? 'D' : '=';
  return `${r} ${a.mios}–${a.suyos} en ${FASE[a.fase]}, ${a.torneo}, ${mesAnio(a.fecha)}`;
}

/**
 * Victorias menos derrotas acumuladas, asalto a asalto. Por encima del cero
 * va delante `yo` (carmesí), por debajo el rival (gris); cada punto es un
 * asalto, verde si lo ganó `yo` y rojo si lo perdió. El eje horizontal es el
 * orden de los asaltos, no el calendario: dos asaltos el mismo día no se pisan.
 */
export function BalanceAcumulado({
  asaltos,
  yo,
  rival,
  titulo,
  alto = 'md',
  inicial,
  className,
}: {
  asaltos: AsaltoCaraACaraRendimiento[];
  /** Rótulos de una palabra (apellido). */
  yo: string;
  rival: string;
  titulo: string;
  alto?: Alto;
  inicial?: string | null;
  className?: string;
}) {
  const n = asaltos.length;
  if (n === 0) return null;
  // Escala asimétrica: un duelo de +20 y −1 no gasta media gráfica en el lado del rival,
  // pero cada lado conserva al menos una cuarta parte para que su rótulo tenga sitio.
  const balances = asaltos.map((a) => a.balance);
  const lo0 = Math.min(0, ...balances);
  const hi0 = Math.max(lo0 === 0 ? 1 : 0, ...balances);
  const hi = Math.max(hi0, -lo0 / 3);
  const lo = Math.min(lo0, -hi0 / 3);
  const y = (b: number) => 6 + ((hi - b) / (hi - lo)) * 88;
  const cero = y(0);
  // Un tramo de cola tras el último asalto para que su escalón se vea.
  const x = (i: number) => (i / (n + 0.6)) * 100;
  const escalones: { x: number; y: number }[] = [{ x: 0, y: cero }];
  asaltos.forEach((a, i) => {
    escalones.push({ x: x(i + 1), y: y(i === 0 ? 0 : asaltos[i - 1].balance) });
    escalones.push({ x: x(i + 1), y: y(a.balance) });
  });
  escalones.push({ x: 100, y: y(asaltos[n - 1].balance) });
  const anios: { x: number; texto: string }[] = [];
  let previo = '';
  asaltos.forEach((a, i) => {
    const anio = a.fecha?.slice(0, 4) ?? '';
    if (anio && anio !== previo) anios.push({ x: x(i + 1), texto: anio });
    previo = anio || previo;
  });
  return (
    <Lectura inicial={inicial} datos={asaltos.map(lecturaAsalto)} className={className}>
      <div role="img" aria-label={titulo} className="flex min-w-0 flex-col gap-1">
        <div className={cn('relative', ALTO[alto])}>
          <Guias marcas={[{ y: cero, fuerte: true }]} />
          <span aria-hidden className="absolute top-0 left-0 text-[12px] leading-[14px] font-semibold text-primary-text">{yo}</span>
          <span aria-hidden className="absolute bottom-0 left-0 text-[12px] leading-[14px] font-semibold text-muted-foreground">{rival}</span>
          <Lienzo>
            {asaltos.map((a, i) =>
              a.balance === 0 ? null : (
                <rect
                  key={i}
                  x={x(i + 1)}
                  width={(i + 1 < n ? x(i + 2) : 100) - x(i + 1)}
                  y={Math.min(cero, y(a.balance))}
                  height={Math.abs(y(a.balance) - cero)}
                  style={{ fill: tinte(a.balance > 0 ? COLOR.marca : COLOR.apagado, 22) }}
                />
              ),
            )}
            <path d={camino(escalones)} fill="none" strokeWidth={2} style={{ stroke: 'var(--foreground)' }} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </Lienzo>
          {asaltos.map((a, i) => (
            <Punto
              key={i}
              x={x(i + 1)}
              y={y(a.balance)}
              color={a.mios > a.suyos ? COLOR.victoria : a.mios < a.suyos ? COLOR.derrota : COLOR.apagado}
              tamano={n > 60 ? 5 : 7}
              lectura={lecturaAsalto(a)}
            />
          ))}
        </div>
        <EjeX rotulos={anios} />
      </div>
    </Lectura>
  );
}
