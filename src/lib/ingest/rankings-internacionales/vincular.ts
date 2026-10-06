import { normalizeSportName } from '@/lib/identity/resolver';
import type { FilaInternacional, ListaInternacional } from './tipos';

/**
 * Vínculo de una fila de clasificación con una persona deportiva.
 *
 * 1. Si la fuente publica el id FIE, sólo cuenta ese id (`fie_addr_id`
 *    CONFIRMADO), resuelto a la persona canónica.
 * 2. Si no, nombre normalizado exacto (palabras sin acentos, ordenadas) + país
 *    + género (+ año de nacimiento si lo publican las dos partes). Son
 *    candidatas las personas con id FIE confirmado de ese país y las que no lo
 *    tienen pero sí país y género conocidos (p. ej. creadas desde resultados
 *    EFC o nacionales). Se adjunta únicamente si queda UNA candidata. Nada de
 *    parecidos: un nombre distinto es otra persona.
 * 3. En una misma lista una persona sólo puede ocupar una fila
 *    (`vincularLista`).
 */

export type PersonaFie = {
  personId: string;
  /** `null` en personas sin id FIE: sólo entran por nombre y con país y género. */
  fieId: string | null;
  pais: string | null;
  genero: string | null;
  anioNacimiento: number | null;
  nombres: string[];
};

export type IndicePersonas = {
  porFieId: Map<string, string>;
  porNombre: Map<string, { personId: string; genero: string | null; anioNacimiento: number | null }[]>;
};

export const claveNombre = (pais: string, nombre: string) => `${pais}|${normalizeSportName(nombre)}`;

export function indicePersonas(personas: readonly PersonaFie[]): IndicePersonas {
  const porFieId = new Map<string, string>();
  const porNombre: IndicePersonas['porNombre'] = new Map();
  for (const p of personas) {
    if (p.fieId !== null) porFieId.set(p.fieId, p.personId);
    if (!p.pais) continue;
    // Sin id FIE el género es obligatorio: un género desconocido dejaría pasar a cualquiera.
    if (p.fieId === null && p.genero !== 'M' && p.genero !== 'F') continue;
    const claves = new Set(p.nombres.filter((n) => n && n.trim()).map((n) => claveNombre(p.pais!, n)));
    for (const clave of claves) {
      const lista = porNombre.get(clave) ?? [];
      if (!lista.some((x) => x.personId === p.personId)) lista.push({ personId: p.personId, genero: p.genero, anioNacimiento: p.anioNacimiento });
      porNombre.set(clave, lista);
    }
  }
  return { porFieId, porNombre };
}

export type MotivoSinVinculo =
  | 'fie_id_desconocido'
  | 'sin_pais'
  | 'sin_candidata'
  | 'ambigua'
  | 'genero_distinto'
  | 'nacimiento_distinto'
  | 'persona_repetida';
export type VinculoInternacional = { personId: string; via: 'fie_id' | 'nombre' } | { personId: null; motivo: MotivoSinVinculo };

export function vincularFila(
  fila: FilaInternacional,
  lista: Pick<ListaInternacional, 'genero'>,
  /** País de la federación que publica (listas nacionales); `null` en las que traen país por fila. */
  paisFederacion: string | null,
  indice: IndicePersonas,
): VinculoInternacional {
  if (fila.fieId != null) {
    const personId = indice.porFieId.get(String(fila.fieId));
    return personId ? { personId, via: 'fie_id' } : { personId: null, motivo: 'fie_id_desconocido' };
  }
  const pais = fila.pais ?? paisFederacion;
  if (!pais) return { personId: null, motivo: 'sin_pais' };
  const candidatas = indice.porNombre.get(claveNombre(pais, fila.nombre)) ?? [];
  if (candidatas.length === 0) return { personId: null, motivo: 'sin_candidata' };
  const porGenero = candidatas.filter((c) => c.genero === null || c.genero === lista.genero);
  if (porGenero.length === 0) return { personId: null, motivo: 'genero_distinto' };
  const anio = fila.anioNacimiento ?? null;
  const porNacimiento = anio === null ? porGenero : porGenero.filter((c) => c.anioNacimiento === null || c.anioNacimiento === anio);
  if (porNacimiento.length === 0) return { personId: null, motivo: 'nacimiento_distinto' };
  if (porNacimiento.length > 1) return { personId: null, motivo: 'ambigua' };
  return { personId: porNacimiento[0].personId, via: 'nombre' };
}

/**
 * Vincula todas las filas de una lista. Si varias filas apuntan a la misma
 * persona, se conserva la única que venga por id FIE; si no hay exactamente
 * una así, ninguna de ellas queda vinculada.
 */
export function vincularLista(
  filas: readonly FilaInternacional[],
  lista: Pick<ListaInternacional, 'genero'>,
  paisFederacion: string | null,
  indice: IndicePersonas,
): VinculoInternacional[] {
  const vinculos = filas.map((f) => vincularFila(f, lista, paisFederacion, indice));
  const porPersona = new Map<string, number[]>();
  vinculos.forEach((v, i) => {
    if (v.personId) porPersona.set(v.personId, [...(porPersona.get(v.personId) ?? []), i]);
  });
  for (const indices of porPersona.values()) {
    if (indices.length < 2) continue;
    const porId = indices.filter((i) => 'via' in vinculos[i] && (vinculos[i] as { via: string }).via === 'fie_id');
    const conservar = porId.length === 1 ? porId[0] : -1;
    for (const i of indices) if (i !== conservar) vinculos[i] = { personId: null, motivo: 'persona_repetida' };
  }
  return vinculos;
}
