import { Badge } from '@/components/ui/badge';
import type { PruebaCompartida } from '@/lib/sport/explorar/rendimiento';
import { medallaDe } from '@/lib/sport/explorar/presentacion';
import { cn } from '@/lib/utils';
import { camino, COLOR, mesAnio, tinte } from './comun';
import { ALTO, EjeX, Guias, Leyenda, Lienzo, Punto, type Alto } from './eje';
import { Lectura } from './lectura';

export function lecturaPrueba(p: PruebaCompartida, yo: string, rival: string): string {
  const cuadro = p.participantes ? ` de ${p.participantes}` : '';
  return `${yo} ${p.puestoYo}º, ${rival} ${p.puestoRival}º${cuadro}, ${p.torneo}, ${mesAnio(p.fecha)}`;
}

export type ResumenDelante = { quien: 'yo' | 'rival' | null; texto: string };

/** «Zabala por delante en el 63 % (25 de 40)», sobre las pruebas con puesto de las dos. */
export function resumenDelante(pruebas: readonly Pick<PruebaCompartida, 'delante'>[], yo: string, rival: string): ResumenDelante | null {
  const total = pruebas.length;
  if (total === 0) return null;
  const nYo = pruebas.filter((p) => p.delante === 'yo').length;
  const nRival = pruebas.filter((p) => p.delante === 'rival').length;
  if (nYo === nRival) return { quien: null, texto: `Empate: ${nYo} y ${nRival} de ${total}` };
  const quien = nYo > nRival ? 'yo' : 'rival';
  const n = Math.max(nYo, nRival);
  return { quien, texto: `${quien === 'yo' ? yo : rival} por delante en el ${Math.round((n / total) * 100)} % (${n} de ${total})` };
}

/**
 * Escala vertical de puestos: logarítmica, con el 1º arriba. Así ganar, ser
 * 3º u 8º se separan bien y un 64º no aplasta el resto contra el techo.
 */
export function escalaPuesto(peor: number) {
  const fondo = Math.log(Math.max(4, peor));
  return (puesto: number) => (Math.log(Math.max(1, puesto)) / fondo) * 100;
}

const MARCAS_PUESTO = [1, 3, 8, 16, 32, 64, 128, 256];

export function marcasPuesto(peor: number): number[] {
  const y = escalaPuesto(peor);
  const salida: number[] = [];
  for (const m of MARCAS_PUESTO) {
    if (m > peor) break;
    // Rótulos de 10 px en 176 px de alto: a menos del 12 % se pisan.
    if (salida.length === 0 || y(m) - y(salida[salida.length - 1]) >= 12) salida.push(m);
  }
  return salida;
}

/** Media móvil centrada (en la escala logarítmica: la del dibujo) de `2·mitad + 1` pruebas. */
export function mediaMovil(valores: readonly number[], mitad: number): number[] {
  return valores.map((_, i) => {
    const tramo = valores.slice(Math.max(0, i - mitad), i + mitad + 1);
    return tramo.reduce((s, v) => s + v, 0) / tramo.length;
  });
}

