import { sql } from 'drizzle-orm';
import { firmaAviso, lineasDe, type AvisoNuevo, type DatosAviso } from './agrupar';
import { filasDe, jsonLista, type DbAvisos } from './db';
import {
  CLAVES_PREFERENCIA, PREFERENCIAS_POR_DEFECTO, esClavePreferencia, esRutaInterna,
  type ClavePreferencia, type Preferencias, type TipoNotificacion,
} from './tipos';

// ---------------------------------------------------------------- preferencias

export async function leerPreferencias(db: DbAvisos, profileIds: readonly string[]): Promise<Map<string, Preferencias>> {
  const salida = new Map<string, Preferencias>();
  if (profileIds.length === 0) return salida;
  for (const id of profileIds) salida.set(id, { ...PREFERENCIAS_POR_DEFECTO });
  const filas = await filasDe<{ profile_id: string; clave: string; activa: number }>(db, sql`
    SELECT profile_id, clave, activa FROM notificacion_preferencia
    WHERE profile_id IN (SELECT value FROM json_each(${jsonLista(profileIds)}))`);
  for (const f of filas) {
    if (!esClavePreferencia(f.clave)) continue;
    salida.get(f.profile_id)![f.clave] = Number(f.activa) === 1;
  }
  return salida;
}

export async function leerPreferenciasDe(db: DbAvisos, profileId: string): Promise<Preferencias> {
  return (await leerPreferencias(db, [profileId])).get(profileId) ?? { ...PREFERENCIAS_POR_DEFECTO };
}

export async function guardarPreferencia(
  db: DbAvisos, profileId: string, clave: ClavePreferencia, activa: boolean, ahora = new Date(),
): Promise<void> {
  if (!(CLAVES_PREFERENCIA as readonly string[]).includes(clave)) throw new Error('preferencia desconocida');
  await db.execute(sql`
    INSERT INTO notificacion_preferencia (profile_id, clave, activa, actualizada_en)
    VALUES (${profileId}, ${clave}, ${activa ? 1 : 0}, ${ahora.getTime()})
    ON CONFLICT (profile_id, clave) DO UPDATE SET activa = excluded.activa, actualizada_en = excluded.actualizada_en`);
}

// ---------------------------------------------------------------- escritura

export type AvisoGuardado = {
  id: string;
  aviso: AvisoNuevo;
  estado: 'nuevo' | 'actualizado';
  /** Merece llegar al móvil: es nuevo, o ha ganado personas. Y el canal push está encendido. */
  push: boolean;
};

/**
 * Guarda los avisos respetando las preferencias de cada perfil:
 *
 *   - tipo apagado: no se guarda nada (doble cierre: los generadores ya lo filtran);
 *   - campana y push apagados: tampoco;
 *   - campana apagada y push encendido: se guarda fuera de la bandeja, solo
 *     para deduplicar y empujar.
 *
 * La misma `clave` en el mismo perfil es una sola fila. Si el contenido no ha
 * cambiado no se toca; si ha cambiado (más resultados de la misma prueba) se
 * actualiza y vuelve a contar como no leído.
 */
