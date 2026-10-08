import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatabaseSync } from 'node:sqlite';
import { claveNombre, indicePorNombre, vincularPorNombre } from '@/lib/ingest/ranking-skermo-historico';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { construirRankingNacional, sqlTemporadaMundial, type FilaRankingNacional } from '@/lib/sport/explorar/ranking-nacional';
import { aRivalesPorAmbito, pruebasDudosas, type FilaRivalAmbito } from '@/lib/sport/explorar/rivales-ambito';
import { leerFilasPerfil } from '@/lib/sport/explorar/perfil-datos';
import type { EntradaRankingOficial } from '@/lib/sport/explorar/tipos';
import { TarjetaGiratoria } from '@/components/explorar/perfil/tarjeta-giratoria';
import { RivalesPorAmbitoVista } from '@/components/explorar/perfil/rivales-ambito';
import { FilaLinea } from '@/components/ranking/fila-linea';
import { MisTiradores } from '@/components/ranking/mis-tiradores';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const html = (e: React.ReactElement) => renderToStaticMarkup(e);

const filaNac = (p: Partial<FilaRankingNacional>): FilaRankingNacional => ({
  temporada: '2026-2027', arma: 'ESPADA', genero: 'M', categoria: 'ABS', categoriaRaw: 'ABS',
  puesto: 10, puntos: '100', clasificados: 200, ...p,
});

const fie = (p: Partial<EntradaRankingOficial>): EntradaRankingOficial => ({
  fuente: 'fie_tiradores', temporada: '2026', arma: 'ESPADA', genero: 'M',
  categoria: { codigo: 'ABS', raw: 'S' }, formato: 'INDIVIDUAL', puesto: 40, puntos: null,
  totalPublicado: null, fecha: { sourcePublishedOn: null, observedOn: '2026-09-30', baseLectura: true }, enlace: null, ...p,
});

describe('pastillas de ranking de la cabecera', () => {
  it('elige la categoría más alta de la temporada vigente, no el mejor puesto a secas', () => {
    const nacional = construirRankingNacional([
      filaNac({ categoria: 'M20', categoriaRaw: 'M20', puesto: 1 }),
      filaNac({ categoria: 'ABS', categoriaRaw: 'ABS', puesto: 12 }),
    ], '2026-2027');
    const chips = chipsRanking({
      nacional,
      mundial: [fie({ categoria: { codigo: 'M20', raw: 'J' }, puesto: 3 }), fie({ puesto: 80 })],
      resumenMundial: { vigente: '2026', mejores: [] },
    });
    expect(chips).toEqual([
      { ambito: 'internacional', organismo: 'FIE', puesto: 80, arma: 'ESPADA', categoria: 'ABS', temporada: '2026', actual: true },
      { ambito: 'nacional', organismo: 'RFEE', puesto: 12, arma: 'ESPADA', categoria: 'ABS', temporada: '2026-2027', actual: true },
    ]);
  });

  it('sin puesto en la vigente cae al mejor de su carrera, con la temporada', () => {
    const nacional = construirRankingNacional([
      filaNac({ temporada: '2019-2020', puesto: 4 }),
      filaNac({ temporada: '2021-2022', puesto: 9 }),
    ], '2026-2027');
    const chips = chipsRanking({
      nacional,
      mundial: [fie({ temporada: '2024', puesto: 30 })],
      resumenMundial: { vigente: '2026', mejores: [{ arma: 'ESPADA', genero: 'M', categoria: 'ABS', puesto: 22, temporada: '2023' }] },
    });
    expect(chips.map((c) => [c.ambito, c.puesto, c.temporada, c.actual])).toEqual([
      ['internacional', 22, '2023', false],
      ['nacional', 4, '2019-2020', false],
    ]);
  });

  it('sin rankings no hay pastillas', () => {
    expect(chipsRanking({})).toEqual([]);
  });
});

