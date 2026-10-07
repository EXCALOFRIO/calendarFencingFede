import { sql } from 'drizzle-orm';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import type { AvisoNuevo } from './agrupar';
import { guardarAvisos, leerPreferencias, type AvisoGuardado } from './bandeja';
import { destinoPerfil } from './destinos';
import { filasDe, jsonLista, type DbAvisos } from './db';
import { puestoTexto, recortar } from './textos';
import type { Preferencias } from './tipos';
import { PREFERENCIAS_POR_DEFECTO } from './tipos';

/**
 * ===========================================================================
 * CAMBIOS EN TU PERFIL: RANKING Y ESTADO OLÍMPICO
 * ===========================================================================
 *
 * No hay un «evento» de ranking: se compara la lectura de hoy con la última
 * guardada en `notificacion_lectura`. Reglas, todas a favor de no avisar en
 * falso:
 *
 *   - la primera lectura de una persona solo se guarda (no hay «antes»);
 *   - una clave que deja de leerse NO es un cambio y no se borra: las
 *     lecturas devuelven vacío cuando fallan, y eso no puede convertirse en
 *     «has salido del ranking»;
 *   - un valor distinto es un cambio; una clave nueva en una persona que ya
 *     tenía lecturas, también («entra en el ranking»).
 */

export type Lectura = {
  /** 'nacional:<lista>', 'internacional:<organismo>:<lista>', 'olimpico:<arma>-<género>'. */
  clave: string;
  /** Lo que se compara: '2025-2026|5', 'clasificado'. */
  valor: string;
  /** «Ranking nacional · Espada femenino M17». */
  etiqueta: string;
};

export type LecturasPersona = { personId: string; lecturas: Lectura[] };

export type Cambio = { clave: string; antes: string | null; ahora: string; texto: string };

const ESTADO_OLIMPICO: Record<string, string> = {
  clasificado: 'en plaza olímpica',
  cerca: 'cerca de la plaza olímpica',
  pendiente: 'plaza pendiente de confirmar',
};

function describir(l: Lectura, antes: string | null): string {
  if (l.clave.startsWith('olimpico:')) {
    const ahora = ESTADO_OLIMPICO[l.valor] ?? l.valor;
    return antes === null ? `${l.etiqueta}: ${ahora}` : `${l.etiqueta}: ${ahora} (antes ${ESTADO_OLIMPICO[antes] ?? antes})`;
  }
  const [temporada, puesto] = l.valor.split('|');
  const ahora = puestoTexto(puesto ? Number(puesto) : null);
  if (antes === null) return `${l.etiqueta}: entras en el ${ahora}`;
  const [temporadaAntes, puestoAntes] = antes.split('|');
  const previo = puestoTexto(puestoAntes ? Number(puestoAntes) : null);
  return temporada === temporadaAntes
    ? `${l.etiqueta}: ${ahora} (antes ${previo})`
    : `${l.etiqueta}: ${ahora} en ${temporada} (antes ${previo} en ${temporadaAntes})`;
}

export function compararLecturas(anteriores: ReadonlyMap<string, string>, nuevas: readonly Lectura[]): Cambio[] {
  if (anteriores.size === 0) return [];
  const cambios: Cambio[] = [];
  for (const l of nuevas) {
    const antes = anteriores.get(l.clave) ?? null;
    if (antes === l.valor) continue;
    cambios.push({ clave: l.clave, antes, ahora: l.valor, texto: describir(l, antes) });
  }
  return cambios;
}

