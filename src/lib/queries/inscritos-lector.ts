import { cargarEvidencia, type DepsEvidencia } from '@/lib/entries/evidencia';
import {
  identificarObservacion,
  refsPublicadas,
  type RefPublicada,
} from '@/lib/entries/identidad';
import { estadoDeLista, type EstadoLista } from '@/lib/entries/lectura';
import {
  contarPorPrueba,
  reencajar,
  unirObservaciones,
  type FilaUnida,
  type ObservacionCruda,
} from '@/lib/entries/union';

/**
 * Orquestación de la lectura de inscritos, sin base de datos.
 *
 * Las consultas SQL entran por `DepsLector`, de modo que la regla de identidad
 * (qué ficha prueba cada observación y qué se carga para probarla) se ejercita
 * con dependencias controladas y no sólo con funciones puras sueltas.
 */

export type FilaCruda = {
  registrationId: string;
  competitionId: string;
  prueba: string;
  tarjeta: string;
  arma: string;
  /** Día de la prueba (YYYY-MM-DD): el día del hecho observado. */
  dia: string | null;
  nombre: string;
  equipo: string;
  clubPublicado: string | null;
  licencia: string | null;
  /** `athlete_id` guardado en la fila: candidato sin probar, nunca identidad. */
  athleteIdGuardado: string | null;
  retiradoEn: Date | null;
  fuente: string;
  sourceUrl: string | null;
  leidoEl: Date | null;
};

export type PruebaCruda = {
  id: string;
  prueba: string;
  tarjeta: string;
  propia: boolean;
  consultada: boolean;
};

export type DepsLector = {
  observaciones: (eventIds: string[]) => Promise<{ crudas: FilaCruda[]; pruebas: PruebaCruda[] }>;
  /** Sólo se llama si existe `sport_registration_ref`. */
  referencias: (registrationIds: string[]) => Promise<Map<string, RefPublicada[]>>;
  clubesDe: (athleteIds: string[]) => Promise<Map<string, string | null>>;
  evidencia: DepsEvidencia;
};

export type ListaUnida = {
  filas: FilaUnida[];
  /** Por prueba de la tarjeta: sin consultar, vacía o con datos. */
  estados: Record<string, EstadoLista>;
};

function sinRepetir(refs: readonly RefPublicada[]): RefPublicada[] {
  const mapa = new Map<string, RefPublicada>();
  for (const r of refs) {
    mapa.set(
      [r.scheme, r.value, r.scopeSource, r.scopeFederation, r.scopeSeason, r.scopeWeapon].join('|'),
      r,
    );
  }
  return [...mapa.values()];
}

export async function leerListaUnida(
  deps: DepsLector,
  eventIds: string[],
  opciones: { incluirRetirados?: boolean } = {},
): Promise<ListaUnida> {
  if (eventIds.length === 0) return { filas: [], estados: {} };

  const { crudas, pruebas } = await deps.observaciones(eventIds);

  const esquema = await deps.evidencia.esquema();
  const guardadas =
    esquema.referencias && crudas.length > 0
      ? await deps.referencias(crudas.map((c) => c.registrationId))
      : new Map<string, RefPublicada[]>();

  const refsPorFila = crudas.map((c) =>
    sinRepetir([
      ...(guardadas.get(c.registrationId) ?? []),
      ...refsPublicadas({ fuente: c.fuente, licencia: c.licencia, observadoEl: c.dia }),
    ]),
  );

  const evidencia = await cargarEvidencia(deps.evidencia, refsPorFila.flat());

  const identidades = crudas.map((c, i) =>
    identificarObservacion(
      { fuente: c.fuente, refs: refsPorFila[i], arma: c.arma, dia: c.dia },
      evidencia,
    ),
  );

  const idsVerificados = [
    ...new Set(identidades.flatMap((i) => (i.athleteId ? [i.athleteId] : []))),
  ];
  const clubes =
    idsVerificados.length > 0 ? await deps.clubesDe(idsVerificados) : new Map<string, string | null>();

  /** La prueba española es el destino cuando existe; si no, la de la FIE. */
  const destinoPorPrueba = new Map<string, string>();
  for (const p of [...pruebas].sort((a, b) => Number(b.propia) - Number(a.propia))) {
    const clave = `${p.tarjeta}|${p.prueba}`;
    if (!destinoPorPrueba.has(clave)) destinoPorPrueba.set(clave, p.id);
  }

  const observaciones = reencajar(
    crudas.map<ObservacionCruda>((f, i) => ({
      competitionId: f.competitionId,
      prueba: f.prueba,
      tarjeta: f.tarjeta,
      nombre: f.nombre,
      equipo: f.equipo,
      club:
        f.clubPublicado ??
        (identidades[i].athleteId ? (clubes.get(identidades[i].athleteId!) ?? null) : null),
      athleteId: identidades[i].athleteId,
      candidatoAthleteId: f.athleteIdGuardado,
      resolucion: identidades[i].resolucion,
      retiradoEn: f.retiradoEn,
      fuente: f.fuente,
      sourceUrl: f.sourceUrl,
      leidoEl: f.leidoEl,
    })),
    destinoPorPrueba,
  );

  const filas = unirObservaciones(observaciones, opciones);
  const visibles = contarPorPrueba(filas);

  const estados: Record<string, EstadoLista> = {};
  for (const [clave, destino] of destinoPorPrueba) {
    const consultada = pruebas.some(
      (p) => `${p.tarjeta}|${p.prueba}` === clave && p.consultada,
    );
    estados[destino] = estadoDeLista({ consultada, filas: visibles[destino] ?? 0 });
  }

  return { filas, estados };
}

/** Lo que identifica a los tiradores de una cuenta en las referencias publicadas. */
export type PistasDeAtletas = {
  licencias: string[];
  fieIds: number[];
  /** Valores de IDs externos confirmados de las personas enlazadas a esos tiradores. */
  valores: string[];
};

export type DepsDescubrimiento = {
  esquema: DepsEvidencia['esquema'];
  pistas: (athleteIds: string[]) => Promise<PistasDeAtletas>;
  tarjetas: (entrada: {
    athleteIds: string[];
    pistas: PistasDeAtletas;
    conReferencias: boolean;
    hoy: string;
  }) => Promise<string[]>;
};

/**
 * Torneos (tarjetas) con una inscripción vigente que podría ser de alguno de
 * estos tiradores. Es sólo el filtro previo: lo que cuenta como «mío» lo
 * decide después `leerListaUnida` con la misma prueba que el resto de lectores,
 * así que una pista de más no atribuye nada y una inscripción con
 * `athlete_id` nulo se encuentra por su ID o licencia publicados.
 */
export async function descubrirTarjetas(
  deps: DepsDescubrimiento,
  athleteIds: string[],
  hoy: string,
): Promise<string[]> {
  if (athleteIds.length === 0) return [];
  const [pistas, esquema] = await Promise.all([deps.pistas(athleteIds), deps.esquema()]);
  return deps.tarjetas({ athleteIds, pistas, conReferencias: esquema.referencias, hoy });
}