describe('temporada FIE de la persona', () => {
  it('el plan entra por las filas de la persona, no por todas las publicaciones FIE', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE sport_ranking_publication (id TEXT PRIMARY KEY, source TEXT, season TEXT, format TEXT);
      CREATE INDEX sport_ranking_publication_key ON sport_ranking_publication (source, season);
      CREATE TABLE sport_ranking_entry (id TEXT PRIMARY KEY, publication_id TEXT, person_id TEXT, position INTEGER);
      CREATE INDEX sport_ranking_entry_person_idx ON sport_ranking_entry (person_id);
    `);
    const consulta = sqlTemporadaMundial(['00000000-0000-4000-8000-000000000001']);
    const sqlTexto = (consulta as unknown as { queryChunks: unknown[] }).queryChunks
      .map((c) => (typeof c === 'object' && c && 'value' in c ? (c as { value: string[] }).value.join('') : '?'))
      .join('');
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sqlTexto.replace(/SELECT value FROM json_each\(\?\)/, "'x'")}`).all() as { detail: string }[];
    expect(plan[0].detail).toMatch(/sport_ranking_entry_person_idx/);
  });
});

const filaRival = (p: Partial<FilaRivalAmbito>): FilaRivalAmbito => ({
  rival: 'r1', nombre: 'RIVAL Uno', pais: 'ESP', prueba: 'p1', asaltos: 1, victorias: 1, derrotas: 0,
  equivalencia: null, fecha: '2025-01-10', arma: 'ESPADA', genero: 'M', categoria: 'ABS', formato: 'INDIVIDUAL',
  fuente: 'skermo_rfee', torneo: 'TORNEO NACIONAL', paisTorneo: 'ESP', ambitoEvento: null, circuitoEvento: null,
  fuenteEvento: null, ...p,
});

describe('rivales por ámbito', () => {
  it('separa nacional e internacional y ordena cada lista por su criterio', () => {
    const rows = [
      filaRival({ rival: 'a', nombre: 'A', prueba: 'n1', asaltos: 5, victorias: 4, derrotas: 1 }),
      filaRival({ rival: 'b', nombre: 'B', prueba: 'n1', asaltos: 3, victorias: 0, derrotas: 3 }),
      filaRival({ rival: 'b', nombre: 'B', prueba: 'i1', asaltos: 2, victorias: 0, derrotas: 2, fuente: 'fie', torneo: 'Coupe du monde', paisTorneo: 'FRA', fecha: '2025-03-01' }),
    ];
    const r = aRivalesPorAmbito(rows, new Map(), 'yo');
    expect(r.todos.rivales).toBe(2);
    expect(r.todos.masEnfrentados.map((x) => [x.id, x.asaltos])).toEqual([['a', 5], ['b', 5]]);
    expect(r.todos.aQuienMasGana.map((x) => x.id)).toEqual(['a']);
    expect(r.todos.quienMasLeGana.map((x) => [x.id, x.derrotas])).toEqual([['b', 5], ['a', 1]]);
    expect(r.internacional.rivales).toBe(1);
    expect(r.internacional.quienMasLeGana[0]).toMatchObject({ id: 'b', asaltos: 2, derrotas: 2 });
    expect(r.nacional.masEnfrentados.map((x) => [x.id, x.asaltos])).toEqual([['a', 5], ['b', 3]]);
  });

  it('dos lecturas de la misma prueba (misma equivalencia) cuentan una vez, como en el cara a cara', () => {
    const rows = [
      filaRival({ prueba: 'skermo', equivalencia: 'cal-1', asaltos: 2, victorias: 1, derrotas: 1 }),
      filaRival({ prueba: 'pdf', equivalencia: 'cal-1', asaltos: 2, victorias: 1, derrotas: 1, fuente: 'rfee_pdf' }),
    ];
    expect(pruebasDudosas(rows)).toEqual(['skermo', 'pdf']);
    const r = aRivalesPorAmbito(rows, new Map(), 'yo');
    expect(r.todos.masEnfrentados[0]).toMatchObject({ asaltos: 2, victorias: 1, derrotas: 1 });
  });

  it('pinta las tres secciones con el selector y enlaza al cara a cara', () => {
    const datos = aRivalesPorAmbito([
      filaRival({ rival: 'a', nombre: 'A', asaltos: 4, victorias: 3, derrotas: 1 }),
      filaRival({ rival: 'b', nombre: 'B', prueba: 'i', asaltos: 2, victorias: 0, derrotas: 2, fuente: 'fie', torneo: 'Coupe du monde', paisTorneo: 'FRA' }),
    ], new Map(), 'yo');
    const salida = html(React.createElement(RivalesPorAmbitoVista, { personaId: 'yo', datos, nivel: 'pagina' }));
    for (const t of ['Más enfrentados', 'A quién más gana', 'Quién más le gana', 'Todos', 'Nacional', 'Internacional']) {
      expect(salida).toContain(t);
    }
    expect(salida).toContain('cara-a-cara');
    expect(salida).toContain('3 victorias y 1 derrota');
    expect(html(React.createElement(RivalesPorAmbitoVista, { personaId: 'yo', datos: null, nivel: 'pagina' }))).toContain('No se han podido cargar');
  });
});

