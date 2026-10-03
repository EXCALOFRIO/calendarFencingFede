import { cargarEvidencia, type DepsEvidencia } from '@/lib/entries/evidencia';
import {
  identificarObservacion,
  refsPublicadas,
  type RefPublicada,
} from '@/lib/entries/identidad';
import { normalizeSportName } from '@/lib/identity/resolver';
import type { EstadoEsquema } from '@/lib/sport/esquema';
import {
  confirmarIdExterno,
  type DepsGuardConfirmacion,
  type IdExternoCandidato,
} from '@/lib/sport/id-guard';
import { sha256 } from '@/lib/utils';
import type { EstadoCobertura } from './sources/fie-resultados';
import type { LecturaSkermo, PruebaSkermo, PuestoSkermo } from './sources/skermo-finales';
import type { FilaResultado, ResumenEscritura } from './fie-resultados-persist';

/**
 * Persistencia de una lectura de puestos finales de Skermo.
 *
 * Mismo contrato que la de la FIE: todo lo que toca la base entra por
 * `DepsPersistenciaSkermo`, la identidad se resuelve con el camino de
 * evidencia confirmada y un ID nuevo sólo se confirma por el guard compartido
 * (`confirmarIdExterno`). Diferencias que importan:
 *
 *  - La licencia RFEE se reutiliza entre personas, así que el ID se confirma
 *    CON ÁMBITO de temporada y una vigencia que cubre esa temporada y el día
 *    de la prueba. Otra temporada con la misma licencia es otro ID: sólo una
 *    conciliación posterior (fusión A→B) puede decir que son la misma persona.
 *  - El ámbito de federación y la fuente salen de `refsPublicadas`, que es lo
 *    que usa la unión de inscritos al buscar; así lo confirmado aquí se
 *    encuentra allí y no se vuelve a crear la persona cada vez.
 *  - Equipos: ninguna persona, sólo la clasificación publicada.
 *  - Una lectura fallida sólo toca la cobertura.
 */

export type FilaCoberturaSkermo = {
  season: string;
  /** Fuente del hecho: `skermo_rfee` o `skermo_regional`. */
  source: string;
  factKind: 'results';
  competitionKey: string;
  competitionId: string | null;
  status: EstadoCobertura;
  /** `undefined` = no tocar la cifra anterior (lectura fallida). */
  publishedTotal?: number | null;
  importedTotal?: number;
  sourceUrl: string;
  lastError: string | null;
};

export type DepsPersistenciaSkermo = {
  esquema: () => Promise<EstadoEsquema>;
  /**
   * ¿Admite `category_code` M10 y M12 (migración 0019)? Sin esta dependencia
   * se supone que no: esas pruebas no se guardan ni como otra categoría.
   */
  categoriasHistoricas?: () => Promise<boolean>;
  evidencia: DepsEvidencia;
  guard: DepsGuardConfirmacion;
  /** Preserve unresolved facts without unbounded per-person writes in a short invocation. */
  crearIdentidades?: boolean;
  upsertPrueba: (prueba: PruebaSkermo) => Promise<string>;
  upsertResultados: (
    source: string,
    competitionId: string,
    filas: FilaResultado[],
  ) => Promise<ResumenEscritura>;
  upsertCobertura: (fila: FilaCoberturaSkermo) => Promise<void>;
  /** Sólo para pruebas deterministas; por defecto `crypto.randomUUID`. */
  nuevoId?: () => string;
};

export type ResumenPersistenciaSkermo = {
  estado: 'aplicado' | 'esquema_no_aplicado';
  competitionId: string | null;
  puestos: ResumenEscritura;
  personas: { confirmadas: number; creadas: number; enRevision: number; conflictos: number };
  cobertura: EstadoCobertura | null;
};

const SIN_ESCRITURA: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };

/** Ventana de la temporada «AAAA-AAAA» ampliada para contener el día de la prueba. */
export function vigenciaDeTemporada(
  season: string,
  fecha: string,
): { validFrom: string; validTo: string } | null {
  const m = season.match(/^(\d{4})-(\d{4})$/);
  if (!m) return null;
  const inicio = `${m[1]}-09-01`;
  const fin = `${m[2]}-08-31`;
  return { validFrom: fecha < inicio ? fecha : inicio, validTo: fecha > fin ? fecha : fin };
}

async function hashDe(...partes: unknown[]): Promise<string> {
  return sha256(JSON.stringify(partes));
}

function refDe(prueba: PruebaSkermo, licencia: string): RefPublicada {
  const [ref] = refsPublicadas({ fuente: prueba.fuente, licencia, observadoEl: prueba.fecha });
  return { ...ref, scopeSeason: prueba.season };
}

