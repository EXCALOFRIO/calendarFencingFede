import type { Resolution } from '@/lib/identity/resolver';

/**
 * Unión de las listas de inscritos que publican FIE y Skermo para una prueba.
 *
 * Es código puro (sin base de datos) para poder probar la regla de identidad.
 * Dos principios mandan:
 *
 * - **Nadie se descarta por venir de una sola fuente.** Antes manda una fuente
 *   por prueba y la otra desaparecía; ahora cada observación sobrevive y sólo
 *   se funden las que apuntan a la misma identidad CONFIRMADA.
 * - **Nunca se funde por nombre.** Sin ficha emparejada ni persona confirmada,
 *   dos nombres parecidos son dos filas. Un homónimo no puede heredar la
 *   inscripción de otro.
 *
 * La procedencia (fuente, URL, fecha de lectura) se conserva en
 * `observaciones` para conciliar y corregir, pero **no sale en la lista
 * visible**: `aListaVisible` es la única puerta hacia la pantalla.
 */

export type Observacion = {
  /** Prueba donde se pinta la fila (ya reencajada a la prueba de la tarjeta). */
  competitionId: string;
  /** Nombre tal cual lo publica la fuente. */
  nombre: string;
  /** Código de equipo ("CCC-M 1"); cadena vacía en individuales. */
  equipo: string;
  club: string | null;
  /**
   * Ficha local que la propia observación demuestra (ID/licencia confirmados).
   * Nunca por nombre, y nunca el `athlete_id` antiguo de la fila sin prueba.
   */
  athleteId: string | null;
  /** `athlete_id` guardado en la fila pero sin prueba: sólo para revisión. */
  candidatoAthleteId?: string | null;
  /**
   * Resultado del resolvedor de identidad si se conoce. `conflict` (varios IDs
   * confirmados pertinentes) impide fundir; `review`/`none` no cuentan.
   */
  resolucion?: Resolution;
  retiradoEn: Date | null;
  fuente: string;
  sourceUrl: string | null;
  leidoEl: Date | null;
};

export type FilaUnida = {
  competitionId: string;
  nombre: string;
  equipo: string | null;
  club: string | null;
  /**
   * Fichas locales de las que hay prueba; sólo para uso interno. Vacío si
   * alguna evidencia es `conflict` o si la fila reúne fichas distintas: una
   * atribución contradictoria no marca «es mío» ni suprime solicitudes.
   */
  athleteIds: string[];
  /** `null` si alguna observación sigue vigente. */
  retiradoEn: Date | null;
  /** Todas las evidencias, con su procedencia. Nunca se serializa a cliente. */
  observaciones: Observacion[];
};

/** Fuente que se prefiere para ESCRIBIR el nombre, no para descartar a nadie. */
const ORDEN_DE_NOMBRE: Record<string, number> = {
  skermo_rfee: 0,
  skermo_regional: 1,
  fie: 2,
};

function ordenFuente(fuente: string): number {
  return ORDEN_DE_NOMBRE[fuente] ?? 9;
}

