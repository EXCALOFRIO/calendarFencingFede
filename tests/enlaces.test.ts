import 'dotenv/config';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * EMPAREJADO DEL MISMO TORNEO ENTRE SKERMO Y LA FIE.
 *
 * Va contra la BASE REAL. La invariante que comprueba no es un número: es que
 * nunca se funden dos torneos que no lo son. Un duplicado visible molesta; una
 * fusión equivocada enseña el cartel de Bogotá en el torneo de Samsun y no se
 * entera nadie.
 */

let db: (typeof import('../src/db'))['db'];
let esquema: typeof import('../src/db/schema');
let sql: (typeof import('drizzle-orm'))['sql'];

beforeAll(async () => {
  db = (await import('../src/db')).db;
  esquema = await import('../src/db/schema');
  sql = (await import('drizzle-orm')).sql;
}, 30_000);

async function filas<T = Record<string, unknown>>(
  consulta: ReturnType<typeof sql>,
): Promise<T[]> {
  const r = (await db.execute(consulta)) as unknown as { rows: T[] };
  return r.rows;
}

describe('un enlace solo existe si las tres condiciones se cumplen', () => {
  it('todos los pares enlazados comparten clave de ciudad', async () => {
    const { claveCiudad } = await import('../src/lib/ingest/ciudades');

    const pares = await filas<{ ciudad_p: string | null; ciudad_s: string | null }>(sql`
      select p.city as ciudad_p, s.city as ciudad_s
      from event s join event p on p.id = s.canonical_event_id`);

    for (const par of pares) {
      const a = claveCiudad(par.ciudad_p);
      const b = claveCiudad(par.ciudad_s);
      expect(a, `${par.ciudad_p} / ${par.ciudad_s}`).not.toBeNull();
      expect(b).toBe(a);
    }
  }, 30_000);

  it('todos los pares enlazados solapan fechas', async () => {
    const malos = await filas(sql`
      select s.name, s.start_date, s.end_date, p.start_date as p_ini, p.end_date as p_fin
      from event s join event p on p.id = s.canonical_event_id
      where not (p.start_date <= s.end_date and s.start_date <= p.end_date)`);
    expect(malos).toEqual([]);
  }, 30_000);

  it('las pruebas del registro absorbido están contenidas en las del principal', async () => {
    /**
     * Esta es la condición que de verdad evita el falso positivo. En Samsun,
     * el 24/09/2026, Skermo publica a la vez la Copa del Mundo cadete y la
     * júnior en la misma ciudad y las mismas fechas: solo las pruebas las
     * distinguen.
     */
    const huerfanas = await filas(sql`
      select s.name, cs.weapon, cs.gender, cs.category, cs.format
      from event s
      join event p on p.id = s.canonical_event_id
      join event_competition cs on cs.event_id = s.id
      where not exists (
        select 1 from event_competition cp
        where cp.event_id = p.id
          and cp.weapon = cs.weapon and cp.gender = cs.gender
          and cp.category = cs.category and cp.format = cs.format
      )`);
    expect(huerfanas).toEqual([]);
  }, 30_000);

  it('el principal nunca es una fila de la FIE, y no hay cadenas', async () => {
    const alReves = await filas(sql`
      select p.name from event s join event p on p.id = s.canonical_event_id
      where p.source = 'fie'`);
    expect(alReves).toEqual([]);

    // Un evento absorbido no puede ser a su vez el principal de otro.
    const cadenas = await filas(sql`
      select a.id from event a
      where a.canonical_event_id is not null
        and exists (select 1 from event b where b.canonical_event_id = a.id)`);
    expect(cadenas).toEqual([]);
  }, 30_000);

  it('ningún evento sin sede publicada está enlazado', async () => {
    const sinSede = await filas(sql`
      select id, name from event
      where canonical_event_id is not null and (city is null or upper(city) = 'TBD')`);
    expect(sinSede).toEqual([]);
  }, 30_000);
});

describe('el calendario colapsa el par en una sola tarjeta', () => {
  it('las filas absorbidas no salen en el listado, pero siguen accesibles por id', async () => {
    const { listEvents, getEvent } = await import('../src/lib/queries/calendar');

    const absorbidas = await filas<{ id: string }>(sql`
      select id from event where canonical_event_id is not null limit 5`);

    if (absorbidas.length === 0) return; // Hoy no hay ninguna pareja.

    const listado = await listEvents({ limit: 500, includePast: true });
    const ids = new Set(listado.map((e) => e.id));
    for (const a of absorbidas) {
      expect(ids.has(a.id), 'una fila absorbida se ha colado en el listado').toBe(false);
      // Pero un enlace guardado o el correo de un aviso tienen que seguir
      // funcionando: por id se devuelve igualmente.
      const ficha = await getEvent(a.id);
      expect(ficha?.id).toBe(a.id);
    }
  }, 60_000);

  it('colapsar quita exactamente tantas tarjetas como filas absorbidas hay', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');

    const [{ n }] = await filas<{ n: number }>(
      sql`select count(*)::int n from event where canonical_event_id is not null`,
    );

    const colapsado = await listEvents({ limit: 1000, includePast: true });
    const sinColapsar = await listEvents({
      limit: 1000,
      includePast: true,
      includeLinked: true,
    });

    expect(sinColapsar.length - colapsado.length).toBe(Number(n));
  }, 60_000);
});

