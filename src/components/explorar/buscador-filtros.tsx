import { BanderaPais } from '@/components/bandera';
import type { Pais } from '@/lib/sport/explorar/paises';

/**
 * Piezas comunes de los buscadores de Explorar (tiradores, competiciones y
 * países). Los filtros de una lista van en `BarraFiltros`
 * (`@/components/filtros/barra-filtros`): un botón y una sola hoja.
 */

export type OpcionFiltro = { valor: string; etiqueta: string };

/** Campo de texto de 40 px con letra de 16 (por debajo, iOS amplía la página al enfocar). */
export const CAMPO_BUSCAR =
  'h-[40px] min-h-[40px] w-full rounded-xl border border-transparent bg-secondary pr-3 pl-10 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none';

/** Fila de país tocable: bandera, nombre y código. Sirve para enlazar o para elegir. */
export function ContenidoPais({ pais }: { pais: Pais }) {
  return (
    <>
      <BanderaPais pais={pais.codigo} soloBandera className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{pais.nombre}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{pais.codigo}</span>
    </>
  );
}

export const CLASE_FILA_PAIS =
  'flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl px-2 text-left outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring aria-pressed:bg-secondary';

export type Anios = { desde: string; hasta: string };

/** Rótulo del chip de fechas: «2018–2024», «Desde 2018», «Hasta 2010» o «Fechas». */
export function rotuloAnios({ desde, hasta }: Anios): string {
  if (desde && hasta) return desde === hasta ? desde : `${desde}–${hasta}`;
  if (desde) return `Desde ${desde}`;
  if (hasta) return `Hasta ${hasta}`;
  return 'Fechas';
}

/** Atajos de fechas de las competiciones, contados desde el año en curso. */
export function atajosAnios(anioActual: number): { etiqueta: string; anios: Anios }[] {
  return [
    { etiqueta: 'Este año', anios: { desde: String(anioActual), hasta: String(anioActual) } },
    { etiqueta: 'Últimos 3 años', anios: { desde: String(anioActual - 2), hasta: String(anioActual) } },
    { etiqueta: 'Últimos 10 años', anios: { desde: String(anioActual - 9), hasta: String(anioActual) } },
    { etiqueta: `Antes de ${anioActual - 9}`, anios: { desde: '', hasta: String(anioActual - 10) } },
  ];
}
