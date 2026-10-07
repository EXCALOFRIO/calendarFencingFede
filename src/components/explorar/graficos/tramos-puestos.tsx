import type { PuntoEvolucion, TemporadaRendimiento } from '@/lib/sport/explorar/rendimiento';
import { BarrasApiladas } from './barras-apiladas';
import { COLOR, tinte } from './comun';
import { porciento, temporadaDeReferencia } from './frases';

/**
 * Hasta dónde llegó en cada competición, por tramos del cuadro de directa:
 * podio, octavos de final (top 8), top 16, top 32 y el resto. Tramos por
 * puesto y no por parte del cuadro: es como se cuenta en esgrima («llegó a
 * los 8 mejores»), y el puesto relativo ya tiene su propia línea.
 */
export const TRAMOS = [
  { clave: 'podio', nombre: 'Podio', lectura: 'en el podio', hasta: 3, color: COLOR.oro },
  { clave: 'top8', nombre: 'Top 8', lectura: 'en el top 8', hasta: 8, color: COLOR.marca },
  { clave: 'top16', nombre: 'Top 16', lectura: 'en el top 16', hasta: 16, color: tinte(COLOR.marca, 55) },
  { clave: 'top32', nombre: 'Top 32', lectura: 'en el top 32', hasta: 32, color: tinte(COLOR.marca, 28) },
  { clave: 'resto', nombre: 'Resto', lectura: 'más allá del 32', hasta: Infinity, color: tinte(COLOR.apagado, 45) },
] as const;

export type ClaveTramo = (typeof TRAMOS)[number]['clave'];
export type ConteoTramos = Record<ClaveTramo, number>;

const vacio = (): ConteoTramos => ({ podio: 0, top8: 0, top16: 0, top32: 0, resto: 0 });

export function tramoDe(puesto: number): ClaveTramo {
  return TRAMOS.find((t) => puesto <= t.hasta)!.clave;
}

/** Competiciones de cada temporada por tramo, en el orden de `temporadas` (con las vacías). */
export function contarTramos(puntos: readonly PuntoEvolucion[], temporadas: readonly TemporadaRendimiento[]): ConteoTramos[] {
  const indice = new Map(temporadas.map((t, i) => [t.temporada, i]));
  const salida = temporadas.map(vacio);
  for (const p of puntos) {
    const i = indice.get(p.temporada);
    if (i !== undefined && p.puesto > 0) salida[i][tramoDe(p.puesto)] += 1;
  }
  return salida;
}

const suma = (c: ConteoTramos) => c.podio + c.top8 + c.top16 + c.top32 + c.resto;
const entre8 = (c: ConteoTramos) => c.podio + c.top8;

function lecturaTemporada(t: TemporadaRendimiento, c: ConteoTramos): string {
  const partes = TRAMOS.filter((x) => c[x.clave] > 0).map((x) => `${c[x.clave]} ${x.lectura}`);
  return `${t.temporada}: ${partes.join(', ')}`;
}

/**
 * Una o dos frases: cuántas veces entró entre los 8 en la temporada de
 * referencia y, si es otra, la temporada en la que más.
 */
export function frasesTramos(conteos: readonly ConteoTramos[], temporadas: readonly TemporadaRendimiento[]): string[] {
  const conPuesto = temporadas.map((t, i) => ({ ...t, competiciones: suma(conteos[i]) }));
  const ref = temporadaDeReferencia(conPuesto);
  if (!ref) return [];
  const c = conteos[conPuesto.indexOf(ref)];
  const n = suma(c);
  const frases: string[] = [];
  if (entre8(c) > 0) {
    frases.push(`En ${ref.corta} llegó al top 8 en ${entre8(c)} de ${n} (${porciento(entre8(c) / n)}).`);
  } else {
    const top32 = c.top16 + c.top32;
    frases.push(top32 > 0
      ? `En ${ref.corta} pasó al top 32 en ${top32} de ${n} competiciones.`
      : `En ${ref.corta}, ${n} ${n === 1 ? 'competición' : 'competiciones'} sin pasar del top 32.`);
  }
  // Mejor temporada: más podios y, a igualdad, más top 8; sólo si no es la de referencia.
  let mejor = -1;
  conteos.forEach((x, i) => {
    if (entre8(x) === 0) return;
    if (mejor < 0 || x.podio > conteos[mejor].podio || (x.podio === conteos[mejor].podio && entre8(x) > entre8(conteos[mejor]))) mejor = i;
  });
  if (mejor >= 0 && temporadas[mejor].temporada !== ref.temporada) {
    const m = conteos[mejor];
    frases.push(m.podio > 0
      ? `Su mejor temporada: ${temporadas[mejor].corta}, con ${m.podio} ${m.podio === 1 ? 'podio' : 'podios'}.`
      : `Su mejor temporada: ${temporadas[mejor].corta}, con ${entre8(m)} top 8.`);
  }
  return frases;
}

/**
 * Barras por temporada con las competiciones partidas por tramo: el podio
 * abajo, para que crezca desde la base y se compare de un vistazo entre
 * temporadas; el resto, apagado, arriba.
 */
export function TramosPuestos({
  puntos,
  temporadas,
  inicial,
  className,
}: {
  puntos: readonly PuntoEvolucion[];
  /** `porTemporada` de la vista: fija el orden y deja los huecos. */
  temporadas: readonly TemporadaRendimiento[];
  inicial?: string | null;
  className?: string;
}) {
  const conteos = contarTramos(puntos, temporadas);
  const total = conteos.reduce((s, c) => s + suma(c), 0);
  if (total === 0) return null;
  const totales = vacio();
  for (const c of conteos) for (const t of TRAMOS) totales[t.clave] += c[t.clave];
  const titulo = `Hasta dónde llegó en cada temporada. En total, de ${total} competiciones: ${
    TRAMOS.filter((t) => totales[t.clave] > 0).map((t) => `${totales[t.clave]} ${t.lectura}`).join(', ')}`;
  return (
    <BarrasApiladas
      titulo={titulo}
      alto="lg"
      inicial={inicial}
      className={className}
      columnas={temporadas.map((t, i) => ({
        etiqueta: t.corta,
        valores: conteos[i],
        lectura: suma(conteos[i]) > 0 ? lecturaTemporada(t, conteos[i]) : null,
      }))}
      series={TRAMOS.map((t) => ({ clave: t.clave, nombre: t.nombre, color: t.color }))}
      leyenda
    />
  );
}
