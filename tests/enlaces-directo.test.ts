import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enlaceDeTarjeta,
  esPortada,
  estadoDirecto,
  normalizarUrlDirecto,
  proveedorDeUrl,
} from '@/lib/calendario/enlaces-directo';
import {
  REGLA_ENGARDE_CIUDAD,
  REGLA_ENGARDE_UNICA,
  divisionDeEngarde,
  emparejarTorneoEngarde,
  mismaCiudad,
  parsearListaTorneosEngarde,
  sinTorneoAmbiguo,
  torneosEnVentanaEngarde,
  type PruebaCalendarioDirecto,
  type PruebaEngardeDirecto,
} from '@/lib/ingest/enlaces-directo-engarde';
import { atribuirEnlacesDirecto } from '@/lib/queries/enlaces-directo-vista';
import { enlacesDirectoFie } from '@/lib/ingest/sources/fie';
import { PastillaDirecto, PastillaDirectoDePrueba } from '@/components/calendario/enlace-directo';
import { PieResultados } from '@/components/calendario/pasado/resultados-pasados';
import type { EventView } from '@/lib/queries/calendar';
import type { PruebaPasada } from '@/lib/queries/calendario-pasado-modelo';

const local = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/db', () => ({
  get db() {
    return local.db;
  },
}));