describe('carga diferida del perfil', () => {
  it('con diferirRivales no lanza las lecturas de rivales, sugeridos ni curiosidades', async () => {
    const sentencias: string[] = [];
    const db = {
      execute: async (q: unknown) => {
        const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
        sentencias.push(chunks.map((c) => (typeof c === 'object' && c && 'value' in c ? (c as { value: string[] }).value.join('') : '')).join(''));
        return { rows: [] };
      },
    };
    const filas = await leerFilasPerfil(db as never, ['00000000-0000-4000-8000-000000000001'], '00000000-0000-4000-8000-000000000001', { diferirRivales: true });
    expect(filas.rivales).toBeNull();
    expect(filas.sugeridos).toBeUndefined();
    expect(filas.rivalesStats).toBeUndefined();
    const conTodo = sentencias.length;
    sentencias.length = 0;
    await leerFilasPerfil(db as never, ['00000000-0000-4000-8000-000000000001'], '00000000-0000-4000-8000-000000000001');
    expect(sentencias.length).toBe(conTodo + 3);
  });
});

describe('tarjeta giratoria', () => {
  it('sólo la cara elegida está en el DOM, con un selector segmentado; con una sola cara no hay controles', () => {
    const caras = [
      { clave: 'general', rotulo: 'General', contenido: React.createElement('p', null, 'G') },
      { clave: 'internacional', rotulo: 'Internacional', contenido: React.createElement('p', null, 'I') },
      { clave: 'nacional', rotulo: 'Nacional', contenido: React.createElement('p', null, 'N') },
    ];
    const salida = html(React.createElement(TarjetaGiratoria, { caras, etiqueta: 'Cifras' }));
    expect(salida).toContain('data-cara="general"');
    expect(salida).not.toContain('data-cara="internacional"');
    expect(salida).not.toContain('>I</p>');
    expect(salida).toContain('role="radiogroup"');
    expect(salida).toContain('aria-checked="true"');
    expect(salida).toContain('sis-aparecer');
    expect(salida).not.toMatch(/rotateY|preserve-3d/);
    const nacional = html(React.createElement(TarjetaGiratoria, { caras, etiqueta: 'Cifras', inicial: 2 }));
    expect(nacional).toContain('data-cara="nacional"');
    expect(nacional).not.toContain('data-cara="general"');
    const una = html(React.createElement(TarjetaGiratoria, { caras: caras.slice(0, 1), etiqueta: 'Cifras' }));
    expect(una).not.toContain('<button');
  });
});