/** Huella corta y estable de un conjunto de cambios: la misma subida no se avisa dos veces. */
export function huella(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function construirAvisosPerfil(
  personaId: string,
  nombre: string,
  cambios: readonly Cambio[],
  perfiles: readonly string[],
  preferencias: ReadonlyMap<string, Preferencias>,
): AvisoNuevo[] {
  if (cambios.length === 0 || !nombre) return [];
  const firma = huella(cambios.map((c) => `${c.clave}=${c.ahora}`).sort().join(';'));
  const titulo = cambios.length === 1 ? `Cambio en el perfil de ${nombre}` : `Cambios en el perfil de ${nombre}`;
  return [...new Set(perfiles)]
    .filter((p) => (preferencias.get(p) ?? PREFERENCIAS_POR_DEFECTO)['tipo:perfil'])
    .map((profileId) => ({
      profileId,
      tipo: 'perfil' as const,
      clave: `perfil:${personaId}:${firma}`,
      grupo: `persona:${personaId}`,
      titulo: recortar(titulo, 200),
      cuerpo: recortar(cambios.map((c) => c.texto).join('; '), 1000),
      url: destinoPerfil(personaId),
      datos: { contexto: nombre, detalles: cambios.map((c) => recortar(c.texto, 200)) },
    }));
}

// ---------------------------------------------------------------- con base

export type PersonaVinculada = { personId: string; nombre: string; perfiles: string[] };

/** Personas deportivas de las fichas con cuenta (propia o de tutor), ya canónicas. */
export async function personasVinculadas(db: DbAvisos): Promise<PersonaVinculada[]> {
  const filas = await filasDe<{ canon: string; nombre: string; user_profile_id: string | null; guardian_profile_id: string | null }>(db, sql`
    WITH RECURSIVE cadena(origen, id, siguiente, salto) AS (
      SELECT p.id, p.id, p.merged_into_person_id, 0
      FROM sport_person p JOIN athlete a ON a.id = p.athlete_id
      WHERE a.active = 1 AND (a.user_profile_id IS NOT NULL OR a.guardian_profile_id IS NOT NULL)
      UNION ALL
      SELECT c.origen, p.id, p.merged_into_person_id, c.salto + 1
      FROM sport_person p JOIN cadena c ON p.id = c.siguiente WHERE c.salto < 3
    )
    SELECT c.id AS canon, cp.display_name AS nombre, a.user_profile_id, a.guardian_profile_id
    FROM cadena c
    JOIN sport_person o ON o.id = c.origen
    JOIN athlete a ON a.id = o.athlete_id
    JOIN sport_person cp ON cp.id = c.id
    WHERE c.siguiente IS NULL`);
  const porPersona = new Map<string, PersonaVinculada>();
  for (const f of filas) {
    const p = porPersona.get(f.canon) ?? { personId: f.canon, nombre: nombreVisible(f.nombre), perfiles: [] };
    for (const id of [f.user_profile_id, f.guardian_profile_id]) if (id && !p.perfiles.includes(id)) p.perfiles.push(id);
    porPersona.set(f.canon, p);
  }
  return [...porPersona.values()];
}

export async function leerLecturasGuardadas(db: DbAvisos, personIds: readonly string[]): Promise<Map<string, Map<string, string>>> {
  const salida = new Map<string, Map<string, string>>();
  if (personIds.length === 0) return salida;
  for (const f of await filasDe<{ person_id: string; clave: string; valor: string }>(db, sql`
    SELECT person_id, clave, valor FROM notificacion_lectura
    WHERE person_id IN (SELECT value FROM json_each(${jsonLista(personIds)}))`)) {
    const m = salida.get(f.person_id) ?? new Map<string, string>();
    m.set(f.clave, f.valor);
    salida.set(f.person_id, m);
  }
  return salida;
}

export async function guardarLecturas(db: DbAvisos, personId: string, lecturas: readonly Lectura[], ahora: Date): Promise<void> {
  if (lecturas.length === 0) return;
  const filas = JSON.stringify(lecturas.map((l) => [l.clave.slice(0, 120), l.valor.slice(0, 200)]));
  await db.execute(sql`
    INSERT INTO notificacion_lectura (person_id, clave, valor, leida_en)
    SELECT ${personId}, json_extract(value, '$[0]'), json_extract(value, '$[1]'), ${ahora.getTime()} FROM json_each(${filas}) WHERE true
    ON CONFLICT (person_id, clave) DO UPDATE SET valor = excluded.valor, leida_en = excluded.leida_en`);
}

export type LectorPerfil = (personas: readonly PersonaVinculada[]) => Promise<LecturasPersona[]>;

export type ResumenPerfil = { personas: number; cambios: number; guardados: AvisoGuardado[] };

/**
 * Compara, guarda la lectura nueva y genera los avisos. La lectura se guarda
 * aunque el tipo esté apagado: al encenderlo no debe llegar de golpe todo lo
 * que cambió mientras estuvo apagado.
 */
export async function registrarLecturasPerfil(
  db: DbAvisos,
  personas: readonly PersonaVinculada[],
  lecturas: readonly LecturasPersona[],
  ahora = new Date(),
): Promise<ResumenPerfil> {
  const porId = new Map(personas.map((p) => [p.personId, p]));
  const anteriores = await leerLecturasGuardadas(db, lecturas.map((l) => l.personId));
  const preferencias = await leerPreferencias(db, [...new Set(personas.flatMap((p) => p.perfiles))]);
  const avisos: AvisoNuevo[] = [];
  let cambios = 0;
  for (const l of lecturas) {
    const persona = porId.get(l.personId);
    if (!persona) continue;
    const c = compararLecturas(anteriores.get(l.personId) ?? new Map(), l.lecturas);
    cambios += c.length;
    avisos.push(...construirAvisosPerfil(l.personId, persona.nombre, c, persona.perfiles, preferencias));
    await guardarLecturas(db, l.personId, l.lecturas, ahora);
  }
  const guardados = await guardarAvisos(db, avisos, preferencias, ahora);
  return { personas: lecturas.length, cambios, guardados };
}

export async function revisarCambiosDePerfil(db: DbAvisos, leer: LectorPerfil, ahora = new Date()): Promise<ResumenPerfil> {
  const personas = await personasVinculadas(db);
  if (personas.length === 0) return { personas: 0, cambios: 0, guardados: [] };
  return registrarLecturasPerfil(db, personas, await leer(personas), ahora);
}
