import { z } from 'zod';

/**
 * Checkpoint de continuación del ranking FIE, guardado en `sport_import_coverage.cursor`.
 *
 * Lleva todo lo que identifica la lectura (fuente, temporada, `competitionId`
 * y tamaño de página) para que un cursor de otra prueba, de otra temporada o
 * de otro tamaño de página nunca desplace una lectura: en ese caso se empieza
 * por la página 1 en vez de saltar trabajo.
 */

const cursorSchema = z.object({
  v: z.literal(1),
  fuente: z.literal('fie'),
  season: z.number().int(),
  competitionId: z.number().int(),
  pageSize: z.number().int().positive(),
  siguientePagina: z.number().int().min(2),
  total: z.number().int().nonnegative().nullable(),
});

export type CursorFie = z.infer<typeof cursorSchema>;

export function codificarCursorFie(c: Omit<CursorFie, 'v'>): string {
  return JSON.stringify({ v: 1, ...c });
}

export function decodificarCursorFie(texto: string | null | undefined): CursorFie | null {
  if (!texto) return null;
  try {
    const r = cursorSchema.safeParse(JSON.parse(texto));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function desdeCursorFie(
  texto: string | null | undefined,
  lectura: { season: number; competitionId: number; pageSize: number },
): number {
  const c = decodificarCursorFie(texto);
  if (
    !c ||
    c.season !== lectura.season ||
    c.competitionId !== lectura.competitionId ||
    c.pageSize !== lectura.pageSize
  ) {
    return 1;
  }
  return c.siguientePagina;
}
