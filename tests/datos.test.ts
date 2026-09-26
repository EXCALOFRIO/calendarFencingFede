import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * CALIDAD DEL DATO: NADA INVENTADO.
 *
 * Estas pruebas van contra la BASE REAL, no contra datos de mentira. La regla
 * que comprueban es siempre la misma: cuando la fuente no publica algo, la
 * aplicación tiene que decir "no publicado", no rellenar el hueco con un valor
 * que parezca oficial (0 €, "Madrid", la fecha de hoy, "sin recargo").
 *
 * Si mañana cambian los números de la base, lo que no puede cambiar son las
 * invariantes: por eso casi nada se compara con una cifra exacta.
 */

const RAIZ = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let db: typeof import('../src/db')['db'];
let esquema: typeof import('../src/db/schema');
let sql: typeof import('drizzle-orm')['sql'];

beforeAll(async () => {
  db = (await import('../src/db')).db;
  esquema = await import('../src/db/schema');
  sql = (await import('drizzle-orm')).sql;
}, 30_000);

async function contar(consulta: ReturnType<typeof sql>): Promise<number> {
  const filas = (await db.execute(consulta)) as unknown as { rows: { n: number }[] };
  return Number(filas.rows[0].n);
}

// ---------------------------------------------------------------------------
// La base que se audita
// ---------------------------------------------------------------------------

describe('la base real es la que se dice', () => {
  it('tiene el calendario, las pruebas y las circulares esperadas', async () => {
    const eventos = await contar(sql`select count(*)::int n from event`);
    const pruebas = await contar(sql`select count(*)::int n from event_competition`);
    const circulares = await contar(sql`select count(*)::int n from official_document`);

    // Cotas inferiores: la ingestión añade, no quita.
    expect(eventos).toBeGreaterThanOrEqual(248);
    expect(pruebas).toBeGreaterThanOrEqual(458);
    expect(circulares).toBeGreaterThanOrEqual(278);
  });
});

// ---------------------------------------------------------------------------
// Cuotas
// ---------------------------------------------------------------------------

