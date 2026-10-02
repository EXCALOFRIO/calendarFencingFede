import type { FilaUnida } from './union';

/**
 * Proyección mínima de la lista unida para «Mi estado».
 *
 * La pantalla sólo necesita dos cosas de cada fila unida: si es de alguno de
 * mis tiradores y cuántas filas visibles tiene cada prueba. Todo lo demás
 * (`observaciones`, con fuente, URL e identidades) sirve para decidir la
 * unión y no debe sobrevivir a ella ni cruzar a la capa de pantalla.
 *
 * Es código puro: la lectura (`inscritosUnidosDeTorneos`) sigue decidiendo la
 * identidad y la unión; aquí sólo se descarta lo que sobra.
 */

export type FilaPropia = {
  competitionId: string;
  athleteId: string;
  equipo: string | null;
  sourceUrl: string | null;
  leidoEl: Date | null;
};

export type RecuentoPrueba = {
  /** Filas visibles tras la unión, no filas crudas de cada fuente. */
  n: number;
  sourceUrl: string | null;
  leidoEl: Date | null;
};

export type ResumenMiEstado = {
  mias: FilaPropia[];
  recuentos: Map<string, RecuentoPrueba>;
};

export function maxFecha(fechas: readonly (Date | null)[]): Date | null {
  return fechas.reduce<Date | null>(
    (max, f) => (f && (!max || f > max) ? f : max),
    null,
  );
}

export function resumirParaMiEstado(
  filas: readonly FilaUnida[],
  athleteIdsPropios: ReadonlySet<string>,
): ResumenMiEstado {
  const mias: FilaPropia[] = [];
  const recuentos = new Map<string, RecuentoPrueba>();

  for (const f of filas) {
    const sourceUrl = f.observaciones.find((o) => o.sourceUrl)?.sourceUrl ?? null;
    const leidoEl = maxFecha(f.observaciones.map((o) => o.leidoEl));

    for (const athleteId of f.athleteIds) {
      if (!athleteIdsPropios.has(athleteId)) continue;
      mias.push({
        competitionId: f.competitionId,
        athleteId,
        equipo: f.equipo,
        sourceUrl,
        leidoEl,
      });
    }

    const actual = recuentos.get(f.competitionId);
    recuentos.set(f.competitionId, {
      n: (actual?.n ?? 0) + 1,
      sourceUrl: actual?.sourceUrl ?? sourceUrl,
      leidoEl: maxFecha([actual?.leidoEl ?? null, leidoEl]),
    });
  }

  return { mias, recuentos };
}

/** Torneos de `necesarios` que todavía no se han leído, sin repetir ninguno. */
export function torneosSinLeer(
  necesarios: readonly string[],
  yaLeidos: ReadonlySet<string>,
): string[] {
  return [...new Set(necesarios)].filter((id) => !yaLeidos.has(id));
}

/** Une dos resúmenes de lecturas distintas; cada prueba sólo pertenece a una. */
export function unirResumenes(a: ResumenMiEstado, b: ResumenMiEstado): ResumenMiEstado {
  return {
    mias: [...a.mias, ...b.mias],
    recuentos: new Map([...a.recuentos, ...b.recuentos]),
  };
}
