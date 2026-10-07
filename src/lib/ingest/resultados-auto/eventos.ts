/**
 * Interfaz de eventos de resultados para las notificaciones.
 *
 * La ingesta automática añade a `resultado_auto_evento` (drizzle-d1/0017) un evento por hecho
 * nuevo, una sola vez:
 *
 *  - `prueba_publicada`: la prueba tiene clasificación por primera vez (`personId` null).
 *  - `fases_publicadas`: la prueba tiene poules o cuadro por primera vez (`personId` null).
 *  - `resultado_persona`: una persona tiene un puesto nuevo en esa prueba (o un puesto que se
 *    acaba de enlazar con ella). `posicion` es el puesto numérico, o null (DNS, excluido...).
 *
 * Cómo consumirla (sin estado aquí: cada consumidor guarda su cursor, el último `id` leído):
 *
 *   const lote = await leerEventosResultados(db, { desdeId: cursor, limite: 200 });
 *   for (const e of lote.eventos) ...;
 *   cursor = lote.ultimoId;
 *
 * `personId` es la persona canónica en el momento de escribir. Si el lote manual fusiona después
 * esa persona con otra, `personaCanonica` (calculada al leer) da la que prevalece: compara con
 * ella, no con `personId`. Los eventos de más de 120 días se purgan.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '@/db';

export type TipoEventoResultado = 'prueba_publicada' | 'fases_publicadas' | 'resultado_persona';

export type DatosEventoResultado = {
  source: string;
  season: string;
  competitionKey: string;
  nombre: string;
  fecha: string | null;
  arma: string;
  genero: string;
  categoria: string;
  formato: string;
  puestos?: number;
  poules?: number;
  cuadro?: number;
  fuenteAsaltos?: string;
  puestoTexto?: string | null;
  nombrePublicado?: string | null;
};

export type EventoResultado = {
  id: number;
  tipo: TipoEventoResultado;
  competitionId: string;
  personId: string | null;
  /** Persona que prevalece hoy (sigue `merged_into_person_id`); igual a `personId` si no hubo fusión. */
  personaCanonica: string | null;
  posicion: number | null;
  datos: DatosEventoResultado | null;
  creadoEn: number;
};

export type OpcionesLectura = {
  /** Cursor: sólo eventos con id mayor. 0 = desde el principio. */
  desdeId: number;
  limite?: number;
  tipos?: readonly TipoEventoResultado[];
  /** Sólo eventos de estas personas (canónicas). Máximo 90. */
  personas?: readonly string[];
};

const TIPOS: readonly TipoEventoResultado[] = ['prueba_publicada', 'fases_publicadas', 'resultado_persona'];

/** Tabla presente (migración 0017 aplicada). Sin ella no hay eventos y no es un error. */
export async function eventosDisponibles(db: Db): Promise<boolean> {
  const { rows } = await db.execute<{ n: number }>(sql`select count(*) n from sqlite_master where type='table' and name='resultado_auto_evento'`);
  return Number(rows[0]?.n) === 1;
}

export async function leerEventosResultados(db: Db, o: OpcionesLectura): Promise<{ eventos: EventoResultado[]; ultimoId: number }> {
  if (!Number.isSafeInteger(o.desdeId) || o.desdeId < 0) throw new Error('eventos_cursor_invalido');
  const limite = Math.min(Math.max(1, o.limite ?? 200), 1_000);
  const tipos = (o.tipos ?? TIPOS).filter((t) => TIPOS.includes(t));
  const personas = (o.personas ?? []).slice(0, 90);
  if (!(await eventosDisponibles(db))) return { eventos: [], ultimoId: o.desdeId };
  const filtroPersonas = personas.length
    ? sql` and coalesce(p2.merged_into_person_id, p1.merged_into_person_id, e.person_id) in (${sql.join(personas.map((p) => sql`${p}`), sql`, `)})`
    : sql``;
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select e.id, e.tipo, e.competition_id, e.person_id, e.posicion, e.datos, e.creado_en,
           coalesce(p2.merged_into_person_id, p1.merged_into_person_id, e.person_id) canonica
      from resultado_auto_evento e
      left join sport_person p1 on p1.id = e.person_id
      left join sport_person p2 on p2.id = p1.merged_into_person_id
     where e.id > ${o.desdeId} and e.tipo in (${sql.join(tipos.map((t) => sql`${t}`), sql`, `)})${filtroPersonas}
     order by e.id limit ${limite}`);
  const eventos = rows.map((r): EventoResultado => {
    let datos: DatosEventoResultado | null = null;
    try { datos = r.datos ? JSON.parse(String(r.datos)) : null; } catch { datos = null; }
    return {
      id: Number(r.id), tipo: r.tipo as TipoEventoResultado, competitionId: String(r.competition_id),
      personId: (r.person_id as string | null) ?? null, personaCanonica: (r.canonica as string | null) ?? null,
      posicion: r.posicion === null || r.posicion === undefined ? null : Number(r.posicion), datos, creadoEn: Number(r.creado_en),
    };
  });
  return { eventos, ultimoId: eventos.at(-1)?.id ?? o.desdeId };
}