describe('URLs de directo', () => {
  it('limpia lo que pega la FIE: #today, la URL repetida y espacios', () => {
    expect(
      normalizarUrlDirecto(
        ' https://www.fencingtimelive.com/tournaments/eventSchedule/113C3EFDAEB24A658500F65347E7A6DD#todayhttps://www.fencingtimelive.com/tournaments/eventSchedule/113C3EFDAEB24A658500F65347E7A6DD#today',
      ),
    ).toBe('https://www.fencingtimelive.com/tournaments/eventSchedule/113C3EFDAEB24A658500F65347E7A6DD');
    expect(normalizarUrlDirecto('https://www.fencingtimelive.com?t=19006')).toBe('https://www.fencingtimelive.com/?t=19006');
    expect(normalizarUrlDirecto('javascript:alert(1)')).toBeNull();
    expect(normalizarUrlDirecto('')).toBeNull();
  });

  it('reconoce el proveedor por el dominio, no por lo que diga la fuente', () => {
    expect(proveedorDeUrl('https://engarde-service.com/competition/rfee/mad/sma_ind')).toBe('engarde');
    expect(proveedorDeUrl('https://fencingtimelive.com/tournaments/eventSchedule/X')).toBe('ftl');
    expect(proveedorDeUrl('https://fencingworldwide.com/es/1234-2026/tournament/')).toBe('ophardt');
    expect(proveedorDeUrl('https://fencing.ophardt.online/en/widget/event/1')).toBe('ophardt');
    expect(proveedorDeUrl('https://fie.org/competitions/2027/47')).toBe('fie');
    expect(proveedorDeUrl('https://example.org/x')).toBe('otro');
  });

  it('la portada del proveedor no sirve; el enlace antiguo de FTL con ?t= sí', () => {
    expect(esPortada('https://www.fencingtimelive.com/')).toBe(true);
    expect(esPortada('https://www.fencingtimelive.com/?t=17989')).toBe(false);
  });

  it('la FIE: resultados y retransmisión por separado, sin portadas ni repetidos', () => {
    expect(
      enlacesDirectoFie({
        livestreamResultsLink: 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC#today',
        livestreamLink: 'https://youtube.com/watch?v=1',
      }),
    ).toEqual([
      expect.objectContaining({ platform: 'ftl', kind: 'resultados', url: 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC' }),
      expect.objectContaining({ platform: 'otro', kind: 'en_vivo' }),
    ]);
    expect(enlacesDirectoFie({ livestreamResultsLink: 'https://www.fencingtimelive.com/', livestreamLink: null })).toEqual([]);
  });
});

describe('«En directo» o «Resultados»', () => {
  it('en directo los días que se tira, resultados antes y después', () => {
    const r = { desde: '2026-10-03', hasta: '2026-10-04' };
    expect(estadoDirecto(r, '2026-10-02')).toBe('resultados');
    expect(estadoDirecto(r, '2026-10-03')).toBe('directo');
    expect(estadoDirecto(r, '2026-10-04')).toBe('directo');
    expect(estadoDirecto(r, '2026-10-05')).toBe('resultados');
  });

  it('en América la jornada sigue cuando en Madrid ya es mañana', () => {
    const r = { desde: '2026-10-08', hasta: '2026-10-08' };
    expect(estadoDirecto(r, '2026-10-09', 'America/Lima')).toBe('directo');
    expect(estadoDirecto(r, '2026-10-09', 'Asia/Tokyo')).toBe('resultados');
  });

  it('la tarjeta usa el del torneo, o el que comparten sus pruebas, o el de la prueba de hoy', () => {
    const a = { url: 'https://engarde-service.com/competition/rfee/x/a', proveedor: 'engarde' as const };
    const b = { url: 'https://engarde-service.com/competition/rfee/x/b', proveedor: 'engarde' as const };
    const t = { url: 'https://engarde-service.com/tournament/rfee/x', proveedor: 'engarde' as const };
    const base = { startDate: '2026-09-26', endDate: '2026-09-27' };
    const comps = [
      { competitionDate: '2026-09-26', enlaceDirecto: a },
      { competitionDate: '2026-09-27', enlaceDirecto: b },
    ];
    expect(enlaceDeTarjeta({ ...base, enlaceDirecto: t, competitions: comps }, '2026-09-27')).toBe(t);
    expect(enlaceDeTarjeta({ ...base, competitions: comps }, '2026-09-27')).toBe(b);
    expect(enlaceDeTarjeta({ ...base, competitions: [comps[0], { ...comps[1], enlaceDirecto: a }] }, '2026-09-27')).toBe(a);
    expect(enlaceDeTarjeta({ ...base, competitions: [{ competitionDate: null }] }, '2026-09-27')).toBeNull();
  });
});

function engarde(compe: string, sobre: Partial<PruebaEngardeDirecto> = {}): PruebaEngardeDirecto {
  return {
    org: 'rfee',
    evt: 'sabadell',
    compe,
    url: `https://engarde-service.com/competition/rfee/sabadell/${compe}`,
    titulo: compe,
    arma: 'FLORETE',
    genero: 'M',
    categoria: 'ABS',
    categoriaContradictoria: false,
    individual: true,
    fecha: '2026-10-03',
    ciudad: 'SABADELL',
    ...sobre,
  };
}

function cal(id: string, sobre: Partial<PruebaCalendarioDirecto> = {}): PruebaCalendarioDirecto {
  return {
    competitionId: id,
    eventId: `ev-${id}`,
    weapon: 'FLORETE',
    gender: 'M',
    category: 'ABS',
    format: 'INDIVIDUAL',
    fecha: '2026-10-03',
    ciudad: 'SABADELL',
    pais: 'ES',
    circuit: 'TNR',
    ...sobre,
  };
}

describe('emparejado con la cuenta de Engarde de la RFEE', () => {
  it('casa por fecha ±1, ciudad y prueba, y cuelga además la página del torneo', () => {
    const { enlaces } = emparejarTorneoEngarde(
      [engarde('fma', { fecha: '2026-10-04' })],
      [cal('tnr'), cal('otra-ciudad', { ciudad: 'MADRID' })],
    );
    expect(enlaces).toEqual([
      { eventId: 'ev-tnr', competitionId: 'tnr', url: 'https://engarde-service.com/competition/rfee/sabadell/fma', regla: REGLA_ENGARDE_CIUDAD },
      { eventId: 'ev-tnr', competitionId: null, url: 'https://engarde-service.com/tournament/rfee/sabadell', regla: REGLA_ENGARDE_CIUDAD },
    ]);
  });

  it('no casa a dos días, ni con otra arma, género, categoría o modalidad', () => {
    const p = engarde('fma');
    for (const c of [
      cal('a', { fecha: '2026-10-05' }),
      cal('b', { weapon: 'SABLE' }),
      cal('c', { gender: 'F' }),
      cal('d', { category: 'M20' }),
      cal('e', { format: 'EQUIPOS' }),
    ]) {
      expect(emparejarTorneoEngarde([p], [c]).enlaces, c.competitionId).toEqual([]);
    }
  });

  it('nunca por el nombre: sin ciudad que coincida sólo vale la única prueba española', () => {
    const p = engarde('ef', { evt: 'tnrm2026', arma: null, titulo: 'ESPADA FEMENINA', genero: 'F', categoria: 'M20', ciudad: 'BARCELONA', fecha: '2026-09-20' });
    const esplugues = cal('esp', { weapon: 'ESPADA', gender: 'F', category: 'M20', ciudad: 'SANT JOAN DESPÍ', fecha: '2026-09-20' });
    expect(emparejarTorneoEngarde([p], [esplugues]).enlaces[0]).toMatchObject({ competitionId: 'esp', regla: REGLA_ENGARDE_UNICA });
    // Con una segunda candidata, o con la única en el extranjero, no se elige.
    expect(emparejarTorneoEngarde([p], [esplugues, { ...esplugues, competitionId: 'otra', ciudad: 'VALENCIA' }]).enlaces).toEqual([]);
    expect(emparejarTorneoEngarde([p], [{ ...esplugues, pais: 'FR' }]).enlaces).toEqual([]);
  });

  it('separa las divisiones de la liga por equipos del mismo día y sede', () => {
    const ligas = [
      cal('oro', { format: 'EQUIPOS', circuit: 'LIGA_ORO' }),
      cal('plata', { format: 'EQUIPOS', circuit: 'LIGA_PLATA' }),
    ];
    const { enlaces } = emparejarTorneoEngarde(
      [
        engarde('l_oro', { individual: false, titulo: 'LIGA ORO FLORETE MAS 1ª JORNADA' }),
        engarde('l_plata', { individual: false, titulo: 'LIGA PLATA FLORETE MAS 1ª JORNAD' }),
      ],
      ligas,
    );
    expect(enlaces.filter((e) => e.competitionId).map((e) => [e.competitionId, e.url.split('/').pop()])).toEqual([
      ['oro', 'l_oro'],
      ['plata', 'l_plata'],
    ]);
    expect(divisionDeEngarde('LIGA PLATA FLORETE FEM', 'l_pt')).toBe('plata');
    expect(divisionDeEngarde('X', 'l_pt')).toBe('plata');
    expect(divisionDeEngarde('LIGA BRONCE y 4ª DIVISION ESPADA', 'ligaem')).toBe('bronce');
  });

  it('dos pruebas de Engarde para una del calendario: nada, salvo que sean fases', () => {
    const tnr = [cal('tnr')];
    expect(emparejarTorneoEngarde([engarde('a'), engarde('b')], tnr)).toMatchObject({ enlaces: [], ambiguas: 2 });
    const { enlaces } = emparejarTorneoEngarde(
      [
        engarde('ema_1f', { titulo: 'ESPADA MAS INDIVIDUAL 1ª FASE', fecha: '2026-10-03' }),
        engarde('ema_2f', { titulo: 'ESPADA MAS INDIVIDUAL 2ª FASE', fecha: '2026-10-04', arma: null }),
      ].map((p) => ({ ...p, arma: 'FLORETE' as const })),
      tnr,
    );
    expect(enlaces[0].url).toMatch(/ema_2f$/);
  });

  it('un evento con varios torneos de Engarde se queda sin enlace de torneo; las pruebas sí', () => {
    const florete = cal('fm');
    const espada = cal('em', { eventId: florete.eventId, weapon: 'ESPADA' });
    const calendario = [florete, espada];
    const dos = [
      ...emparejarTorneoEngarde([engarde('fma', { evt: 'sab_flo' })], calendario).enlaces,
      ...emparejarTorneoEngarde([engarde('ema', { evt: 'sab_esp', arma: 'ESPADA' })], calendario).enlaces,
    ];
    expect(dos.filter((e) => e.competitionId === null)).toHaveLength(2);
    const filtrados = sinTorneoAmbiguo(dos);
    expect(filtrados.filter((e) => e.competitionId === null)).toEqual([]);
    expect(filtrados.map((e) => e.competitionId).sort()).toEqual(['em', 'fm']);
    // Dentro de una misma llamada, igual.
    const juntas = emparejarTorneoEngarde(
      [engarde('fma', { evt: 'sab_flo' }), engarde('ema', { evt: 'sab_esp', arma: 'ESPADA' })],
      calendario,
    ).enlaces;
    expect(juntas.filter((e) => e.competitionId === null)).toEqual([]);
    expect(juntas).toHaveLength(2);
  });

  it('dos torneos que reclaman la misma prueba con URL distinta: esa prueba se queda sin enlace', async () => {
    const { sinPruebaAmbigua } = await import('@/lib/ingest/directos');
    const calendario = [cal('fm'), cal('em', { eventId: 'ev-fm', weapon: 'ESPADA' })];
    const enlaces = [
      ...emparejarTorneoEngarde(
        [engarde('fma', { evt: 'sab_a', url: 'https://engarde-service.com/competition/rfee/sab_a/fma' })],
        calendario,
      ).enlaces,
      ...emparejarTorneoEngarde(
        [
          engarde('fma', { evt: 'sab_b', url: 'https://engarde-service.com/competition/rfee/sab_b/fma' }),
          engarde('ema', { evt: 'sab_b', arma: 'ESPADA', url: 'https://engarde-service.com/competition/rfee/sab_b/ema' }),
        ],
        calendario,
      ).enlaces,
    ];
    const quedan = sinPruebaAmbigua(enlaces);
    expect(quedan.filter((e) => e.competitionId === 'fm')).toEqual([]);
    expect(quedan.filter((e) => e.competitionId === 'em')).toHaveLength(1);
    // La misma URL repetida (o con fragmento) no es ambigua.
    const misma = [{ eventId: 'e', competitionId: 'c', url: 'https://x.org/a' }, { eventId: 'e', competitionId: 'c', url: 'https://x.org/a#b' }];
    expect(sinPruebaAmbigua(misma)).toHaveLength(2);
  });

  it('la ciudad tolera recortes y erratas, no ciudades distintas', () => {
    expect(mismaCiudad('MEDINA DEL.', 'Medina del Campo')).toBe(true);
    expect(mismaCiudad('Barcelona .', 'BARCELONA')).toBe(true);
    expect(mismaCiudad('ESPLUES DE LLOBREGAT', 'Esplugues de Llobregat')).toBe(true);
    expect(mismaCiudad('Madrid', 'Valencia')).toBe(false);
    expect(mismaCiudad(null, 'Madrid')).toBe(false);
  });

  it('lee la lista del organismo y se queda con la ventana', () => {
    const lista = parsearListaTorneosEngarde(
      JSON.stringify({
        result: [
          { Organisme: 'rfee', Event: 'sabadell', Titre: 'TNR', date: '2026-10-03' },
          { Organisme: 'otro', Event: 'x', Titre: 'X', date: '2026-10-03' },
          { Organisme: 'rfee', Event: 'mal/ruta', Titre: 'X', date: '2026-10-03' },
          { Organisme: 'rfee', Event: 'viejo', Titre: 'V', date: '2025-10-03' },
        ],
      }),
      'rfee',
    );
    expect(lista?.map((t) => t.evt)).toEqual(['sabadell', 'viejo']);
    expect(torneosEnVentanaEngarde(lista!, '2026-10-06').map((t) => t.evt)).toEqual(['sabadell']);
    expect(parsearListaTorneosEngarde('<html>', 'rfee')).toBeNull();
  });
});

describe('reparto de enlaces en la tarjeta', () => {
  const ftl = 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC';
  it('el de la prueba de la FIE absorbida sube a la prueba equivalente de la tarjeta', () => {
    const { porPrueba, porTarjeta } = atribuirEnlacesDirecto({
      enlaces: [{ eventId: 'fie-1', eventCompetitionId: null, kind: 'resultados', url: `${ftl}#today`, tarjetaId: 'skermo' }],
      pruebas: [
        { id: 'c-skermo', eventId: 'skermo', clave: 'FLORETE|M|M20|INDIVIDUAL' },
        { id: 'c-fie', eventId: 'fie-1', clave: 'FLORETE|M|M20|INDIVIDUAL' },
      ],
    });
    expect(porPrueba.get('skermo|FLORETE|M|M20|INDIVIDUAL')).toEqual({ url: ftl, proveedor: 'ftl' });
    expect(porTarjeta.size).toBe(0);
  });

  it('gana el propio, se ignora la retransmisión y la portada', () => {
    const { porPrueba, porTarjeta } = atribuirEnlacesDirecto({
      enlaces: [
        { eventId: 'fie-1', eventCompetitionId: 'c-fie', kind: 'resultados', url: ftl, tarjetaId: 'skermo' },
        { eventId: 'skermo', eventCompetitionId: 'c-skermo', kind: 'resultados', url: 'https://engarde-service.com/competition/rfee/a/b', tarjetaId: 'skermo' },
        { eventId: 'skermo', eventCompetitionId: null, kind: 'en_vivo', url: 'https://youtube.com/watch?v=1', tarjetaId: 'skermo' },
        { eventId: 'skermo', eventCompetitionId: null, kind: 'resultados', url: 'https://www.fencingtimelive.com/', tarjetaId: 'skermo' },
      ],
      pruebas: [
        { id: 'c-skermo', eventId: 'skermo', clave: 'K' },
        { id: 'c-fie', eventId: 'fie-1', clave: 'K' },
      ],
    });
    expect(porPrueba.get('skermo|K')?.proveedor).toBe('engarde');
    expect(porTarjeta.size).toBe(0);
  });

  it('la copia sin prueba de un enlace que el evento ya tiene con prueba no es del torneo', () => {
    const url = 'https://engarde-service.com/competition/rfee/sabadell/fma';
    const { porPrueba, porTarjeta } = atribuirEnlacesDirecto({
      enlaces: [
        { eventId: 'ev', eventCompetitionId: 'c1', kind: 'resultados', url, tarjetaId: 'ev' },
        { eventId: 'ev', eventCompetitionId: null, kind: 'resultados', url: `${url}#x`, tarjetaId: 'ev' },
      ],
      pruebas: [
        { id: 'c1', eventId: 'ev', clave: 'K1' },
        { id: 'c2', eventId: 'ev', clave: 'K2' },
      ],
    });
    expect(porPrueba.get('ev|K1')?.url).toBe(url);
    expect(porTarjeta.size).toBe(0);
  });
});

describe('pastillas', () => {
  const enlace = { url: 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC', proveedor: 'ftl' as const };

  it('«En directo» con punto rojo, en otra pestaña', () => {
    const html = renderToStaticMarkup(h(PastillaDirecto, { enlace, estado: 'directo' }));
    expect(html).toContain('En directo');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('bg-danger');
    expect(html).toContain('Fencing Time Live');
  });

  it('«Resultados» fuera de los días de la prueba', () => {
    const html = renderToStaticMarkup(
      h(PastillaDirectoDePrueba, {
        enlace,
        fecha: '2026-09-25',
        evento: { startDate: '2026-09-24', endDate: '2026-09-27', timezone: null },
        hoy: '2026-09-26',
      }),
    );
    expect(html).toContain('Resultados');
    expect(html).toContain('data-directo="resultados"');
    expect(
      renderToStaticMarkup(
        h(PastillaDirectoDePrueba, { enlace: null, fecha: null, evento: { startDate: '', endDate: '', timezone: null }, hoy: '' }),
      ),
    ).toBe('');
  });

  it('el pie de un torneo pasado sin resultados importados enseña sólo el enlace', () => {
    const evento = { id: 'e', name: 'TNR', competitions: [] } as unknown as EventView;
    const html = renderToStaticMarkup(
      h(PieResultados, { evento, pruebas: [] as PruebaPasada[], onVer: () => {}, directo: { enlace, estado: 'resultados' } }),
    );
    expect(html).toContain('Resultados');
    expect(html).toContain(enlace.url);
    expect(renderToStaticMarkup(h(PieResultados, { evento, pruebas: [], onVer: () => {} }))).toBe('');
  });
});

const MIGRACIONES = readdirSync(new URL('../drizzle-d1/', import.meta.url))
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

function baseHasta(ultima: string): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  for (const f of MIGRACIONES.filter((m) => m <= ultima)) {
    db.exec(readFileSync(new URL(`../drizzle-d1/${f}`, import.meta.url), 'utf8'));
  }
  return db;
}

function sembrar(db: DatabaseSync) {
  db.exec(`
    INSERT INTO event (id, source, source_id, name, start_date, end_date, scope, content_hash, city, country, circuit)
    VALUES ('ev', 'skermo_rfee', 's1', 'TNR ABS', '2026-10-03', '2026-10-04', 'NACIONAL', 'h', 'SABADELL', 'ES', 'TNR');
    INSERT INTO event_competition (id, event_id, weapon, gender, category, format, competition_date, content_hash)
    VALUES ('c1', 'ev', 'FLORETE', 'M', 'ABS', 'INDIVIDUAL', '2026-10-03', 'h');`);
}

describe('0008_enlaces_directo.sql', () => {
  it('añade match_rule y quita los enlaces de torneo repetidos por los NULL', () => {
    const db = baseHasta('0007_zzz');
    sembrar(db);
    const ins = db.prepare(`INSERT INTO live_source (event_id, event_competition_id, platform, url, is_automatic) VALUES (?, ?, 'engarde', ?, 1)`);
    ins.run('ev', null, 'https://engarde-service.com/tournament/rfee/sabadell');
    ins.run('ev', null, 'https://engarde-service.com/tournament/rfee/sabadell');
    ins.run('ev', 'c1', 'https://engarde-service.com/competition/rfee/sabadell/fma');
    db.exec(readFileSync(new URL('../drizzle-d1/0008_enlaces_directo.sql', import.meta.url), 'utf8'));
    expect(db.prepare('SELECT count(*) n FROM live_source').get()).toEqual({ n: 2 });
    const columnas = db.prepare('PRAGMA table_info(live_source)').all().map((c) => c.name);
    expect(columnas).toContain('match_rule');
    db.close();
  });

  it('entre una manual y una automática gemelas conserva siempre la manual; ninguna manual se borra', () => {
    const db = baseHasta('0007_zzz');
    sembrar(db);
    db.exec(`
      INSERT INTO event_competition (id, event_id, weapon, gender, category, format, competition_date, content_hash)
      VALUES ('c2', 'ev', 'ESPADA', 'M', 'ABS', 'INDIVIDUAL', '2026-10-04', 'h');`);
    const fma = 'https://engarde-service.com/competition/rfee/sabadell/fma';
    const ins = db.prepare(
      `INSERT INTO live_source (event_id, event_competition_id, platform, kind, url, label, is_automatic) VALUES (?, ?, 'engarde', 'resultados', ?, ?, ?)`,
    );
    // La automática es la más antigua: con min(rowid) se habría quedado ella.
    ins.run('ev', null, fma, 'Resultados en Engarde', 1);
    ins.run('ev', null, `${fma}#x`, 'A mano', 0);
    ins.run('ev', null, fma, 'A mano otra vez', 0);
    ins.run('ev', 'c1', fma, null, 0);
    db.exec(readFileSync(new URL('../drizzle-d1/0008_enlaces_directo.sql', import.meta.url), 'utf8'));
    expect(
      db.prepare('SELECT event_competition_id c, label, is_automatic a FROM live_source ORDER BY rowid').all(),
    ).toEqual([
      { c: null, label: 'A mano', a: 0 },
      { c: null, label: 'A mano otra vez', a: 0 },
      { c: 'c1', label: null, a: 0 },
    ]);
    db.close();
  });

  it('pasa a su prueba las copias sin prueba de la FIE y del índice de Skermo, o las deja del torneo', () => {
    const db = baseHasta('0007_zzz');
    sembrar(db);
    db.exec(`
      INSERT INTO event_competition (id, event_id, weapon, gender, category, format, competition_date, content_hash)
      VALUES ('c2', 'ev', 'ESPADA', 'M', 'ABS', 'INDIVIDUAL', '2026-10-04', 'h');
      INSERT INTO event (id, source, source_id, name, start_date, end_date, scope, content_hash, city, country, circuit)
      VALUES ('fie', 'fie', 'fie-2027-9', 'Satellite', '2026-10-03', '2026-10-03', 'INTERNACIONAL', 'h', 'X', 'IT', 'SATELITE'),
             ('uno', 'skermo_rfee', 's2', 'Copa', '2026-10-03', '2026-10-03', 'NACIONAL', 'h', 'Y', 'ES', 'TNR');
      INSERT INTO event_competition (id, event_id, weapon, gender, category, format, competition_date, content_hash)
      VALUES ('cf', 'fie', 'FLORETE', 'M', 'ABS', 'INDIVIDUAL', '2026-10-03', 'h'),
             ('cu', 'uno', 'SABLE', 'F', 'ABS', 'INDIVIDUAL', '2026-10-03', 'h');`);
    const ins = db.prepare(
      `INSERT INTO live_source (event_id, event_competition_id, platform, kind, url, label, is_automatic) VALUES (?, ?, ?, 'resultados', ?, ?, ?)`,
    );
    const ftl = 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC';
    const fma = 'https://engarde-service.com/competition/rfee/sabadell/fma';
    // FIE: dos copias sin prueba (cruda y con #today) del enlace de su única prueba.
    ins.run('fie', null, 'fie', `${ftl}#today`, 'Resultados en vivo (FIE)', 1);
    ins.run('fie', null, 'fie', ftl, 'Resultados en vivo (FIE)', 1);
    // Skermo con varias pruebas: la copia sin prueba de una que ya está con prueba, y otra que no.
    ins.run('ev', 'c1', 'engarde', fma, null, 1);
    ins.run('ev', null, 'engarde', fma, 'Resultados en Engarde', 1);
    ins.run('ev', null, 'engarde', 'https://engarde-service.com/competition/rfee/sabadell/ema', 'Resultados en Engarde', 1);
    // Skermo con una sola prueba: pasa a esa prueba.
    ins.run('uno', null, 'engarde', 'https://engarde-service.com/competition/rfee/y/sfa', 'Resultados en Engarde', 1);
    // Puestos a mano: no se tocan.
    ins.run('ev', null, 'otro', 'https://example.org/directo', 'A mano', 0);
    db.exec(readFileSync(new URL('../drizzle-d1/0008_enlaces_directo.sql', import.meta.url), 'utf8'));
    expect(
      db.prepare('SELECT event_id e, event_competition_id c, url, match_rule r FROM live_source ORDER BY event_id, url').all(),
    ).toEqual([
      // Varias pruebas: no se sabe cuál; queda como enlace del torneo (los antiguos no se releen).
      { e: 'ev', c: null, url: 'https://engarde-service.com/competition/rfee/sabadell/ema', r: null },
      { e: 'ev', c: 'c1', url: fma, r: null },
      { e: 'ev', c: null, url: 'https://example.org/directo', r: null },
      { e: 'fie', c: 'cf', url: ftl, r: 'fie_publicado' },
      { e: 'uno', c: 'cu', url: 'https://engarde-service.com/competition/rfee/y/sfa', r: 'skermo_indice' },
    ]);
    db.close();
  });
});

describe('escritura y pasada nocturna de Engarde', () => {
  let sqlite: DatabaseSync;
  let cerrar: () => void;
  beforeEach(async () => {
    const { localD1 } = await import('@/db/d1/testing');
    const { createD1Database } = await import('@/db/d1/runtime');
    const l = localD1();
    // localD1 sólo aplica 0000, y de las demás sólo 0008 toca live_source.
    l.sqlite.exec(readFileSync(new URL('../drizzle-d1/0008_enlaces_directo.sql', import.meta.url), 'utf8'));
    sembrar(l.sqlite);
    sqlite = l.sqlite;
    cerrar = l.close;
    local.db = createD1Database(l.binding);
  });
  afterEach(() => cerrar());

  it('no duplica el enlace del torneo entre pasadas y guarda la regla', async () => {
    const { escribirEnlacesDirecto } = await import('@/lib/ingest/directos');
    const fila = {
      eventId: 'ev',
      eventCompetitionId: null,
      platform: 'x',
      kind: 'resultados',
      url: 'https://engarde-service.com/tournament/rfee/sabadell',
      automatic: true,
      matchRule: REGLA_ENGARDE_CIUDAD,
    };
    expect(await escribirEnlacesDirecto([fila, fila])).toBe(1);
    expect(await escribirEnlacesDirecto([fila])).toBe(0);
    expect(sqlite.prepare('SELECT platform, match_rule FROM live_source').all()).toEqual([
      { platform: 'engarde', match_rule: REGLA_ENGARDE_CIUDAD },
    ]);
  });

  it('el enlace antiguo sin prueba (guardado en crudo) pasa a su prueba en vez de duplicarse', async () => {
    const { escribirEnlacesDirecto } = await import('@/lib/ingest/directos');
    const ftl = 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC';
    sqlite.exec(`
      INSERT INTO live_source (event_id, event_competition_id, platform, kind, url, is_automatic) VALUES
        ('ev', NULL, 'fie', 'resultados', '${ftl}#today', 1),
        ('ev', NULL, 'fie', 'resultados', ' ${ftl} ', 1),
        ('ev', NULL, 'otro', 'resultados', '${ftl}', 0);`);
    const fila = {
      eventId: 'ev', eventCompetitionId: 'c1', platform: 'x', kind: 'resultados', url: ftl,
      automatic: true, matchRule: 'fie_publicado',
    };
    expect(await escribirEnlacesDirecto([fila])).toBe(1);
    expect(await escribirEnlacesDirecto([fila])).toBe(0);
    expect(
      sqlite.prepare('SELECT event_competition_id c, url, is_automatic a, match_rule r FROM live_source ORDER BY a, c').all(),
    ).toEqual([
      { c: null, url: ftl, a: 0, r: null },
      { c: 'c1', url: ftl, a: 1, r: 'fie_publicado' },
    ]);
  });

  it('si ya existe con prueba, la copia sin prueba se borra; y no se repite por normalizar', async () => {
    const { escribirEnlacesDirecto } = await import('@/lib/ingest/directos');
    const fma = 'https://engarde-service.com/competition/rfee/sabadell/fma';
    sqlite.exec(`
      INSERT INTO live_source (event_id, event_competition_id, platform, kind, url, is_automatic) VALUES
        ('ev', 'c1', 'engarde', 'resultados', '${fma}#a', 1),
        ('ev', NULL, 'engarde', 'resultados', '${fma}', 1);`);
    const fila = { eventId: 'ev', eventCompetitionId: 'c1', platform: 'x', kind: 'resultados', url: fma, automatic: true };
    expect(await escribirEnlacesDirecto([fila])).toBe(0);
    expect(sqlite.prepare('SELECT event_competition_id c FROM live_source').all()).toEqual([{ c: 'c1' }]);
  });

  it('el calendario entrega el enlace por prueba y el del torneo, heredando el de la FIE absorbida', async () => {
    sqlite.exec(`
      INSERT INTO event (id, source, source_id, name, start_date, end_date, scope, content_hash, city, circuit, canonical_event_id)
      VALUES ('fie', 'fie', 'fie-2027-9', 'Satellite', '2026-10-03', '2026-10-03', 'INTERNACIONAL', 'h', 'Sabadell', 'SATELITE', 'ev');
      INSERT INTO event_competition (id, event_id, weapon, gender, category, format, competition_date, content_hash)
      VALUES ('cf', 'fie', 'FLORETE', 'M', 'ABS', 'EQUIPOS', '2026-10-03', 'h');
      INSERT INTO live_source (event_id, event_competition_id, platform, url) VALUES
        ('ev', 'c1', 'engarde', 'https://engarde-service.com/competition/rfee/sabadell/fma'),
        ('ev', NULL, 'engarde', 'https://engarde-service.com/tournament/rfee/sabadell'),
        ('ev', NULL, 'engarde', 'https://engarde-service.com/tournament/rfee/sabadell'),
        ('fie', NULL, 'fie', 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC#today');`);
    const { listEvents } = await import('@/lib/queries/calendar');
    const [e] = await listEvents({ ids: ['ev'], includePast: true });
    expect(e.enlaceDirecto).toEqual({ url: 'https://engarde-service.com/tournament/rfee/sabadell', proveedor: 'engarde' });
    const porFormato = Object.fromEntries(e.competitions.map((c) => [c.format, c.enlaceDirecto]));
    expect(porFormato.INDIVIDUAL).toEqual({ url: 'https://engarde-service.com/competition/rfee/sabadell/fma', proveedor: 'engarde' });
    expect(porFormato.EQUIPOS).toEqual({ url: 'https://www.fencingtimelive.com/tournaments/eventSchedule/ABC', proveedor: 'ftl' });
    expect(e.liveLinks).toHaveLength(3);
  });

  it('lee la lista y el índice con pausa, empareja y escribe', async () => {
    const { ingestDirectosEngarde } = await import('@/lib/ingest/directos');
    const pedidas: string[] = [];
    const esperas: number[] = [];
    const indice = `<?xml version="1.0"?><comps><pagination nbresultats="1" nbpages="1"/>
      <comp org="rfee" evt="sabadell" compe="fma" arme="F" sexe="M" estindividuelle="1" date="2026-10-03" ville="SABADELL" pays="ESP" etat="completed">
        <titre>FLORETE MASCULINO ABS INDIVIDUAL</titre><categorie>senior</categorie></comp></comps>`;
    const r = await ingestDirectosEngarde({
      hoy: '2026-10-06',
      deps: {
        async post(url, form) {
          pedidas.push(`${url.split('/').pop()}:${form.event ?? form.option}`);
          if (url.endsWith('getTournois.php')) {
            return { status: 200, body: JSON.stringify({ result: [{ Organisme: 'rfee', Event: 'sabadell', Titre: 'TNR', date: '2026-10-03' }] }) };
          }
          return { status: 200, body: indice };
        },
        async esperar(ms) {
          esperas.push(ms);
        },
      },
    });
    expect(pedidas).toEqual(['getTournois.php:tournois', 'getCompeForDisplay.php:sabadell']);
    expect(esperas.every((ms) => ms >= 500)).toBe(true);
    expect(r).toMatchObject({ torneosMirados: 1, enlaces: 2, escritos: 2, fallos: 0 });
    expect(
      sqlite.prepare('SELECT event_competition_id c, url, match_rule r FROM live_source ORDER BY url').all(),
    ).toEqual([
      { c: 'c1', url: 'https://engarde-service.com/competition/rfee/sabadell/fma', r: REGLA_ENGARDE_CIUDAD },
      { c: null, url: 'https://engarde-service.com/tournament/rfee/sabadell', r: REGLA_ENGARDE_CIUDAD },
    ]);
  });
});

function h<P extends object>(c: React.ComponentType<P>, p: P) {
  return React.createElement(c, p);
}