async function resolverPersonas(
  deps: DepsPersistenciaSkermo,
  prueba: PruebaSkermo,
  puestos: readonly PuestoSkermo[],
): Promise<{ personas: Map<string, string | null>; resumen: ResumenPersistenciaSkermo['personas'] }> {
  const personas = new Map<string, string | null>();
  const resumen = { confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 };
  const conLicencia = puestos.filter((p) => p.licencia !== null);
  const vigencia = vigenciaDeTemporada(prueba.season, prueba.fecha);
  const evidencia = await cargarEvidencia(
    deps.evidencia,
    conLicencia.map((p) => refDe(prueba, p.licencia as string)),
  );

  for (const p of conLicencia) {
    const ref = refDe(prueba, p.licencia as string);
    const { resolucion } = identificarObservacion(
      { fuente: prueba.fuente, refs: [ref], arma: prueba.arma, dia: prueba.fecha },
      evidencia,
    );
    if (resolucion.kind === 'confirmed') {
      personas.set(p.sourceFactKey, resolucion.personId);
      resumen.confirmadas += 1;
      continue;
    }
    if (resolucion.kind === 'review') {
      personas.set(p.sourceFactKey, null);
      resumen.enRevision += 1;
      continue;
    }
    if (resolucion.kind === 'conflict' || !vigencia) {
      personas.set(p.sourceFactKey, null);
      resumen.conflictos += 1;
      continue;
    }

    if (deps.crearIdentidades === false) {
      personas.set(p.sourceFactKey, null);
      resumen.enRevision += 1;
      continue;
    }
    const id = deps.nuevoId?.() ?? crypto.randomUUID();
    const candidato: IdExternoCandidato = {
      personId: id,
      scheme: ref.scheme,
      value: ref.value,
      scopeSource: ref.scopeSource,
      scopeFederation: ref.scopeFederation,
      scopeSeason: ref.scopeSeason,
      scopeWeapon: ref.scopeWeapon,
      validFrom: vigencia.validFrom,
      validTo: vigencia.validTo,
      linkedVia: 'skermo_finales',
      evidence: `Licencia publicada en la clasificación ${prueba.competitionKey} (${prueba.season})`,
    };
    const confirmado = await confirmarIdExterno(deps.guard, candidato, {
      id,
      displayName: p.nombre,
      nameNormalized: normalizeSportName(p.nombre),
      gender: prueba.genero === 'MIXTO' ? null : prueba.genero,
      countryCode: null,
      aliasSource: prueba.fuente,
    });
    if (confirmado.ok) {
      personas.set(p.sourceFactKey, id);
      resumen.creadas += 1;
    } else {
      personas.set(p.sourceFactKey, null);
      resumen.conflictos += 1;
    }
  }
  return { personas, resumen };
}

async function filasDeResultados(
  puestos: readonly PuestoSkermo[],
  prueba: PruebaSkermo,
  personas: ReadonlyMap<string, string | null>,
): Promise<FilaResultado[]> {
  return Promise.all(
    puestos.map(async (p) => ({
      sourceFactKey: p.sourceFactKey,
      personId: personas.get(p.sourceFactKey) ?? null,
      sourceName: p.nombre,
      sourceCountryCode: null,
      sourceClub: p.club,
      position: p.posicion,
      positionRaw: p.posicionRaw,
      officialPoints: p.puntos,
      occurredOn: prueba.fecha,
      sourceUrl: prueba.url,
      contentHash: await hashDe(p.posicion, p.posicionRaw, p.puntos, p.nombre, p.club, prueba.fecha),
    })),
  );
}

export async function persistirLecturaSkermo(
  deps: DepsPersistenciaSkermo,
  lectura: LecturaSkermo,
): Promise<ResumenPersistenciaSkermo> {
  const resumen: ResumenPersistenciaSkermo = {
    estado: 'aplicado',
    competitionId: null,
    puestos: SIN_ESCRITURA,
    personas: { confirmadas: 0, creadas: 0, enRevision: 0, conflictos: 0 },
    cobertura: null,
  };
  const esquema = await deps.esquema();
  if (!esquema.identidad) return { ...resumen, estado: 'esquema_no_aplicado' };

  const { prueba, cobertura } = lectura;
  // Sin clave de clasificación no hay unidad que registrar: sigue pendiente.
  if (!lectura.competitionKey) return resumen;

  const source = prueba?.fuente ?? (lectura.federacion === 'RFEE' ? 'skermo_rfee' : 'skermo_regional');
  const base = {
    season: lectura.season,
    source,
    factKind: 'results' as const,
    competitionKey: lectura.competitionKey,
    sourceUrl: lectura.url,
  };

  if (!prueba || cobertura.estado === 'error') {
    await deps.upsertCobertura({
      ...base,
      competitionId: null,
      status: cobertura.estado,
      lastError: cobertura.error,
    });
    resumen.cobertura = cobertura.estado;
    return resumen;
  }

  if (
    (prueba.categoria === 'M10' || prueba.categoria === 'M12') &&
    !(deps.categoriasHistoricas && (await deps.categoriasHistoricas()))
  ) {
    await deps.upsertCobertura({
      ...base,
      competitionId: null,
      status: 'pendiente',
      lastError: `La categoría «${prueba.categoriaOriginal ?? prueba.categoria}» necesita la migración 0019 (M10/M12), sin aplicar`,
    });
    resumen.cobertura = 'pendiente';
    return { ...resumen, estado: 'esquema_no_aplicado' };
  }

  const competitionId = await deps.upsertPrueba(prueba);
  resumen.competitionId = competitionId;

  let personas = new Map<string, string | null>();
  if (prueba.formato === 'INDIVIDUAL') {
    const r = await resolverPersonas(deps, prueba, lectura.puestos);
    personas = r.personas;
    resumen.personas = r.resumen;
  }

  if (lectura.puestos.length > 0) {
    resumen.puestos = await deps.upsertResultados(
      source,
      competitionId,
      await filasDeResultados(lectura.puestos, prueba, personas),
    );
  }

  const sinIdentidad = resumen.personas.conflictos + resumen.personas.enRevision;
  const estado: EstadoCobertura =
    cobertura.estado === 'completo' && sinIdentidad > 0 ? 'conflicto' : cobertura.estado;
  await deps.upsertCobertura({
    ...base,
    competitionId,
    status: estado,
    publishedTotal: cobertura.publicado,
    importedTotal: cobertura.importado,
    lastError:
      cobertura.error ??
      (estado === 'conflicto' ? `${sinIdentidad} participantes sin identidad confirmada` : null),
  });
  resumen.cobertura = estado;
  return resumen;
}
