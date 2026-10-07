import { sql } from 'drizzle-orm';
import { exigirPerfil, filas, type ContextoExplorador } from './contexto';
import { UUID_RE } from './cursor';
import { listaUuid } from './filtros-sql';
import { MAX_MIEMBROS_FOTO, vetoMenores, type PersonaFoto } from './foto';
import type { FotoPublicada, ResultadoFoto } from './foto-contrato';
import { fotoFieConCache, type AlmacenMarcas } from './fotos/cache';
import { SALTOS } from './personas';

/**
 * LAS FOTOS DE UNA LISTA EN UNA SOLA PETICIÓN.
 *
 * `leerFotoDeportista` hace unas seis consultas por persona (subir hasta la
 * canónica, bajar a sus fundidas, identificadores y conflicto). Una lista de
 * 24 filas eran ~150 consultas y 24 peticiones. Aquí cada paso se hace para
 * todas a la vez: en el caso habitual (personas canónicas sin fundidas) son
 * cuatro consultas para toda la lista.
 *
 * La semántica es la de `leerFotoDeportista`, comprobada caso a caso en
 * `tests/explorar-foto-lote.test.ts`: mismo grupo acotado (sin truncar, sin
 * ciclos, sin fronteras incompletas), mismo veto de menores (`vetoMenores`) y
 * el mismo identificador FIE único y sin conflicto. Nunca devuelve años,
 * nombres ni identificadores: sólo el contrato de `ResultadoFoto`.
 *
 * Lo que no se puede demostrar en lote no se decide aquí: sale `pendiente` y
 * el cliente lo pide por la ruta individual. Así se acota también lo que va a
 * la FIE en una petición (`MAX_RED_POR_LOTE` resoluciones nuevas).
 */
export const MAX_FOTOS_POR_LOTE = 24;
export const MAX_RED_POR_LOTE = 4;
/** Techo de filas por consulta: un lote no puede leer más que esto aunque los grupos sean enormes. */
const MAX_FILAS = MAX_FOTOS_POR_LOTE * (MAX_MIEMBROS_FOTO + 1);

export type ResultadoFotoLote = ResultadoFoto | { estado: 'pendiente' };
export type LecturaFotosLote =
  | { estado: 'ok'; fotos: Record<string, ResultadoFotoLote> }
  | { estado: 'entrada_invalida' | 'no_disponible' };

/**
 * Para la prop `foto` de `FotoDeportista` cuando una página resuelve sus filas
 * en el servidor: sólo lo definitivo. Lo que falte (pendiente, pasajero) lo
 * pide el componente como siempre.
 */
export function fotosResueltas(lectura: LecturaFotosLote): Record<string, FotoPublicada | null> {
  if (lectura.estado !== 'ok') return {};
  const resueltas: Record<string, FotoPublicada | null> = {};
  for (const [id, r] of Object.entries(lectura.fotos)) {
    if (r.estado === 'publicada') resueltas[id] = r.foto;
    else if (r.estado === 'foto_no_publicada') resueltas[id] = null;
  }
  return resueltas;
}

const SIN_FOTO = { estado: 'foto_no_publicada' } as const;
const PENDIENTE = { estado: 'pendiente' } as const;
const FIE_ID_RE = /^[1-9]\d{0,9}$/;

type Grupo = { canonica: string; miembros: Map<string, PersonaFoto>; valido: boolean };

async function personasPorId(ctx: ContextoExplorador, ids: readonly string[]): Promise<PersonaFoto[]> {
  return filas<PersonaFoto>(await ctx.db.execute(sql`
    SELECT id AS id, merged_into_person_id AS destino, birth_year AS anio
    FROM sport_person WHERE id IN (${listaUuid(ids)})
    LIMIT ${MAX_FILAS + 1}`));
}