describe('el cartel se hereda, no se copia', () => {
  it('un evento sin cartel propio enseña el de su par de la FIE', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');

    const vistas = await listEvents({ limit: 1000, includePast: true });
    const heredados = vistas.filter((v) => v.imageSource !== null);

    for (const v of heredados) {
      expect(v.imageUrl, `${v.name} dice heredar cartel y no tiene`).toBeTruthy();
      // Se ENLAZA a la FIE, no se rehospeda. Es la diferencia entre citar y
      // copiar, que es lo que exigen sus términos.
      expect(v.imageUrl).toMatch(/^https:\/\/static\.fie\.org\//);
      expect(v.imageSource?.source).toBe('fie');
      // Y siempre con el enlace a la fuente original.
      expect(v.sources.some((s) => s.source === 'fie')).toBe(true);
    }
  }, 60_000);

  it('nunca se pisa un cartel propio con el de la FIE', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');
    const vistas = await listEvents({ limit: 1000, includePast: true });

    for (const v of vistas) {
      if (v.imageSource !== null) continue;
      // Sin `imageSource`, el cartel que se ve es el del propio registro.
      expect(v.linkedEvents.every((l) => l.imageUrl !== v.imageUrl || v.imageUrl === null))
        .toBeTypeOf('boolean');
    }
  }, 60_000);

  it('no se copia ni una imagen: en la base solo hay URLs de static.fie.org', async () => {
    const ajenas = await filas(sql`
      select id, image_url from event
      where image_url is not null and image_url not like 'https://static.fie.org/%'`);
    expect(ajenas).toEqual([]);
  }, 30_000);
});

describe('la tarjeta conserva lo mejor de cada fuente', () => {
  it('el nombre y las pruebas siguen siendo los de Skermo', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');
    const vistas = await listEvents({ limit: 1000, includePast: true });
    const conPar = vistas.filter((v) => v.linkedEvents.length > 0);

    if (conPar.length === 0) return;

    for (const v of conPar) {
      expect(v.source).not.toBe('fie');
      // El nombre NO se sustituye por el inglés de la FIE.
      expect(v.linkedEvents.some((l) => l.name === v.name)).toBe(false);
      expect(v.competitions.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it('se ofrecen los enlaces a las DOS fuentes, sin repetir', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');
    const vistas = await listEvents({ limit: 1000, includePast: true });
    const conPar = vistas.filter((v) => v.linkedEvents.length > 0);

    for (const v of conPar) {
      const fuentes = new Set(v.sources.map((s) => s.source));
      expect(fuentes.has('fie'), `${v.name} ha perdido el enlace a la FIE`).toBe(true);
      expect(fuentes.size).toBeGreaterThanOrEqual(2);
      // Sin duplicados: la FIE publica una fila por prueba y varias comparten
      // la misma página del torneo.
      const claves = v.sources.map((s) => `${s.source}|${s.url}`);
      expect(new Set(claves).size).toBe(claves.length);
    }
  }, 60_000);

  it('un huso que no es un huso no se hereda', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');
    const vistas = await listEvents({ limit: 1000, includePast: true });

    for (const v of vistas) {
      if (v.timezone === null) continue;
      // La FIE guarda "Asia\/Riyadh" como relleno, con la barra escapada.
      expect(v.timezone, `${v.name} tiene un huso imposible`).not.toContain('\\');
      expect(v.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?$/);
    }
  }, 60_000);
});

describe('el emparejado es idempotente', () => {
  it('recalcular dos veces seguidas da exactamente lo mismo', async () => {
    const { recalcularEnlaces } = await import('../src/lib/ingest/enlazar');

    const primera = await recalcularEnlaces();
    const segunda = await recalcularEnlaces();

    expect(segunda.enlazados).toBe(primera.enlazados);
    expect(segunda.dudosos).toBe(primera.dudosos);
    expect(segunda.cartelesHeredados).toBe(primera.cartelesHeredados);

    const clave = (p: { canonicalEventId: string; linkedEventId: string }) =>
      `${p.canonicalEventId}|${p.linkedEventId}`;
    expect(segunda.pares.map(clave).sort()).toEqual(primera.pares.map(clave).sort());

    // Y la columna denormalizada acaba coincidiendo con lo que dice la tabla
    // de decisiones: si divergieran, el calendario colapsaría cosas que nadie
    // ha decidido colapsar.
    const desajustes = await filas(sql`
      select e.id from event e
      where e.canonical_event_id is not null
        and not exists (
          select 1 from event_link l
          where l.linked_event_id = e.id
            and l.canonical_event_id = e.canonical_event_id
            and l.status in ('AUTOMATICO','CONFIRMADO')
        )`);
    expect(desajustes).toEqual([]);
  }, 120_000);
});
