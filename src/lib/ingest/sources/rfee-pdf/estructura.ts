import { dividirPaginaPorPruebas } from './bloques';
import { normalizar } from './geometria';
import { analizarPagina } from './paginas';
import type { PaginaTexto, TipoPagina } from './tipos';

const secciones = new Set<TipoPagina>([
  'clasificacion_final', 'clasificacion_intermedia', 'poules', 'cuadro',
  'participantes', 'formula', 'arbitros', 'estadisticas',
]);
const COLUMNAS = /^(CL\.?|CLAS\.?|POS\.?|LUGAR|APELLIDOS?|APELLIDO NOMBRE|NOMBRE|CLUB|V\/M|IND\.?|TD|TR)$/;

/**
 * Content-free structural hints for grouping local PDFs. Recognized headings
 * do not prove complete/correct extraction and never authorize DB acceptance.
 */
export function perfilarEstructuraPdf(paginas: readonly PaginaTexto[]) {
  if (paginas.length > 400 || paginas.some(p => !Number.isInteger(p.numero) || p.numero < 1 ||
    !Number.isFinite(p.ancho) || p.ancho <= 0 || !Number.isFinite(p.alto) || p.alto <= 0 ||
    p.items.length > 30000)) throw new Error('pdf_structure_bounds_invalid');
  const tipos: Partial<Record<TipoPagina, number>> = {};
  const esquemas = new Set<string>();
  let reconocidas = 0, desconocidas = 0, sinTexto = 0;
  for (const pagina of paginas) {
    for (const bloque of dividirPaginaPorPruebas(pagina)) {
      const analizada = analizarPagina(bloque);
      tipos[analizada.tipo] = (tipos[analizada.tipo] ?? 0) + 1;
      if (secciones.has(analizada.tipo)) {
        reconocidas++;
        // Quantized normalized positions of column labels, never names,
        // tournament headers, participant counts, scores or source text.
        const columnas = analizada.filas.slice(1, 5).flatMap(f => f.items)
          .filter(i => COLUMNAS.test(normalizar(i.s)))
          .map(i => Math.round(i.x / pagina.ancho * 50))
          .filter(Number.isFinite);
        const posiciones = [...new Set(columnas)].sort((a, b) => a - b);
        esquemas.add(`${analizada.tipo}:${Math.round(pagina.ancho / 10)}x${Math.round(pagina.alto / 10)}:${posiciones.join(',')}`);
      } else if (analizada.tipo === 'sin_texto' || analizada.tipo === 'ilegible') sinTexto++;
      else desconocidas++;
    }
  }
  const marcaEngarde = paginas.some(p => p.items.some(i => /\bENGARDE\b/.test(normalizar(i.s))));
  return {
    version: 1, scope: 'layout_hints_only', acceptance: 'requires_source_reconciliation',
    paginas: paginas.length, bloquesReconocidos: reconocidas, bloquesDesconocidos: desconocidas,
    bloquesSinTexto: sinTexto, tipos, marcaEngarde, esquemas: [...esquemas].sort(),
    rutaSugerida: reconocidas > 0 && desconocidas === 0 && sinTexto === 0
      ? 'evaluar_lector_local' : 'revision_de_excepciones',
  } as const;
}