/**
 * Puestos de las dos en cada prueba común, en orden cronológico: 1º arriba,
 * una columna por prueba con los dos puntos, la media móvil de cada una y los
 * podios con el color de su medalla. Encima, quién acaba por delante más veces.
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
  // El margen izquierdo deja los rótulos del eje (1º, 8º…) libres de puntos.
  const x = (i: number) => (n === 1 ? 50 : 9 + (i / (n - 1)) * 89);
  const peor = Math.max(...pruebas.flatMap((p) => [p.puestoYo, p.puestoRival]));
  const y = escalaPuesto(peor);
  const marcas = marcasPuesto(peor);
  const anios: { x: number; texto: string }[] = [];
  let previo = '';
  pruebas.forEach((p, i) => {
    const anio = p.fecha?.slice(0, 4) ?? '';
    if (anio && anio !== previo) anios.push({ x: x(i), texto: anio });
    previo = anio || previo;
  });
  const mitad = n >= 12 ? 2 : 1;
  const tendencia = (puestos: number[]) =>
    n >= 4 ? camino(mediaMovil(puestos.map(y), mitad).map((v, i) => ({ x: x(i), y: v }))) : null;
  const lineaYo = tendencia(pruebas.map((p) => p.puestoYo));
  const lineaRival = tendencia(pruebas.map((p) => p.puestoRival));
  const podios = pruebas.some((p) => medallaDe(p.puestoYo) || medallaDe(p.puestoRival));
  const resumen = resumenDelante(pruebas, yo, rival);

  return (
    <Lectura inicial={inicial} datos={pruebas.map((p) => lecturaPrueba(p, yo, rival))} className={className}>
      {resumen ? (
        <Badge variant="secondary" className="min-h-6 max-w-full gap-2 px-3 text-left text-xs whitespace-normal">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: resumen.quien === 'yo' ? COLOR.marca : resumen.quien === 'rival' ? COLOR.texto : 'var(--muted-foreground)' }}
          />
          <span>{resumen.texto}</span>
        </Badge>
      ) : null}
      <div role="img" aria-label={titulo} className="flex min-w-0 flex-col gap-1">
        <div className={cn('relative mt-4', ALTO[alto])}>
          <Guias
            marcas={[
              ...marcas.map((m, i) => ({ y: y(m), rotulo: `${m}º`, fuerte: i === 0 })),
              ...(marcas.at(-1) === peor ? [] : [{ y: 100, fuerte: true }]),
            ]}
          />
          {lineaYo || lineaRival ? (
            <Lienzo>
              {lineaRival ? (
                <path d={lineaRival} fill="none" strokeWidth={1.5} strokeDasharray="4 3" style={{ stroke: COLOR.texto }} strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.7} />
              ) : null}
              {lineaYo ? (
                <path d={lineaYo} fill="none" strokeWidth={2} style={{ stroke: COLOR.marca }} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ) : null}
            </Lienzo>
          ) : null}
          {pruebas.map((p, i) => {
            const a = y(p.puestoYo);
            const b = y(p.puestoRival);
            const lectura = lecturaPrueba(p, yo, rival);
            const medallaYo = medallaDe(p.puestoYo);
            const medallaRival = medallaDe(p.puestoRival);
            return (
              <div key={p.pruebaId} data-lectura={lectura}>
                <span
                  aria-hidden
                  className="absolute w-px -translate-x-1/2"
                  style={{
                    left: `${x(i)}%`,
                    top: `${Math.min(a, b)}%`,
                    height: `${Math.abs(a - b)}%`,
                    background: tinte(p.delante === 'yo' ? COLOR.marca : 'var(--muted-foreground)', 40),
                  }}
                />
                <Punto
                  x={x(i)}
                  y={b}
                  color={medallaRival ? COLOR[medallaRival] : COLOR.texto}
                  borde={medallaRival ? COLOR.texto : undefined}
                  tamano={medallaRival ? 8 : 6}
                  lectura={lectura}
                  className={medallaRival ? 'z-[1]' : 'opacity-85'}
                />
                <Punto
                  x={x(i)}
                  y={a}
                  color={medallaYo ? COLOR[medallaYo] : COLOR.marca}
                  borde={medallaYo ? COLOR.marca : undefined}
                  tamano={medallaYo ? 9 : 7}
                  lectura={lectura}
                  className="z-[2]"
                />
              </div>
            );
          })}
        </div>
        <EjeX rotulos={anios} />
      </div>
      <Leyenda
        items={[
          { color: COLOR.marca, texto: yo },
          { color: COLOR.texto, texto: rival },
          ...(lineaYo ? [{ color: 'var(--muted-foreground)', texto: 'Media móvil', forma: 'linea' as const }] : []),
          ...(podios ? [{ color: COLOR.oro, texto: 'Podio', forma: 'aro' as const }] : []),
        ]}
      />
    </Lectura>
  );
}