export async function guardarAvisos(
  db: DbAvisos,
  avisos: readonly AvisoNuevo[],
  preferencias: ReadonlyMap<string, Preferencias>,
  ahora = new Date(),
): Promise<AvisoGuardado[]> {
  const unicos = new Map<string, AvisoNuevo>();
  for (const a of avisos) {
    if (!esRutaInterna(a.url)) throw new Error('un aviso solo puede llevar a una ruta interna');
    const prefs = preferencias.get(a.profileId) ?? PREFERENCIAS_POR_DEFECTO;
    if (a.tipo !== 'prueba' && !prefs[`tipo:${a.tipo}`]) continue;
    if (!prefs['canal:campana'] && !prefs['canal:push']) continue;
    unicos.set(`${a.profileId}\u0000${a.clave}`, a);
  }
  if (unicos.size === 0) return [];

  const pares = JSON.stringify([...unicos.values()].map((a) => [a.profileId, a.clave]));
  const previas = await filasDe<{ id: string; profile_id: string; clave: string; titulo: string; cuerpo: string; url: string; datos: string | null }>(db, sql`
    SELECT n.id, n.profile_id, n.clave, n.titulo, n.cuerpo, n.url, n.datos
    FROM json_each(${pares}) j
    JOIN notificacion n ON n.profile_id = json_extract(j.value, '$[0]') AND n.clave = json_extract(j.value, '$[1]')`);
  const porClave = new Map(previas.map((p) => [`${p.profile_id}\u0000${p.clave}`, p]));

  const guardados: AvisoGuardado[] = [];
  const t = ahora.getTime();
  for (const [k, a] of unicos) {
    const prefs = preferencias.get(a.profileId) ?? PREFERENCIAS_POR_DEFECTO;
    const enBandeja = prefs['canal:campana'] ? 1 : 0;
    const datos = a.datos ? JSON.stringify(a.datos) : null;
    const previa = porClave.get(k);
    if (!previa) {
      const id = crypto.randomUUID();
      const insertada = await filasDe<{ id: string }>(db, sql`
        INSERT INTO notificacion (id, profile_id, tipo, clave, grupo, titulo, cuerpo, url, datos, en_bandeja, creada_en, actualizada_en)
        VALUES (${id}, ${a.profileId}, ${a.tipo}, ${a.clave}, ${a.grupo}, ${a.titulo}, ${a.cuerpo}, ${a.url}, ${datos}, ${enBandeja}, ${t}, ${t})
        ON CONFLICT (profile_id, clave) DO NOTHING
        RETURNING id`);
      // Otra pasada la insertó a la vez: ya existe, no es nueva.
      if (insertada.length === 0) continue;
      guardados.push({ id, aviso: a, estado: 'nuevo', push: prefs['canal:push'] });
      continue;
    }
    const anteriorDatos = previa.datos ? (JSON.parse(previa.datos) as DatosAviso) : null;
    if (firmaAviso({ titulo: previa.titulo, cuerpo: previa.cuerpo, url: previa.url, datos: anteriorDatos }) === firmaAviso(a)) continue;
    await db.execute(sql`
      UPDATE notificacion SET tipo = ${a.tipo}, titulo = ${a.titulo}, cuerpo = ${a.cuerpo}, url = ${a.url}, datos = ${datos},
        en_bandeja = ${enBandeja}, leida_en = NULL, actualizada_en = ${t}
      WHERE id = ${previa.id}`);
    guardados.push({
      id: previa.id, aviso: a, estado: 'actualizado',
      push: prefs['canal:push'] && lineasDe(a) > lineasDe({ datos: anteriorDatos }),
    });
  }
  return guardados;
}

// ---------------------------------------------------------------- lectura

export type FilaBandeja = {
  id: string;
  tipo: TipoNotificacion;
  grupo: string;
  titulo: string;
  cuerpo: string;
  url: string;
  datos: DatosAviso | null;
  leida: boolean;
  creadaEn: number;
  actualizadaEn: number;
};

export const MAX_BANDEJA = 150;

export async function leerBandeja(db: DbAvisos, profileId: string, limite = MAX_BANDEJA): Promise<FilaBandeja[]> {
  const filas = await filasDe<{
    id: string; tipo: TipoNotificacion; grupo: string; titulo: string; cuerpo: string; url: string;
    datos: string | null; leida_en: number | null; creada_en: number; actualizada_en: number;
  }>(db, sql`
    SELECT id, tipo, grupo, titulo, cuerpo, url, datos, leida_en, creada_en, actualizada_en
    FROM notificacion WHERE profile_id = ${profileId} AND en_bandeja = 1
    ORDER BY actualizada_en DESC, id LIMIT ${Math.max(1, Math.min(limite, 500))}`);
  return filas.map((f) => ({
    id: f.id, tipo: f.tipo, grupo: f.grupo, titulo: f.titulo, cuerpo: f.cuerpo,
    url: esRutaInterna(f.url) ? f.url : '/notificaciones',
    datos: leerDatos(f.datos),
    leida: f.leida_en !== null, creadaEn: Number(f.creada_en), actualizadaEn: Number(f.actualizada_en),
  }));
}

