import { cargarEvidencia, type DepsEvidencia } from '@/lib/entries/evidencia';
import {
  identificarObservacion,
  refsPublicadas,
  temporadaDe,
  type AtletaConLicencias,
  type RefPublicada,
} from '@/lib/entries/identidad';
import type { ContextoExplorador } from './contexto';
import { resolverPersona } from './personas';

/**
 * Qué persona deportiva es la de la cuenta.
 *
 * Reutiliza la proyección verificada de las inscripciones: sólo cuenta el
 * enlace `sport_person.athlete_id` y lo que la evidencia de la propia ficha
 * demuestra (ID FIE confirmado, licencia vigente) con ida y vuelta, es decir,
 * que la persona resuelta apunte de vuelta a ESTA ficha. Ni un nombre igual ni
 * el `athlete_id` suelto de una inscripción antigua atribuyen nada, y un
 * `conflict` o dos personas candidatas dejan la cuenta sin perfil propio en
 * lugar de elegir una.
 */

export type DepsPropietario = {
  /** Fichas de la cuenta (`getManagedAthletes` en producción). */
  atletasDeCuenta: (profileId: string) => Promise<AtletaConLicencias[]>;
  /** Personas con `sport_person.athlete_id` en estas fichas. */
  personasEnlazadas: (athleteIds: string[]) => Promise<{ personId: string; athleteId: string }[]>;
  fichasFiePorAtleta: (
    athleteIds: string[],
  ) => Promise<{ fieId: number; fieLicense: string | null }[]>;
  evidencia: DepsEvidencia;
};

export type PropietarioResuelto =
  | { estado: 'confirmada'; personaId: string }
  /** La cuenta no tiene ficha de tirador. */
  | { estado: 'sin_ficha' }
  /** Hay ficha, pero ninguna persona deportiva confirmada: se ofrece explorar. */
  | { estado: 'sin_vinculo' }
  /** Dos personas candidatas distintas: no se elige ninguna. */
  | { estado: 'ambigua' }
  /** Las pruebas se contradicen: no establece propiedad. */
  | { estado: 'conflicto' }
  | { estado: 'no_disponible' };

/**
 * Cada referencia se acota con la temporada de SU fuente (FIE «2027», RFEE
 * «2026-2027»). Sin ello el resolvedor usaría la de la observación, que aquí es
 * FIE, y una licencia RFEE guardada con «2026-2027» nunca coincidiría.
 */
function conTemporadaDeSuFuente(dia: string) {
  return (ref: RefPublicada): RefPublicada => ({
    ...ref,
    scopeSeason: ref.scopeSeason || temporadaDe(ref.scopeSource, dia) || '',
  });
}

export async function resolverPersonaPropia(
  ctx: ContextoExplorador,
  profileId: string,
): Promise<PropietarioResuelto> {
  const deps = ctx.propietario;
  const atletas = await deps.atletasDeCuenta(profileId);
  if (atletas.length === 0) return { estado: 'sin_ficha' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };

  const hoy = ctx.hoy();
  const athleteIds = atletas.map((a) => a.id);
  const candidatas = new Set<string>();
  let contradiccion = false;

  // Los enlaces directos y la evidencia de las fichas no dependen entre sí:
  // se leen a la vez (cada rama es una cadena de idas a D1 en el camino del perfil).
  const directas = (async () => {
    const enlaces = await deps.personasEnlazadas(athleteIds);
    const personas = await Promise.all(enlaces.map((e) => resolverPersona(ctx.db, e.personId)));
    return enlaces.map((e, i) => ({ athleteId: e.athleteId, persona: personas[i] }));
  })();
  const conEvidencia = (async () => {
    const fichasPorAtleta = await Promise.all(atletas.map((a) => deps.fichasFiePorAtleta([a.id])));
    const refsPorAtleta = new Map<string, RefPublicada[]>();
    atletas.forEach((a, i) => {
      const refs: RefPublicada[] = [
        ...fichasPorAtleta[i].flatMap((f) =>
          refsPublicadas({ fuente: 'fie', fieId: f.fieId, licencia: f.fieLicense, observadoEl: hoy }),
        ),
        ...refsPublicadas({ fuente: 'fie', licencia: a.fieLicense, observadoEl: hoy }),
        ...refsPublicadas({ fuente: 'skermo_rfee', licencia: a.rfeeLicense, observadoEl: hoy }),
      ];
      refsPorAtleta.set(a.id, refs.map(conTemporadaDeSuFuente(hoy)));
    });
    const evidencia = await cargarEvidencia(deps.evidencia, [...refsPorAtleta.values()].flat());
    return { refsPorAtleta, evidencia };
  })();
  // Si una rama falla primero, la otra no queda sin manejador.
  directas.catch(() => undefined);
  conEvidencia.catch(() => undefined);

  const directasPorAtleta = new Map<string, Set<string>>();
  for (const { athleteId, persona } of await directas) {
    if (!persona) continue;
    candidatas.add(persona.canonicaId);
    const propias = directasPorAtleta.get(athleteId) ?? new Set<string>();
    propias.add(persona.canonicaId);
    directasPorAtleta.set(athleteId, propias);
  }

  const { refsPorAtleta, evidencia } = await conEvidencia;
  for (const a of atletas) {
    const refs = refsPorAtleta.get(a.id) ?? [];
    if (refs.length === 0) continue;
    const identidad = identificarObservacion(
      { fuente: 'fie', refs, arma: '', dia: hoy },
      evidencia,
    );
    if (identidad.resolucion.kind === 'conflict') {
      contradiccion = true;
      continue;
    }
    if (identidad.resolucion.kind !== 'confirmed') continue;
    const persona = await resolverPersona(ctx.db, identidad.resolucion.personId);
    if (!persona) continue;
    // La evidencia que contradice el enlace directo de ESTA ficha no se ignora.
    const directas = directasPorAtleta.get(a.id);
    if (directas && directas.size > 0 && !directas.has(persona.canonicaId)) {
      contradiccion = true;
      continue;
    }
    if (identidad.athleteId !== a.id) continue;
    candidatas.add(persona.canonicaId);
  }

  if (contradiccion) return { estado: 'conflicto' };
  if (candidatas.size > 1) return { estado: 'ambigua' };
  const [unica] = [...candidatas];
  return unica ? { estado: 'confirmada', personaId: unica } : { estado: 'sin_vinculo' };
}