/** Canónica de cada id pedido, saltando como `grupoAcotado`; `null` si no se demuestra. */
async function canonicas(ctx: ContextoExplorador, ids: readonly string[]): Promise<Map<string, PersonaFoto | null>> {
  const resultado = new Map<string, PersonaFoto | null>();
  const visitadas = new Map(ids.map((id) => [id, new Set<string>()]));
  let actuales = new Map(ids.map((id) => [id, id]));
  for (let salto = 0; salto <= SALTOS && actuales.size > 0; salto++) {
    for (const [origen, actual] of actuales) {
      const vistas = visitadas.get(origen)!;
      if (vistas.has(actual) || !UUID_RE.test(actual)) { resultado.set(origen, null); actuales.delete(origen); continue; }
      vistas.add(actual);
    }
    if (actuales.size === 0) break;
    const leidas = await personasPorId(ctx, [...new Set(actuales.values())]);
    if (leidas.length > MAX_FILAS) throw new LoteDesbordado();
    const porId = new Map(leidas.map((p) => [p.id, p]));
    const siguientes = new Map<string, string>();
    for (const [origen, actual] of actuales) {
      const persona = porId.get(actual);
      if (!persona) { resultado.set(origen, null); continue; }
      if (persona.destino === null) { resultado.set(origen, persona); continue; }
      siguientes.set(origen, persona.destino);
    }
    actuales = siguientes;
  }
  for (const origen of actuales.keys()) resultado.set(origen, null);
  return resultado;
}

/** Baja desde cada canónica a la vez, con las mismas comprobaciones que `grupoAcotado`. */
async function grupos(ctx: ContextoExplorador, raices: readonly PersonaFoto[]): Promise<Map<string, Grupo>> {
  const porCanonica = new Map<string, Grupo>();
  for (const r of raices) {
    if (!porCanonica.has(r.id)) porCanonica.set(r.id, { canonica: r.id, miembros: new Map([[r.id, r]]), valido: true });
  }
  let fronteras = new Map([...porCanonica.keys()].map((id) => [id, [id]]));
  for (let salto = 0; salto <= SALTOS && fronteras.size > 0; salto++) {
    const padreDe = new Map<string, string>();
    for (const [canonica, frontera] of fronteras) for (const id of frontera) padreDe.set(id, canonica);
    const descendientes = filas<PersonaFoto>(await ctx.db.execute(sql`
      SELECT id AS id, merged_into_person_id AS destino, birth_year AS anio
      FROM sport_person WHERE merged_into_person_id IN (${listaUuid([...padreDe.keys()])})
      ORDER BY id LIMIT ${MAX_FILAS + 1}`));
    if (descendientes.length > MAX_FILAS) throw new LoteDesbordado();
    const porGrupo = new Map<string, PersonaFoto[]>();
    for (const p of descendientes) {
      const canonica = p.destino === null ? undefined : padreDe.get(p.destino);
      // Sólo puede venir de una frontera pedida; si no, la consulta no es la que se cree.
      if (!canonica) throw new LoteDesbordado();
      porGrupo.set(canonica, [...(porGrupo.get(canonica) ?? []), p]);
    }
    const siguientes = new Map<string, string[]>();
    for (const [canonica, frontera] of fronteras) {
      const grupo = porCanonica.get(canonica)!;
      const hijos = porGrupo.get(canonica) ?? [];
      if (hijos.length === 0) continue;
      if (salto === SALTOS || grupo.miembros.size + hijos.length > MAX_MIEMBROS_FOTO) { grupo.valido = false; continue; }
      const siguiente: string[] = [];
      for (const p of hijos) {
        if (!UUID_RE.test(p.id) || grupo.miembros.has(p.id) || !p.destino || !frontera.includes(p.destino)) {
          grupo.valido = false;
          break;
        }
        grupo.miembros.set(p.id, p);
        siguiente.push(p.id);
      }
      if (grupo.valido) siguientes.set(canonica, siguiente);
    }
    fronteras = siguientes;
  }
  return porCanonica;
}

class LoteDesbordado extends Error {
  constructor() { super('lote_desbordado'); this.name = 'LoteDesbordado'; }
}

/**
 * Fotos de varias personas a la vez. Los ids repetidos o inválidos se tratan
 * como en la ruta individual; más de `MAX_FOTOS_POR_LOTE` es entrada inválida.
 */
