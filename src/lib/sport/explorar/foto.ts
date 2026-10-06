import { sql } from 'drizzle-orm';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { listaUuid } from './filtros-sql';
import { SALTOS } from './personas';
import { fotoFieConCache, type AlmacenMarcas } from './fotos/cache';
import type { ResultadoFoto } from './foto-contrato';

export const MAX_MIEMBROS_FOTO = 64;
const SIN_FOTO = { estado: 'foto_no_publicada' } as const;
type PersonaFoto = { id: string; destino: string | null; anio: number | null };

/**
 * Misma semántica reversible y profundidad que resolverPersona, con un límite
 * adicional de anchura. No se trunca silenciosamente: una frontera incompleta,
 * ciclo o grupo demasiado grande no puede demostrar identidad para una foto.
 */
async function grupoAcotado(
  ctx: ContextoExplorador,
  personaId: string,
): Promise<PersonaFoto[] | null> {
  const visitadas = new Set<string>();
  let actual = personaId;
  let canonica: PersonaFoto | undefined;
  for (let salto = 0; salto <= SALTOS; salto++) {
    if (visitadas.has(actual) || !UUID_RE.test(actual)) return null;
    visitadas.add(actual);
    const [persona] = filas<PersonaFoto>(await ctx.db.execute(sql`
      SELECT id AS id, merged_into_person_id AS destino, birth_year AS anio
      FROM sport_person WHERE id = ${actual} LIMIT 1`));
    if (!persona || persona.id !== actual) return null;
    if (persona.destino === null) { canonica = persona; break; }
    actual = persona.destino;
  }
  if (!canonica) return null;
  const miembros = new Map<string, PersonaFoto>([[canonica.id, canonica]]);
  let frontera = [canonica.id];
  for (let salto = 0; salto <= SALTOS; salto++) {
    const descendientes = filas<PersonaFoto>(await ctx.db.execute(sql`
      SELECT id AS id, merged_into_person_id AS destino, birth_year AS anio
      FROM sport_person WHERE merged_into_person_id IN (${listaUuid(frontera)})
      ORDER BY id LIMIT ${MAX_MIEMBROS_FOTO + 1}`));
    if (descendientes.length === 0) return [...miembros.values()];
    if (salto === SALTOS || miembros.size + descendientes.length > MAX_MIEMBROS_FOTO) return null;
    const siguiente: string[] = [];
    for (const persona of descendientes) {
      if (!UUID_RE.test(persona.id) || miembros.has(persona.id) ||
        !persona.destino || !frontera.includes(persona.destino)) return null;
      miembros.set(persona.id, persona);
      siguiente.push(persona.id);
    }
    frontera = siguiente;
  }
  return null;
}

/**
 * Lectura autenticada sin nombres/alias/licencias ni escrituras en D1. La
 * identidad y el veto de menores se comprueban en cada petición; sólo la
 * respuesta de la FIE por ID se recuerda (ver `fotos/cache.ts`).
 */
export async function leerFotoDeportista(
  ctx: ContextoExplorador,
  personaId: unknown,
  opciones: { fetch?: typeof fetch; signal?: AbortSignal; almacen?: AlmacenMarcas | null } = {},
): Promise<ResultadoFoto> {
  await exigirPerfil(ctx);
  if (typeof personaId !== 'string' || !UUID_RE.test(personaId)) return { estado: 'entrada_invalida' };
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const grupo = await grupoAcotado(ctx, personaId);
  if (!grupo) return SIN_FOTO;
  // Veto conservador incluso para su propia ficha: nunca se revela un menor
  // por invocar directamente la API aunque el encabezado oculte el retrato.
  const anioActual = Number(ctx.hoy().slice(0, 4));
  if (!Number.isInteger(anioActual) || grupo.some((p) =>
    p.anio !== null && (!Number.isInteger(Number(p.anio)) || anioActual - Number(p.anio) <= 18))) return SIN_FOTO;

  const ids = filas<{ valor: string }>(await ctx.db.execute(sql`
    SELECT DISTINCT value AS valor FROM sport_external_id
    WHERE person_id IN (${listaUuid(grupo.map((p) => p.id))})
      AND scheme = 'fie_addr_id' AND scope_source = 'fie'
      AND link_status = 'CONFIRMADO'
    ORDER BY value LIMIT 2`));
  // Conflictos entre temporadas/ámbitos tampoco eligen la primera fila.
  if (ids.length !== 1 || !/^[1-9]\d{0,9}$/.test(ids[0].valor)) return SIN_FOTO;
  const conflicto = filas<{ conflicto: number }>(await ctx.db.execute(sql`
    SELECT 1 AS conflicto FROM sport_external_id
    WHERE scheme = 'fie_addr_id' AND scope_source = 'fie'
      AND value = ${ids[0].valor} AND link_status = 'CONFIRMADO'
      AND person_id NOT IN (${listaUuid(grupo.map((p) => p.id))})
    LIMIT 1`));
  if (conflicto.length > 0) return SIN_FOTO;
  const { foto, definitivo } = await fotoFieConCache(Number(ids[0].valor), ctx.hoy(), opciones);
  if (foto) return { estado: 'publicada', foto };
  // Un fallo pasajero no se presenta como «no publicada»: esa sí se cachea.
  return definitivo ? SIN_FOTO : { estado: 'no_disponible' };
}