describe('vínculo estricto por nombre de las filas de PDF', () => {
  const ctx = '2018-2019|ESPADA|F|M17';
  const indice = indicePorNombre([
    { contexto: ctx, nombre: 'MARÍA TORRES FERNÁNDEZ', personId: 'maria', genero: 'F' },
    { contexto: ctx, nombre: 'LAURA GIL PEREZ', personId: 'laura-1', genero: 'F' },
    { contexto: ctx, nombre: 'GIL PEREZ Laura', personId: 'laura-2', genero: 'F' },
    { contexto: ctx, nombre: 'ANA RUIZ', personId: 'ana-chico', genero: 'M' },
    { contexto: '2018-2019|ESPADA|F|M20', nombre: 'SARA LOPEZ', personId: 'sara', genero: 'F' },
  ]);

  it('casa el nombre completo sin acentos ni orden, en el mismo contexto y con una sola candidata', () => {
    expect(claveNombre('TORRES FERNANDEZ, María')).toBe('fernandez maria torres');
    expect(vincularPorNombre(['TORRES FERNANDEZ MARIA'], ctx, indice)).toEqual(['maria']);
  });

  it('no vincula con dos candidatas, otra categoría, género contradictorio, nombre repetido o incompleto', () => {
    expect(vincularPorNombre(['GIL PEREZ LAURA'], ctx, indice)).toEqual([null]);
    expect(vincularPorNombre(['LOPEZ SARA'], ctx, indice)).toEqual([null]);
    expect(vincularPorNombre(['RUIZ ANA'], ctx, indice)).toEqual([null]);
    expect(vincularPorNombre(['TORRES FERNANDEZ MARIA', 'TORRES FERNANDEZ MARIA'], ctx, indice)).toEqual([null, null]);
    expect(vincularPorNombre(['TORRES'], ctx, indice)).toEqual([null]);
    expect(vincularPorNombre(['TORRES MARIA'], ctx, indice)).toEqual([null]);
  });
});

describe('filas de ranking en una línea', () => {
  it('nombre recortado con el completo en title, retrato, código de club y enlace a la ficha', () => {
    const salida = html(React.createElement('ol', null, React.createElement(FilaLinea, {
      puesto: 3, nombre: 'Lucía García de la Torre Fernández', personaId: '00000000-0000-4000-8000-000000000009',
      club: 'CNE-NA', puntos: 120.5, mio: true,
    })));
    expect(salida).toContain('title="Lucía García de la Torre Fernández"');
    expect(salida).toContain('truncate');
    expect(salida).toContain('/explorar/00000000-0000-4000-8000-000000000009');
    expect(salida).toContain('CNE-NA');
    expect(salida).toContain('Tú');
    // Fila de 40 px y 2 px más de área táctil por arriba y por abajo: 44 px.
    expect(salida).toContain('min-h-[40px]');
    expect(salida).toContain('after:-inset-y-[2px]');
    expect(salida).not.toMatch(/whitespace-normal|break-words/);
  });

  it('tus tiradores: puesto nacional e internacional en pastillas', () => {
    const salida = html(React.createElement(MisTiradores, {
      tiradores: [{
        athleteId: 'a1', nombre: 'Carlos', apellidos: 'Llavador', personaId: null,
        lados: [
          { federacion: 'RFEE', etiqueta: 'Nacional', mejor: { etiqueta: 'Florete absoluto', puesto: 2 } },
          { federacion: 'FIE', etiqueta: 'Internacional', mejor: { etiqueta: 'Florete absoluto', puesto: 15 } },
        ],
      }],
      elegida: 'FIE', onElegir: () => {},
    }));
    expect(salida).toContain('Nacional');
    expect(salida).toContain('Internacional');
    expect(salida).toMatch(/2(<!-- -->)?º/);
    expect(salida).toMatch(/15(<!-- -->)?º/);
    expect(salida).not.toMatch(/[Mm]undial/);
  });
});
