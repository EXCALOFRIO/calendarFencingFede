import { RUTA_EXPLORAR } from './url';

export const RUTA_EDICIONES = `${RUTA_EXPLORAR}/ediciones`;

export const FUENTES_CATALOGO = [
  { valor: 'fie', etiqueta: 'FIE' },
  { valor: 'skermo_rfee', etiqueta: 'RFEE / Skermo HTML' },
  { valor: 'rfee_pdf', etiqueta: 'RFEE PDF' },
  { valor: 'engarde', etiqueta: 'Engarde' },
] as const;

export type CriteriosCatalogo = { q: string; fuente: string; temporada: string };
type Parametros = Record<string, string | string[] | undefined>;

export function leerCriteriosCatalogo(params: Parametros) {
  const primero = (valor: string | string[] | undefined, limite: number) =>
    ((Array.isArray(valor) ? valor[0] : valor) ?? '').trim().slice(0, limite + 1);
  return {
    criterios: {
      q: primero(params.q, 100),
      fuente: primero(params.fuente, 40),
      temporada: primero(params.temporada, 9),
    },
    cursor: primero(params.cursor, 600) || undefined,
  };
}

export function urlCatalogo(criterios: CriteriosCatalogo, cursor?: string): string {
  const params = new URLSearchParams();
  for (const clave of ['q', 'fuente', 'temporada'] as const) {
    if (criterios[clave]) params.set(clave, criterios[clave]);
  }
  if (cursor) params.set('cursor', cursor);
  const texto = params.toString();
  return `${RUTA_EDICIONES}${texto ? `?${texto}` : ''}`;
}

/** Sólo el índice local y sus filtros conocidos, nunca un destino arbitrario. */
export function sanitizarRetornoCatalogo(crudo: string | undefined): string {
  if (!crudo || crudo.length > 4096 || /[\r\n\0#]/.test(crudo) ||
    (crudo !== RUTA_EDICIONES && !crudo.startsWith(`${RUTA_EDICIONES}?`))) return '';
  const params = new URLSearchParams(crudo.slice(RUTA_EDICIONES.length));
  const { criterios, cursor } = leerCriteriosCatalogo({
    q: params.get('q') ?? undefined,
    fuente: params.get('fuente') ?? undefined,
    temporada: params.get('temporada') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
  });
  if (criterios.q.length > 100 ||
    (criterios.fuente && !FUENTES_CATALOGO.some((f) => f.valor === criterios.fuente)) ||
    (criterios.temporada && !/^\d{4}(?:-\d{4})?$/.test(criterios.temporada)) ||
    (cursor && cursor.length > 600)) return '';
  return urlCatalogo(criterios, cursor);
}
