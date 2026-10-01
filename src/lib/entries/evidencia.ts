import type { ExternalIdRow } from '@/lib/identity/resolver';
import type { EstadoEsquema } from '@/lib/sport/esquema';
import {
  valoresDeEvidencia,
  type AtletaConLicencias,
  type EvidenciaExterna,
  type FichaFieConfirmada,
  type PersonaDeportiva,
  type RefPublicada,
} from './identidad';

/**
 * Qué se consulta para identificar un lote de observaciones.
 *
 * Las tablas deportivas sólo se tocan si el esquema está aplicado; las
 * anteriores (`athlete`, `fie_fencer`) siempre existen. Ninguna función
 * captura errores: si la base falla, falla la lectura entera, que es un
 * `error` y no «sin evidencia».
 */
export type DepsEvidencia = {
  esquema: () => Promise<EstadoEsquema>;
  atletasPorLicencia: (licencias: string[]) => Promise<AtletaConLicencias[]>;
  fichasFie: (fieIds: number[], licencias: string[]) => Promise<FichaFieConfirmada[]>;
  externos: (valores: string[]) => Promise<ExternalIdRow[]>;
  personas: (ids: string[]) => Promise<Map<string, PersonaDeportiva>>;
};

/** Cuántas veces se sigue una fusión de personas (A→B→C) antes de rendirse. */
const SALTOS_DE_FUSION = 3;

export async function cargarEvidencia(
  deps: DepsEvidencia,
  refs: readonly RefPublicada[],
): Promise<EvidenciaExterna> {
  if (refs.length === 0) {
    return { externos: [], personas: new Map(), atletas: [], fichasFie: [] };
  }
  const { licencias, fieIds, valores } = valoresDeEvidencia(refs);
  const esquema = await deps.esquema();

  const [atletas, fichasFie, externos] = await Promise.all([
    licencias.length > 0 ? deps.atletasPorLicencia(licencias) : Promise.resolve([]),
    fieIds.length > 0 || licencias.length > 0
      ? deps.fichasFie(fieIds, licencias)
      : Promise.resolve([]),
    esquema.identidad && valores.length > 0 ? deps.externos(valores) : Promise.resolve([]),
  ]);

  const personas = new Map<string, PersonaDeportiva>();
  if (esquema.identidad) {
    let pendientes = [
      ...new Set(externos.flatMap((e) => (e.personId ? [e.personId] : []))),
    ];
    for (let salto = 0; salto <= SALTOS_DE_FUSION && pendientes.length > 0; salto += 1) {
      const cargadas = await deps.personas(pendientes);
      for (const [id, p] of cargadas) personas.set(id, p);
      pendientes = [
        ...new Set(
          [...cargadas.values()].flatMap((p) =>
            p.mergedIntoPersonId && !personas.has(p.mergedIntoPersonId)
              ? [p.mergedIntoPersonId]
              : [],
          ),
        ),
      ];
    }
  }

  return { externos, personas, atletas, fichasFie };
}