export async function leerFotosDeportistas(
  ctx: ContextoExplorador,
  personaIds: unknown,
  opciones: { fetch?: typeof fetch; signal?: AbortSignal; almacen?: AlmacenMarcas | null } = {},
): Promise<LecturaFotosLote> {
  await exigirPerfil(ctx);
  if (!Array.isArray(personaIds) || personaIds.length === 0 || personaIds.length > MAX_FOTOS_POR_LOTE ||
    !personaIds.every((id): id is string => typeof id === 'string' && UUID_RE.test(id))) {
    return { estado: 'entrada_invalida' };
  }
  if (!(await ctx.esquema()).identidad) return { estado: 'no_disponible' };
  const ids = [...new Set(personaIds)];
  const fotos: Record<string, ResultadoFotoLote> = {};

  let porOrigen: Map<string, PersonaFoto | null>;
  let porCanonica: Map<string, Grupo>;
  try {
    porOrigen = await canonicas(ctx, ids);
    const raices = [...porOrigen.values()].filter((p): p is PersonaFoto => p !== null);
    porCanonica = await grupos(ctx, raices);
  } catch (error) {
    if (error instanceof LoteDesbordado) return { estado: 'ok', fotos: Object.fromEntries(ids.map((id) => [id, PENDIENTE])) };
    throw error;
  }

  const hoy = ctx.hoy();
  const aptos = [...porCanonica.values()].filter((g) => g.valido && !vetoMenores([...g.miembros.values()], hoy));
  const miembroDe = new Map<string, string>();
  for (const g of aptos) for (const id of g.miembros.keys()) miembroDe.set(id, g.canonica);

  const valoresPorGrupo = new Map<string, Set<string>>();
  if (miembroDe.size > 0) {
    const externos = filas<{ persona: string; valor: string }>(await ctx.db.execute(sql`
      SELECT DISTINCT person_id AS persona, value AS valor FROM sport_external_id
      WHERE person_id IN (${listaUuid([...miembroDe.keys()])})
        AND scheme = 'fie_addr_id' AND scope_source = 'fie'
        AND link_status = 'CONFIRMADO'
      ORDER BY person_id, value LIMIT ${MAX_FILAS + 1}`));
    if (externos.length > MAX_FILAS) return { estado: 'ok', fotos: Object.fromEntries(ids.map((id) => [id, PENDIENTE])) };
    for (const e of externos) {
      const canonica = miembroDe.get(e.persona);
      if (!canonica) continue;
      valoresPorGrupo.set(canonica, (valoresPorGrupo.get(canonica) ?? new Set()).add(e.valor));
    }
  }

  // Un solo valor válido por grupo; conflictos entre temporadas o ámbitos tampoco eligen.
  const candidato = new Map<string, string>();
  for (const [canonica, valores] of valoresPorGrupo) {
    const [valor] = valores;
    if (valores.size === 1 && FIE_ID_RE.test(valor)) candidato.set(canonica, valor);
  }

  const enConflicto = new Set<string>();
  if (candidato.size > 0) {
    const duenos = filas<{ persona: string; valor: string }>(await ctx.db.execute(sql`
      SELECT DISTINCT person_id AS persona, value AS valor FROM sport_external_id
      WHERE scheme = 'fie_addr_id' AND scope_source = 'fie' AND link_status = 'CONFIRMADO'
        AND value IN (SELECT value FROM json_each(${JSON.stringify([...new Set(candidato.values())])}))
      ORDER BY value, person_id LIMIT ${MAX_FILAS + 1}`));
    if (duenos.length > MAX_FILAS) return { estado: 'ok', fotos: Object.fromEntries(ids.map((id) => [id, PENDIENTE])) };
    for (const [canonica, valor] of candidato) {
      const miembros = porCanonica.get(canonica)!.miembros;
      if (duenos.some((d) => d.valor === valor && !miembros.has(d.persona))) enConflicto.add(canonica);
    }
  }

  let red = 0;
  const permitirRed = () => (red < MAX_RED_POR_LOTE ? (red++, true) : false);
  const porGrupo = new Map<string, Promise<ResultadoFotoLote>>();
  const resolverGrupo = (canonica: string): Promise<ResultadoFotoLote> => {
    const valor = candidato.get(canonica);
    if (!valor || enConflicto.has(canonica)) return Promise.resolve(SIN_FOTO);
    return fotoFieConCache(Number(valor), hoy, { ...opciones, permitirRed }).then((r): ResultadoFotoLote => {
      if (r.aplazado) return PENDIENTE;
      if (r.foto) return { estado: 'publicada', foto: r.foto };
      return r.definitivo ? SIN_FOTO : { estado: 'no_disponible' };
    });
  };

  await Promise.all(ids.map(async (id) => {
    const raiz = porOrigen.get(id);
    const grupo = raiz ? porCanonica.get(raiz.id) : undefined;
    if (!grupo || !grupo.valido || !miembroDe.has(grupo.canonica)) { fotos[id] = SIN_FOTO; return; }
    let promesa = porGrupo.get(grupo.canonica);
    if (!promesa) { promesa = resolverGrupo(grupo.canonica); porGrupo.set(grupo.canonica, promesa); }
    fotos[id] = await promesa;
  }));
  return { estado: 'ok', fotos };
}