export function unirObservaciones(
  observaciones: readonly Observacion[],
  opciones: { incluirRetirados?: boolean } = {},
): FilaUnida[] {
  /** A qué personas confirmadas apunta cada ficha local, según las evidencias. */
  const personasPorFicha = new Map<string, Set<string>>();
  for (const o of observaciones) {
    if (o.athleteId && o.resolucion?.kind === 'confirmed') {
      const set = personasPorFicha.get(o.athleteId) ?? new Set<string>();
      set.add(o.resolucion.personId);
      personasPorFicha.set(o.athleteId, set);
    }
  }

  const grupos = new Map<string, Observacion[]>();
  observaciones.forEach((o, i) => {
    let identidad: string;
    if (o.resolucion?.kind === 'conflict') {
      identidad = `solo:${i}`;
    } else if (o.resolucion?.kind === 'confirmed') {
      identidad = `p:${o.resolucion.personId}`;
    } else if (o.athleteId) {
      const personas = personasPorFicha.get(o.athleteId);
      if (personas && personas.size > 1) identidad = `solo:${i}`;
      else if (personas && personas.size === 1) identidad = `p:${[...personas][0]}`;
      else identidad = `a:${o.athleteId}`;
    } else {
      // La misma fuente repitiendo el mismo nombre exacto es la misma
      // observación, no una persona distinta.
      identidad = `n:${o.fuente}|${o.nombre}`;
    }
    const clave = `${o.competitionId}|${o.equipo}|${identidad}`;
    const lista = grupos.get(clave) ?? [];
    // Releer la misma lista no suma evidencias: una observación por fuente y nombre.
    if (!lista.some((x) => x.fuente === o.fuente && x.nombre === o.nombre)) lista.push(o);
    grupos.set(clave, lista);
  });

  const filas: FilaUnida[] = [];
  for (const obs of grupos.values()) {
    const vigentes = obs.some((o) => o.retiradoEn === null);
    if (!vigentes && !opciones.incluirRetirados) continue;

    const ordenadas = [...obs].sort(
      (a, b) => ordenFuente(a.fuente) - ordenFuente(b.fuente),
    );
    const base = ordenadas[0];
    const conConflicto = obs.some((o) => o.resolucion?.kind === 'conflict');
    const fichas = new Set(obs.flatMap((o) => (o.athleteId ? [o.athleteId] : [])));
    filas.push({
      competitionId: base.competitionId,
      nombre: base.nombre,
      equipo: base.equipo === '' ? null : base.equipo,
      club: ordenadas.find((o) => o.club)?.club ?? null,
      athleteIds: conConflicto || fichas.size > 1 ? [] : [...fichas],
      retiradoEn: vigentes
        ? null
        : obs.reduce<Date | null>(
            (max, o) => (o.retiradoEn && (!max || o.retiradoEn > max) ? o.retiradoEn : max),
            null,
          ),
      observaciones: ordenadas,
    });
  }

  return filas.sort(
    (a, b) =>
      a.competitionId.localeCompare(b.competitionId) ||
      a.nombre.localeCompare(b.nombre, 'es'),
  );
}

/** Observación tal como sale de la base, antes de reencajarla a la prueba visible. */
export type ObservacionCruda = Observacion & {
  /** arma|género|categoría|formato: la prueba sin depender de su fila. */
  prueba: string;
  /** Torneo de la tarjeta (el canónico, no el par absorbido de la FIE). */
  tarjeta: string;
};

/**
 * Cuelga cada observación de la prueba equivalente de la tarjeta.
 *
 * El destino lo decide arma + género + categoría + formato, de modo que una
 * lista de equipos nunca cae en una individual ni masculino en femenino.
 * Sin prueba equivalente la observación se queda en la suya.
 */
export function reencajar(
  crudas: readonly ObservacionCruda[],
  destinoPorPrueba: ReadonlyMap<string, string>,
): Observacion[] {
  return crudas.map(({ prueba, tarjeta, ...o }) => ({
    ...o,
    competitionId: destinoPorPrueba.get(`${tarjeta}|${prueba}`) ?? o.competitionId,
  }));
}

/** Lo único que la lista visible dice de cada inscrito. */
export type InscritoPublicado = {
  competitionId: string;
  nombre: string;
  equipo: string | null;
  club: string | null;
  /** `true` si es uno de los tiradores que gestiona quien está mirando. */
  esMio: boolean;
  retiradoEn: Date | null;
};

/**
 * Proyección explícita campo a campo: ni fuente, ni URL, ni licencia, ni ficha
 * ajena pasan a la respuesta aunque la fila interna las tenga.
 */
export function aListaVisible(
  filas: readonly FilaUnida[],
  athleteIdsPropios: ReadonlySet<string>,
): InscritoPublicado[] {
  return filas.map((f) => ({
    competitionId: f.competitionId,
    nombre: f.nombre,
    equipo: f.equipo,
    club: f.club,
    esMio: f.athleteIds.some((id) => athleteIdsPropios.has(id)),
    retiradoEn: f.retiradoEn,
  }));
}

/** Cuántas filas visibles tiene cada prueba. Cuenta lo que enseña la lista. */
export function contarPorPrueba(filas: readonly { competitionId: string }[]) {
  const porPrueba: Record<string, number> = {};
  for (const f of filas) porPrueba[f.competitionId] = (porPrueba[f.competitionId] ?? 0) + 1;
  return porPrueba;
}
