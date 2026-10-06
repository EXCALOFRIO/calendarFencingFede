import type { PuntoEvolucion } from '@/lib/sport/explorar/rendimiento';
import { medallaDe } from '@/lib/sport/explorar/presentacion';
import type { TonoTipo } from '@/lib/sport/explorar/tipos-social';
import { cn } from '@/lib/utils';
import { camino, COLOR, COLOR_TONO, fraccionDelante, MARCAS_PERCENTIL, mesAnio, yPercentil } from './comun';
import { ALTO, EjeX, Guias, Leyenda, Lienzo, Punto, type Alto } from './eje';
import { Lectura } from './lectura';

/** Rótulo de leyenda de cada tono: varios tipos comparten color de organismo. */
const GRUPO_TONO: Record<TonoTipo, string> = {
  gold: 'JJOO',
  primary: 'Mundial y JJOO',
  'org-efc': 'Europa',
  'org-fie': 'FIE',
  'org-rfee': 'RFEE',
  'org-aut': 'Autonómico',
  off: 'Otras',
};
const ORDEN_TONO: TonoTipo[] = ['gold', 'primary', 'org-efc', 'org-fie', 'org-rfee', 'org-aut', 'off'];

const dia = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/**
 * Mediana móvil de los últimos `ventana` puestos relativos (la tendencia sin
 * el ruido de un mal día), suavizada con una media centrada: con muchas
 * victorias la mediana salta entre «ganó» y «no ganó» y la línea sería un peine.
 */
export function tendencia(valores: number[], ventana = 9, suavizado = 4): number[] {
  const medianas = valores.map((_, i) => {
    const tramo = valores.slice(Math.max(0, i - ventana + 1), i + 1).sort((a, b) => a - b);
    const m = Math.floor(tramo.length / 2);
    return tramo.length % 2 ? tramo[m] : (tramo[m - 1] + tramo[m]) / 2;
  });
  return medianas.map((_, i) => {
    const tramo = medianas.slice(Math.max(0, i - suavizado), i + suavizado + 1);
    return tramo.reduce((s, v) => s + v, 0) / tramo.length;
  });
}

export function lecturaPuesto(p: PuntoEvolucion): string {
  const cuadro = p.participantes ? ` de ${p.participantes}` : '';
  return `${p.puesto}º${cuadro}, ${p.torneo}, ${mesAnio(p.fecha ?? p.fechaOrden)}`;
}

/**
 * Cada competición con puesto como un punto: fecha en horizontal y puesto
 * relativo al cuadro en vertical (parte del cuadro que acabó delante: arriba,
 * ganar). El color es el del organismo del tipo de prueba; los podios llevan
 * aro de su medalla. La línea es la mediana móvil.
 */
export function DispersionPuestos({
  puntos,
  titulo,
  alto = 'lg',
  inicial,
  className,
}: {
  /** Cronológicos, como los da `evolucion`. */
  puntos: PuntoEvolucion[];
  titulo: string;
  alto?: Alto;
  inicial?: string | null;
  className?: string;
}) {
  const validos = puntos
    .map((p) => ({ ...p, delante: fraccionDelante(p.puesto, p.participantes) }))
    .filter((p): p is PuntoEvolucion & { delante: number } => p.delante !== null && p.fechaOrden > '0001-01-01');
  if (validos.length === 0) return null;
  const dias = validos.map((p) => dia(p.fechaOrden));
  const d0 = Math.min(...dias);
  const d1 = Math.max(...dias);
  const x = (d: number) => (d1 === d0 ? 50 : 2 + ((d - d0) / (d1 - d0)) * 96);
  const ventana = Math.min(15, Math.max(5, Math.round(validos.length / 12)));
  const linea = tendencia(validos.map((p) => p.delante), ventana);
  const trazo = validos.length >= 6
    ? camino(linea.map((v, i) => ({ x: x(dias[i]), y: yPercentil(v) })))
    : null;

  const anio0 = new Date(d0 * 86_400_000).getUTCFullYear();
  const anio1 = new Date(d1 * 86_400_000).getUTCFullYear();
  const paso = Math.max(1, Math.ceil((anio1 - anio0) / 5));
  const anios: { x: number; texto: string }[] = [];
  for (let a = anio1; a > anio0; a -= paso) anios.unshift({ x: x(dia(`${a}-01-01`)), texto: String(a) });
  if (anios.length === 0) anios.push({ x: 50, texto: String(anio0) });

  const tonos = ORDEN_TONO.filter((t) => validos.some((p) => p.tono === t));
  const podios = validos.some((p) => p.puesto <= 3);
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
          {anios.map((a) => (
            <div key={a.texto} aria-hidden className="absolute inset-y-0 border-l border-dashed border-filete" style={{ left: `${a.x}%` }} />
          ))}
          {validos.map((p, i) => {
            const medalla = medallaDe(p.puesto);
            return (
              <Punto
                key={p.pruebaId}
                x={x(dias[i])}
                y={yPercentil(p.delante)}
                color={COLOR_TONO[p.tono]}
                tamano={medalla ? 7 : 6}
                borde={medalla ? COLOR[medalla] : undefined}
                lectura={lecturaPuesto(p)}
                className={medalla ? 'z-[1]' : 'opacity-80'}
              />
            );
          })}
          {trazo ? (
            <Lienzo>
              <path d={trazo} fill="none" strokeWidth={3.5} style={{ stroke: 'var(--background)' }} strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.6} />
              <path d={trazo} fill="none" strokeWidth={1.5} style={{ stroke: 'var(--foreground)' }} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </Lienzo>
          ) : null}
        </div>
        <EjeX rotulos={anios} />
      </div>
      <Leyenda
        items={[
          ...tonos.map((t) => ({ color: COLOR_TONO[t], texto: GRUPO_TONO[t] })),
          ...(podios ? [{ color: COLOR.oro, texto: 'Podio', forma: 'aro' as const }] : []),
        ]}
      />
    </Lectura>
  );
}