function leerDatos(texto: string | null): DatosAviso | null {
  if (!texto) return null;
  try {
    const d = JSON.parse(texto) as DatosAviso;
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

export async function contarNoLeidas(db: DbAvisos, profileId: string): Promise<number> {
  const [fila] = await filasDe<{ n: number }>(db, sql`
    SELECT count(*) AS n FROM notificacion
    WHERE profile_id = ${profileId} AND leida_en IS NULL AND en_bandeja = 1`);
  return Number(fila?.n ?? 0);
}

/** Destino de un aviso del perfil, marcándolo leído junto con los de su grupo. */
export async function abrirAviso(db: DbAvisos, profileId: string, id: string, ahora = new Date()): Promise<string | null> {
  const [fila] = await filasDe<{ url: string; grupo: string }>(db, sql`
    SELECT url, grupo FROM notificacion WHERE id = ${id} AND profile_id = ${profileId}`);
  if (!fila) return null;
  await db.execute(sql`
    UPDATE notificacion SET leida_en = ${ahora.getTime()}
    WHERE profile_id = ${profileId} AND grupo = ${fila.grupo} AND leida_en IS NULL`);
  return esRutaInterna(fila.url) ? fila.url : '/notificaciones';
}

export async function marcarTodasLeidas(db: DbAvisos, profileId: string, ahora = new Date()): Promise<void> {
  await db.execute(sql`
    UPDATE notificacion SET leida_en = ${ahora.getTime()}
    WHERE profile_id = ${profileId} AND leida_en IS NULL`);
}

export async function marcarPushEnviada(db: DbAvisos, ids: readonly string[], ahora = new Date()): Promise<void> {
  if (ids.length === 0) return;
  await db.execute(sql`
    UPDATE notificacion SET push_enviada_en = ${ahora.getTime()}
    WHERE id IN (SELECT value FROM json_each(${jsonLista(ids)}))`);
}

/** Lo leído de hace más de 90 días y lo no leído de hace más de 180 sobra. */
export async function podarBandeja(db: DbAvisos, ahora = new Date()): Promise<void> {
  const dia = 86_400_000;
  await db.execute(sql`
    DELETE FROM notificacion
    WHERE (leida_en IS NOT NULL AND actualizada_en < ${ahora.getTime() - 90 * dia})
       OR actualizada_en < ${ahora.getTime() - 180 * dia}`);
}

// ---------------------------------------------------------------- agrupación de la bandeja

export type GrupoBandeja = {
  grupo: string;
  /** El aviso más reciente del grupo, que es el que se enseña. */
  principal: FilaBandeja;
  /** Los anteriores del mismo grupo, sin repetir titular y cuerpo. */
  anteriores: FilaBandeja[];
  noLeidas: number;
};

export type SeccionBandeja = { titulo: string; grupos: GrupoBandeja[] };

const DIA = 86_400_000;

/**
 * Como la actividad de Instagram: Hoy, Esta semana, Este mes, Antes. Cada
 * competición aparece UNA vez, en la sección de su aviso más reciente, y un
 * aviso con el mismo texto que otro del grupo no se repite.
 */
export function agruparBandeja(filas: readonly FilaBandeja[], ahora: Date, inicioDeHoy?: number): SeccionBandeja[] {
  const grupos = new Map<string, GrupoBandeja>();
  const vistos = new Map<string, Set<string>>();
  const ordenadas = [...filas].sort((a, b) => b.actualizadaEn - a.actualizadaEn || a.id.localeCompare(b.id));
  for (const f of ordenadas) {
    const firma = `${f.titulo}\u0000${f.cuerpo}`;
    const g = grupos.get(f.grupo);
    if (!g) {
      grupos.set(f.grupo, { grupo: f.grupo, principal: f, anteriores: [], noLeidas: f.leida ? 0 : 1 });
      vistos.set(f.grupo, new Set([firma]));
      continue;
    }
    const firmas = vistos.get(f.grupo)!;
    if (firmas.has(firma)) continue;
    firmas.add(firma);
    g.anteriores.push(f);
    if (!f.leida) g.noLeidas += 1;
  }
  const hoy = inicioDeHoy ?? new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const tramos: { titulo: string; desde: number }[] = [
    { titulo: 'Hoy', desde: hoy },
    { titulo: 'Esta semana', desde: hoy - 6 * DIA },
    { titulo: 'Este mes', desde: hoy - 29 * DIA },
    { titulo: 'Antes', desde: Number.NEGATIVE_INFINITY },
  ];
  const secciones: SeccionBandeja[] = tramos.map((t) => ({ titulo: t.titulo, grupos: [] }));
  for (const g of grupos.values()) {
    const i = tramos.findIndex((t) => g.principal.actualizadaEn >= t.desde);
    secciones[i].grupos.push(g);
  }
  return secciones.filter((s) => s.grupos.length > 0);
}
