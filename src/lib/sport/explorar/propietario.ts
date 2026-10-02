import { cargarEvidencia, type DepsEvidencia } from '@/lib/entries/evidencia';
import {
  identificarObservacion,
  refsPublicadas,
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

  for (const enlace of await deps.personasEnlazadas(athleteIds)) {
    const persona = await resolverPersona(ctx.db, enlace.personId);
    if (persona) candidatas.add(persona.canonicaId);
  }

  const refsPorAtleta = new Map<string, RefPublicada[]>();
  for (const a of atletas) {
    const fichas = await deps.fichasFiePorAtleta([a.id]);
    const refs: RefPublicada[] = [
      ...fichas.flatMap((f) =>
        refsPublicadas({ fuente: 'fie', fieId: f.fieId, licencia: f.fieLicense, observadoEl: hoy }),
      ),
      ...refsPublicadas({ fuente: 'fie', licencia: a.fieLicense, observadoEl: hoy }),
      ...refsPublicadas({ fuente: 'skermo_rfee', licencia: a.rfeeLicense, observadoEl: hoy }),
    ];
    refsPorAtleta.set(a.id, refs);
  }

  const evidencia = await cargarEvidencia(deps.evidencia, [...refsPorAtleta.values()].flat());
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
    if (identidad.resolucion.kind !== 'confirmed' || identidad.athleteId !== a.id) continue;
    const persona = await resolverPersona(ctx.db, identidad.resolucion.personId);
    if (persona) candidatas.add(persona.canonicaId);
  }

  if (contradiccion) return { estado: 'conflicto' };
  if (candidatas.size > 1) return { estado: 'ambigua' };
  const [unica] = [...candidatas];
  return unica ? { estado: 'confirmada', personaId: unica } : { estado: 'sin_vinculo' };
}