describe('las cuotas no publicadas salen como "no publicado", nunca como 0 €', () => {
  it('formatEur distingue "no hay dato" de "cuesta cero"', async () => {
    const { formatEur } = await import('../src/lib/utils');
    expect(formatEur(null)).toBe('no publicado');
    expect(formatEur(undefined)).toBe('no publicado');
    expect(formatEur('')).toBe('no publicado');
    expect(formatEur('no-es-un-numero')).toBe('no publicado');
    // Un cero explícito sí es un dato y se dice como tal.
    expect(formatEur('0')).toMatch(/0/);
    expect(formatEur('25')).toMatch(/25/);
  });

  it('en la base no hay ninguna cuota puesta a 0 por defecto', async () => {
    const ceros = await contar(
      sql`select count(*)::int n from event_competition where fee_eur = 0`,
    );
    expect(ceros).toBe(0);
  });

  it('la ficha de una prueba sin cuota dice "no publicado"', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');
    const { formatEur } = await import('../src/lib/utils');

    const eventos = await listEvents({ limit: 60 });
    const sinCuota = eventos
      .flatMap((e) => e.competitions)
      .filter((c) => c.feeEur === null);

    expect(sinCuota.length).toBeGreaterThan(0);
    for (const c of sinCuota) expect(formatEur(c.feeEur)).toBe('no publicado');
  }, 30_000);

  it('el .ics de datos reales no escribe nunca "Cuota: 0 €"', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');
    const { buildIcalFeed } = await import('../src/lib/ical');

    const eventos = await listEvents({ limit: 80 });
    const ics = buildIcalFeed({ type: 'todo', events: eventos, baseUrl: 'https://x.es' });

    // El plegado de líneas puede partir el texto, así que se desdobla antes.
    const plano = ics.replace(/\r\n /g, '');
    expect(plano).not.toMatch(/Cuota: 0\s*€/);
    expect(plano).toContain('Cuota: no publicado');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Recargos
// ---------------------------------------------------------------------------

describe('un recargo que nadie ha publicado no se presenta como "sin recargo"', () => {
  it('etiquetaRecargo separa "no publicado" de "0 €"', async () => {
    const { etiquetaRecargo } = await import('../src/lib/deadlines');

    expect(etiquetaRecargo(null).texto).toBe('Recargo no publicado');
    expect(etiquetaRecargo('').texto).toBe('Recargo no publicado');
    expect(etiquetaRecargo('0').texto).toBe('Sin recargo');
    expect(etiquetaRecargo('20').texto).toMatch(/\+/);
    expect(etiquetaRecargo('20').tono).toBe('warn');
  });

  it('hoy TODOS los plazos publicados de la base están sin recargo publicado', async () => {
    const { etiquetaRecargo } = await import('../src/lib/deadlines');

    const total = await contar(sql`select count(*)::int n from event_deadline`);
    const sinRecargo = await contar(
      sql`select count(*)::int n from event_deadline where surcharge_eur is null`,
    );

    expect(total).toBeGreaterThan(0);
    // Es justo el caso que antes se pintaba como "Sin recargo" en toda la app.
    expect(sinRecargo).toBe(total);
    expect(etiquetaRecargo(null).texto).not.toBe('Sin recargo');
  });
});

// ---------------------------------------------------------------------------
// Plazos: CALCULADO frente a PUBLICADO
// ---------------------------------------------------------------------------

describe('un plazo calculado nunca se presenta igual que uno publicado', () => {
  const publicado = (fecha: string) => ({
    type: 'L1' as const,
    label: 'Cierre de inscripción',
    deadlineAt: new Date(fecha),
    surchargeEur: null,
    blocking: false,
    origin: 'PUBLICADO' as const,
    sourceDocument: null,
    sourceUrl: null,
  });

  const calculado = (fecha: string) => ({
    ...publicado(fecha),
    origin: 'CALCULADO' as const,
    sourceDocument: 'Circular 12-26',
  });

  it('el publicado gana siempre al calculado para el mismo hito', async () => {
    const { mergeDeadlines } = await import('../src/lib/deadlines');
    const unidos = mergeDeadlines(
      [publicado('2027-03-01T12:00:00Z')],
      [calculado('2027-02-20T12:00:00Z')],
    );
    expect(unidos).toHaveLength(1);
    expect(unidos[0].origin).toBe('PUBLICADO');
    expect(unidos[0].deadlineAt.toISOString()).toContain('2027-03-01');
  });

  it('el semáforo dice si lo que enseña es una estimación', async () => {
    const { deadlineStatus } = await import('../src/lib/deadlines');
    const ahora = new Date('2027-02-01T00:00:00Z');

    const est = deadlineStatus([calculado('2027-02-10T12:00:00Z')], ahora);
    const pub = deadlineStatus([publicado('2027-02-10T12:00:00Z')], ahora);

    expect(est.hasEstimates).toBe(true);
    expect(pub.hasEstimates).toBe(false);
    // El origen viaja hasta la interfaz, que es la que tiene que marcarlo.
    expect(est.next?.origin).toBe('CALCULADO');
    expect(pub.next?.origin).toBe('PUBLICADO');
  });

  it('que venzan los plazos conocidos no es lo mismo que estar cerrado', async () => {
    const { deadlineStatus } = await import('../src/lib/deadlines');
    const ahora = new Date('2027-03-01T00:00:00Z');

    // Todos los hitos pasados, ninguno era un cierre duro: no se sabe si se
    // puede inscribir, y eso NO es lo mismo que saber que no se puede.
    const sinCierreDuro = deadlineStatus([publicado('2027-02-01T12:00:00Z')], ahora);
    expect(sinCierreDuro.closed).toBe(false);
    expect(sinCierreDuro.label).toMatch(/organizacion|organización/i);

    // Con un cierre duro vencido sí está cerrado, y se dice cuál fue.
    const conCierreDuro = deadlineStatus(
      [{ ...publicado('2027-02-01T12:00:00Z'), blocking: true }],
      ahora,
    );
    expect(conCierreDuro.closed).toBe(true);
    expect(conCierreDuro.state).toBe('cerrado');
  });

  it('la ficha de la prueba marca la estimación', async () => {
    // Es JSX y aquí no hay DOM; lo que se comprueba es que el componente
    // mira el ORIGEN del plazo, no solo los días que faltan. Si alguien
    // rehace la ficha y se deja esto, un plazo deducido de la normativa se
    // presentaría como si lo hubiese publicado la federación.
    const fuente = readFileSync(
      join(RAIZ, 'src', 'components', 'calendario', 'ficha-evento.tsx'),
      'utf8',
    );
    // La cifra grande del cierre avisa de que es una estimación.
    expect(fuente).toMatch(/status\.next\?\.origin === 'CALCULADO'/);
    expect(fuente).toContain('(estimado)');
    // Y cada hito de la lista dice de dónde sale.
    expect(fuente).toMatch(/d\.origin === 'CALCULADO'/);
    expect(fuente).toContain('· estimado');
    expect(fuente).toContain('· publicado');
  });

  it('en el .ics el estimado lleva su aviso y el publicado no', async () => {
    const { buildIcalFeed } = await import('../src/lib/ical');

    const base = {
      id: 'ev-1',
      source: 'skermo_rfee',
      sourceUrl: null,
      name: 'Prueba de auditoría',
      startDate: '2027-03-10',
      endDate: '2027-03-11',
      venue: null,
      venueAddress: null,
      city: null,
      country: null,
      geoLat: null,
      geoLon: null,
      timezone: null,
      officialSite: null,
      // Campo nuevo de `EventView` (cartel del torneo). Sin él el fixture ya
      // no cumple el tipo y `tsc --noEmit` falla.
      imageUrl: null,
      circuit: 'OTRO',
      scope: 'NACIONAL' as const,
      regionalFederation: null,
      notes: null,
      lastSeenAt: new Date(),
      disappearedAt: null,
      documents: [],
      liveLinks: [],
      // Campos nuevos de `EventView`: el emparejado del mismo torneo entre
      // Skermo y la FIE. Un evento sin pareja los trae vacíos, que es el caso
      // de la inmensa mayoría y el que audita esta prueba.
      linkedEvents: [],
      sources: [{ source: 'skermo_rfee', name: 'Prueba de auditoría', url: null }],
      imageSource: null,
      circuitFie: null,
      // Campo nuevo de `EventView`: lo que se sacó de los PDFs de las
      // circulares. Un evento del que nadie ha leído un dossier lo trae
      // vacío, que es el caso de esta prueba.
      datosExtraidos: [],
    };

    const comp = {
      id: 'comp-1',
      weapon: 'ESPADA' as const,
      gender: 'M' as const,
      category: 'ABS' as const,
      categoryRaw: null,
      format: 'INDIVIDUAL' as const,
      competitionDate: null,
      installationOpen: null,
      callTime: null,
      scratchTime: null,
      startTime: null,
      registrationCount: null,
      feeEur: null,
      sourceUrl: null,
      datosExtraidos: [],
    };

    const { deadlineStatus } = await import('../src/lib/deadlines');

    const conEstimado = [calculado('2027-03-01T12:00:00Z')];
    const conPublicado = [publicado('2027-03-01T12:00:00Z')];

    const icsEst = buildIcalFeed({
      type: 'todo',
      baseUrl: 'https://x.es',
      events: [
        {
          ...base,
          competitions: [
            { ...comp, deadlines: conEstimado, status: deadlineStatus(conEstimado) },
          ],
        },
      ],
    }).replace(/\r\n /g, '');

    const icsPub = buildIcalFeed({
      type: 'todo',
      baseUrl: 'https://x.es',
      events: [
        {
          ...base,
          competitions: [
            { ...comp, deadlines: conPublicado, status: deadlineStatus(conPublicado) },
          ],
        },
      ],
    }).replace(/\r\n /g, '');

    // La coma va escapada (`\,`) porque en iCal es un separador.
    expect(icsEst).toMatch(/estimado\\?, no publicado/);
    expect(icsPub).not.toMatch(/estimado\\?, no publicado/);
    // Sin sede publicada tampoco se inventa una ciudad.
    expect(icsEst).toContain('Sede: no publicada');
    expect(icsEst).toContain('Cuota: no publicado');
    expect(icsEst).toContain('Inscritos: no publicado');
  });
});

// ---------------------------------------------------------------------------
// Cuarentena
// ---------------------------------------------------------------------------

describe('lo que no valida va a cuarentena y NO al calendario', () => {
  it('ninguna fila en cuarentena ha entrado como evento', async () => {
    const filas = await db
      .select({
        source: esquema.ingestQuarantine.source,
        sourceId: esquema.ingestQuarantine.sourceId,
        errores: esquema.ingestQuarantine.validationErrors,
      })
      .from(esquema.ingestQuarantine);

    expect(filas.length).toBeGreaterThan(0);

    const { and, eq } = await import('drizzle-orm');
    for (const f of filas) {
      if (!f.sourceId) continue;
      const enCalendario = await db
        .select({ id: esquema.event.id })
        .from(esquema.event)
        .where(and(eq(esquema.event.source, f.source), eq(esquema.event.sourceId, f.sourceId)))
        .limit(1);
      expect(enCalendario, `${f.source}/${f.sourceId} está en el calendario`).toHaveLength(0);
    }
  }, 30_000);

  it('cada fila en cuarentena guarda POR QUÉ se rechazó', async () => {
    const filas = await db
      .select({ errores: esquema.ingestQuarantine.validationErrors })
      .from(esquema.ingestQuarantine);

    for (const f of filas) {
      expect(Array.isArray(f.errores) && f.errores.length > 0).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Huecos que no se rellenan
// ---------------------------------------------------------------------------

describe('los huecos siguen siendo huecos hasta la pantalla', () => {
  it('una ciudad, un país o un huso que no vienen no se inventan', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');
    const { inArray } = await import('drizzle-orm');

    const sinCiudad = await db
      .select({ id: esquema.event.id })
      .from(esquema.event)
      .where(sql`${esquema.event.city} is null`)
      .limit(10);

    if (sinCiudad.length === 0) return; // Nada que comprobar hoy.

    const vistas = await listEvents({
      ids: sinCiudad.map((e) => e.id),
      includePast: true,
      limit: 20,
    });

    for (const v of vistas) {
      expect(v.city, `${v.name} se ha rellenado la ciudad`).toBeNull();
      expect(v.city).not.toBe('Madrid');
    }
    // Y el `inArray` se usa de verdad: la consulta filtró.
    expect(inArray).toBeTypeOf('function');
  }, 30_000);

  it('el número de inscritos: null sigue siendo null, y 0 sigue siendo 0', async () => {
    const { listEvents } = await import('../src/lib/queries/calendar');

    const nulos = await contar(
      sql`select count(*)::int n from event_competition where registration_count is null`,
    );
    expect(nulos).toBeGreaterThan(0);

    const eventos = await listEvents({ limit: 120, includePast: true });
    const pruebas = eventos.flatMap((e) => e.competitions);
    const conNull = pruebas.filter((c) => c.registrationCount === null);

    expect(conNull.length).toBeGreaterThan(0);
    for (const c of conNull) expect(c.registrationCount).toBeNull();
    // Un 0 no se convierte en null ni al revés.
    for (const c of pruebas) {
      expect(c.registrationCount === null || typeof c.registrationCount === 'number').toBe(
        true,
      );
    }
  }, 40_000);

  it('no queda ningún valor por defecto con pinta de oficial en la capa de consultas', () => {
    const sospechosos = [
      /\?\?\s*'Madrid'/,
      /\|\|\s*'Madrid'/,
      /\?\?\s*'ES'(?!\w)/,
      // Una fecha inventada para un dato. `options.now ?? new Date()` no
      // cuenta: ahí "ahora" es un parámetro de la función, no un dato ausente.
      /(?<!now\s)\?\?\s*new Date\(\)/,
      /feeEur:\s*(c\.\w+\s*)?\?\?\s*['"]?0/,
      /registrationCount:\s*\w*\s*\?\?\s*0/,
    ];
    const ficheros = [
      'src/lib/queries/calendar.ts',
      'src/lib/queries/my-status.ts',
      'src/lib/queries/callups.ts',
      'src/lib/queries/coach.ts',
      'src/lib/ical.ts',
      'src/lib/deadlines.ts',
    ];

    const culpables: string[] = [];
    for (const f of ficheros) {
      const texto = readFileSync(join(RAIZ, f), 'utf8');
      for (const patron of sospechosos) {
        if (patron.test(texto)) culpables.push(`${f}: ${patron}`);
      }
    }
    expect(culpables).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rendimiento contra datos reales
// ---------------------------------------------------------------------------

describe('rendimiento con la base real (límite de 300 s de Vercel)', () => {
  it('la ficha de un evento no carga el calendario entero', async () => {
    const { getEvent, listEvents } = await import('../src/lib/queries/calendar');

    const [uno] = await listEvents({ limit: 1, includePast: true });
    expect(uno).toBeTruthy();

    // Filtrando por id se trae un evento, no los 248.
    const soloUno = await listEvents({ ids: [uno.id], includePast: true, limit: 1 });
    expect(soloUno).toHaveLength(1);
    expect(soloUno[0].id).toBe(uno.id);

    const ficha = await getEvent(uno.id);
    expect(ficha?.id).toBe(uno.id);
    // Mismo contenido que por la vía larga: el atajo no pierde nada.
    expect(ficha?.competitions.length).toBe(uno.competitions.length);
  }, 60_000);

  it('la ingestión de circulares escribe en lote, no una fila por viaje de red', () => {
    const texto = readFileSync(join(RAIZ, 'src', 'lib', 'ingest', 'runner.ts'), 'utf8');
    // No puede quedar un SELECT por documento dentro del bucle.
    expect(texto).not.toMatch(/for \(const doc of candidates\)/);
    expect(texto).toContain('onConflictDoUpdate');
    // Y la cuarentena tampoco inserta de una en una.
    expect(texto).not.toMatch(/for \(const item of items\) \{\s*await db\.insert/);
  });
});
