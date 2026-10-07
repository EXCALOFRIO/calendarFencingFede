import type { SQL } from 'drizzle-orm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { BotonFavorito } from '@/components/explorar/boton-favorito';
import { CLASES_TONO, EtiquetaTipoCompeticion, EtiquetasCompeticion } from '@/components/explorar/etiqueta-competicion';
import { AmbitoPerfil } from '@/components/explorar/perfil/ambito-perfil';
import { BalanceFasesRivales, CuriosidadesPerfil, fraseCuriosidad } from '@/components/explorar/perfil/curiosidades-perfil';
import { CabeceraInicio, EnlaceSiguiendo, EstadoSiguiendo, FeedSiguiendo } from '@/components/explorar/siguiendo';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';
import { leerEstadisticasRivales } from '@/lib/sport/explorar/rivales-stats';
import { cargarConteoSiguiendo, cargarSiguiendo } from '@/lib/sport/explorar/siguiendo-pantalla';
import { construirUrlSiguiendo, leerCriteriosSiguiendo } from '@/lib/sport/explorar/siguiendo-url';
import { leerEstadisticasAmbito } from '@/lib/sport/explorar/stats-ambito';
import { TIPOS_COMPETICION } from '@/lib/sport/explorar/tipo-competicion';
import type { TonoTipo } from '@/lib/sport/explorar/tipos-social';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { crearContexto, perfil } from './helpers/explorar';

/**
 * La capa visible de las lecturas sociales: pastillas, curiosidades, ámbito,
 * botón Seguir y el feed Siguiendo, renderizados sobre datos que salen de
 * ejecutar el SQL real en el esquema D1 (0000) en memoria.
 */

const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((c) => c()));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YO = uuid(1);
const RIVAL = uuid(3);
const OTRO = uuid(5);
const ESTRELLA = uuid(7);
const CUENTA = '00000000-0000-4000-8000-0000000000a1';

function fixture() {
  const local = localD1();
  cierres.push(() => local.close());
  const database = createD1Database(local.binding);
  const db = local.sqlite;
  let n = 0;
  const persona = (id: string, nombre: string) =>
    db.prepare('INSERT INTO sport_person(id, display_name, name_normalized, country_code) VALUES (?,?,?,?)')
      .run(id, nombre, nombre.toLowerCase(), 'ESP');
  const prueba = (id: string, o: { fuente?: string; nombre?: string; fecha?: string; categoria?: string } = {}) => {
    const fuente = o.fuente ?? 'fie';
    db.prepare('INSERT INTO sport_edition(id, source, season, tournament_key, name, start_date) VALUES (?,?,?,?,?,?)')
      .run(`ed-${id}`, fuente, '2026', id, o.nombre ?? 'Coupe du Monde', o.fecha ?? '2026-01-10');
    db.prepare(`INSERT INTO sport_competition(id, edition_id, source, season, competition_key, weapon, gender, category, format, competition_date)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, `ed-${id}`, fuente, '2026', id, 'ESPADA', 'M', o.categoria ?? 'ABS',
      'INDIVIDUAL', o.fecha ?? '2026-01-10');
  };
  const asalto = (competicion: string, a: string, b: string, sa: number, sb: number, fase: 'POULE' | 'TABLEAU' = 'POULE') => {
    n += 1;
    db.prepare(`INSERT INTO sport_bout(id, competition_id, source, phase, round_key, fencer_a_ref, fencer_b_ref,
      fencer_a_person_id, fencer_b_person_id, fencer_a_name, fencer_b_name, score_a, score_b, occurred_on, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`bout-${n}`, competicion, 'fie', fase, `r${n}`, `a-${n}`, `b-${n}`,
      a, b, 'A', 'B', sa, sb, null, `h${n}`);
  };
  const resultado = (competicion: string, personaId: string, puesto: number, fecha: string, fuente = 'fie') => {
    n += 1;
    db.prepare(`INSERT INTO sport_result(id, competition_id, source, source_fact_key, person_id, source_name, position, occurred_on, content_hash)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(`00000000-0000-4000-9000-${String(n).padStart(12, '0')}`, competicion, fuente,
      `f${n}`, personaId, 'X', puesto, fecha, `h${n}`);
  };
  const ranking = (personaId: string, puesto: number) => {
    db.prepare(`INSERT OR IGNORE INTO sport_ranking_publication(id, source, season, weapon, gender, category, category_raw, published_on)
      VALUES ('pub', 'fie_tiradores', '2026', 'ESPADA', 'M', 'ABS', 'S', '2026-06-01')`).run();
    db.prepare(`INSERT INTO sport_ranking_entry(publication_id, source_ref, person_id, country_code, position)
      VALUES ('pub', ?, ?, 'ESP', ?)`).run(`ref-${personaId}`, personaId, puesto);
  };
  db.prepare('INSERT INTO user_profile(id, email, full_name, ical_token) VALUES (?,?,?,?)')
    .run(CUENTA, 'cuenta@example.test', 'Cuenta sintética', 'token-cuenta');
  const seguir = (personaId: string, creado = 1000) =>
    db.prepare('INSERT INTO sport_favorite(profile_id, person_id, created_at) VALUES (?,?,?)').run(CUENTA, personaId, creado);

  function contexto(opciones: { sesion?: boolean; propia?: string } = {}): ContextoExplorador {
    const base = crearContexto({
      perfil: opciones.sesion === false ? null : perfil({ profileId: CUENTA }),
      ...(opciones.propia ? {
        propietario: {
          atletasDeCuenta: async () => [{ id: 'atleta-1', fieLicense: null, rfeeLicense: null }] as never,
          personasEnlazadas: async () => [{ athleteId: 'atleta-1', personId: opciones.propia! }] as never,
        },
      } : {}),
    }).ctx;
    return { ...base, db: { execute: (q: SQL) => database.execute(q) } as ContextoExplorador['db'] };
  }
  return { persona, prueba, asalto, resultado, ranking, seguir, contexto };
}

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

describe('pastillas de competición', () => {
  it('cada tono tiene clases literales de color de texto y de fondo', () => {
    const tonos: TonoTipo[] = ['gold', 'primary', 'org-fie', 'org-efc', 'org-rfee', 'org-aut', 'off'];
    for (const tono of tonos) {
      expect(CLASES_TONO[tono]).toMatch(/\btext-[a-z-]+\b/);
      expect(CLASES_TONO[tono]).toMatch(/\bbg-[a-z-]+\b/);
      expect(CLASES_TONO[tono]).not.toContain('${');
    }
    for (const c of Object.values(TIPOS_COMPETICION)) expect(CLASES_TONO[c.tono]).toBeTruthy();
  });

  it('enseña la forma corta con el nombre largo en el title, y la categoría legible', () => {
    const cm = { ...TIPOS_COMPETICION.CTO_MUNDO, tipo: 'CTO_MUNDO' as const };
    const corta = html(React.createElement(EtiquetasCompeticion, { clasificacion: cm, categoria: 'M20' }));
    expect(corta).toContain('data-tipo="CTO_MUNDO"');
    expect(corta).toContain('data-tono="primary"');
    expect(corta).toContain('>Mundial<');
    expect(corta).toContain(`title="${cm.etiqueta}"`);
    expect(corta).toMatch(/>M20</);
    const larga = html(React.createElement(EtiquetaTipoCompeticion, { clasificacion: cm, larga: true }));
    expect(larga).not.toContain('title=');
    expect(larga).toContain(cm.etiqueta);
  });
});

describe('curiosidades y fases en Rivales', () => {
  async function stats() {
    const f = fixture();
    f.persona(YO, 'GARCIA PEREZ Lucia'); f.persona(RIVAL, 'MARTIN RUIZ Ana'); f.persona(OTRO, 'LOPEZ SANZ Eva');
    f.prueba('p1');
    f.asalto('p1', YO, RIVAL, 5, 4);
    f.asalto('p1', RIVAL, YO, 5, 3);
    f.asalto('p1', YO, RIVAL, 5, 1);
    f.asalto('p1', YO, OTRO, 5, 2);
    f.asalto('p1', YO, RIVAL, 15, 14, 'TABLEAU');
    const r = await leerEstadisticasRivales(f.contexto(), { personaId: YO });
    if (r.estado !== 'ok') throw new Error(r.estado);
    return r.datos;
  }

  it('cada tarjeta lleva cifra con unidad, frase con el nombre visible y enlaces a la ficha y al cara a cara', async () => {
    const datos = await stats();
    expect(datos.curiosidades.length).toBeGreaterThan(0);
    const salida = html(React.createElement(CuriosidadesPerfil, { personaId: YO, stats: datos, nivel: 'pagina' }));
    expect(salida).toContain('id="ficha-curiosidades"');
    expect(salida).toContain(`href="/explorar/${RIVAL}"`);
    expect(salida).toContain(`/explorar/${YO}/cara-a-cara?rival=${RIVAL}`);
    expect(salida).toContain(`aria-label="Cara a cara con ${nombreVisible('MARTIN RUIZ Ana')}"`);
    for (const c of datos.curiosidades) {
      expect(salida).toContain(`data-curiosidad="${c.clave}"`);
      expect(fraseCuriosidad(c)).not.toContain('MARTIN RUIZ');
      expect(fraseCuriosidad(c)).not.toMatch(/\d-\d/);
    }
    expect(salida).toContain('<h3');
  });

  it('sin curiosidades no pinta nada', async () => {
    const datos = await stats();
    expect(html(React.createElement(CuriosidadesPerfil, { personaId: YO, stats: { ...datos, curiosidades: [] }, nivel: 'pagina' }))).toBe('');
  });

  it('separa poule y eliminación directa y cuenta la sangre fría', async () => {
    const datos = await stats();
    expect(datos.poule).toMatchObject({ asaltos: 4, victorias: 3, derrotas: 1 });
    expect(datos.eliminacion).toMatchObject({ asaltos: 1, victorias: 1 });
    const salida = html(React.createElement(BalanceFasesRivales, { stats: datos, nivel: 'pagina' }));
    expect(salida).toContain('Poule');
    expect(salida).toContain('3–1');
    expect(salida).toContain('Eliminación directa');
    expect(salida).toContain('Sangre fría');
    expect(salida).toContain('Ganados 2 de 2 asaltos decididos por un tocado');
    const vacio = {
      ...datos,
      eliminacion: { ...datos.eliminacion, asaltos: 0, victorias: 0, derrotas: 0, porcentajeVictorias: null },
      sangreFria: { asaltos: 0, victorias: 0, porcentaje: null },
    };
    const sin = html(React.createElement(BalanceFasesRivales, { stats: vacio, nivel: 'pagina' }));
    expect(sin).toContain('Sin asaltos importados');
    expect(sin).toContain('Ningún asalto decidido por un tocado');
  });
});

describe('Internacional y nacional', () => {
  it('una tarjeta por ámbito y el reparto por tipo de competición', async () => {
    const f = fixture();
    f.persona(YO, 'YO');
    f.prueba('cm', { nombre: 'Coupe du Monde', fecha: '2026-01-10' });
    f.prueba('tnr', { fuente: 'rfee_pdf', nombre: 'TNR Absoluto Madrid', fecha: '2026-02-10' });
    f.resultado('cm', YO, 3, '2026-01-10');
    f.resultado('tnr', YO, 1, '2026-02-10', 'rfee_pdf');
    const r = await leerEstadisticasAmbito(f.contexto(), { personaId: YO });
    if (r.estado !== 'ok') throw new Error(r.estado);
    const salida = html(React.createElement(AmbitoPerfil, { ambito: r.datos, nivel: 'pagina' }));
    expect(salida).toContain('id="ficha-ambito"');
    for (const clave of ['internacional', 'nacional']) expect(salida).toContain(`data-ambito="${clave}"`);
    expect(salida).not.toContain('type="radio"');
    expect(salida).toContain('data-tipo="COPA_MUNDO"');
    expect(salida).toContain('data-tipo="TNR"');
    const vacio = { ...r.datos, total: { ...r.datos.total, competiciones: 0 } };
    expect(html(React.createElement(AmbitoPerfil, { ambito: vacio, nivel: 'pagina' }))).toBe('');
  });
});

describe('botón Seguir', () => {
  it('en la cabecera dice Seguir o Siguiendo, con el nombre para lectores y sin aria-pressed', () => {
    const lectura = {};
    const seguir = html(React.createElement(BotonFavorito, { personaId: YO, nombre: 'Lucía García', inicial: false, lectura, variante: 'perfil' }));
    expect(seguir).toContain('Seguir');
    expect(seguir).not.toContain('Siguiendo');
    expect(seguir).toContain('Lucía García');
    expect(seguir).not.toContain('aria-pressed');
    const siguiendo = html(React.createElement(BotonFavorito, { personaId: YO, nombre: 'Lucía García', inicial: true, lectura, variante: 'perfil' }));
    expect(siguiendo).toContain('Siguiendo');
    const estrella = html(React.createElement(BotonFavorito, { personaId: YO, nombre: 'Lucía García', inicial: true, lectura }));
    expect(estrella).toContain('aria-pressed="true"');
  });
});

describe('URL de Siguiendo', () => {
  it('sólo cursor y filtro de medallas', () => {
    expect(construirUrlSiguiendo()).toBe('/explorar/siguiendo');
    expect(construirUrlSiguiendo({ soloMedallas: true, cursor: 'abc' })).toBe('/explorar/siguiendo?medallas=1&cursor=abc');
    expect(leerCriteriosSiguiendo({ medallas: ['1', '0'], cursor: '  c  ', cuenta: 'otra' })).toEqual({ cursor: 'c', soloMedallas: true });
    expect(leerCriteriosSiguiendo({ medallas: 'si' })).toEqual({ cursor: '', soloMedallas: false });
  });
});

describe('pantalla Siguiendo', () => {
  it('con seguidas: tarjetas con persona, prueba y pastillas, y «Ver más» con el cursor', async () => {
    const f = fixture();
    f.persona(RIVAL, 'MARTIN RUIZ Ana');
    for (let i = 1; i <= 3; i++) {
      f.prueba(`p${i}`, { fecha: `2026-0${i}-15` });
      f.resultado(`p${i}`, RIVAL, i, `2026-0${i}-15`);
    }
    f.seguir(RIVAL);
    const ctx = f.contexto();
    expect(await cargarConteoSiguiendo(ctx)).toBe(1);
    const vista = await cargarSiguiendo(ctx, {});
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.items.map((e) => e.prueba.id)).toEqual(['p3', 'p2', 'p1']);
    expect(vista.sugeridos).toBeUndefined();
    const criterios = { cursor: '', soloMedallas: false };
    const salida = html(React.createElement(FeedSiguiendo, { items: vista.items, siguiente: 'CUR', criterios }));
    expect(salida).toContain(`href="/explorar/${RIVAL}"`);
    // El feed es Inicio: la página siguiente es `/explorar?cursor=…`, no la lista de Siguiendo.
    expect(salida).toContain('href="/explorar?cursor=CUR"');
    expect(salida).toContain('Ver más');
    expect(salida).toContain('data-tipo="COPA_MUNDO"');
    // Cada tarjeta lleva el retrato de la persona.
    expect(salida.match(/data-slot="avatar"/g)?.length).toBe(3);
    expect(salida).not.toMatch(/club/i);
    const fin = html(React.createElement(FeedSiguiendo, { items: vista.items, siguiente: null, criterios: { cursor: 'X', soloMedallas: true } }));
    expect(fin).not.toContain('Ver más');
    expect(fin).toContain('href="/explorar?medallas=1"');
    const cabecera = html(React.createElement(CabeceraInicio, { criterios }));
    // El título («Explorar») va en la cabecera compacta de la aplicación, no aquí.
    expect(cabecera).not.toContain('<h1');
    expect(cabecera).toMatch(/<a(?=[^>]*href="\/explorar")(?=[^>]*aria-current="page")/);
    expect(cabecera).toContain('href="/explorar?medallas=1"');
    expect(html(React.createElement(EnlaceSiguiendo, { siguiendo: 1 }))).toContain('href="/explorar/siguiendo"');
    expect(html(React.createElement(EnlaceSiguiendo, { siguiendo: null }))).not.toMatch(/cifra/);
  });

  it('sin seguidas ni ficha propia: propone a los mejor clasificados del ranking que aún no sigue', async () => {
    const f = fixture();
    f.persona(ESTRELLA, 'ESTRELLA Uno'); f.persona(OTRO, 'OTRO Dos');
    f.ranking(ESTRELLA, 1); f.ranking(OTRO, 4);
    const vista = await cargarSiguiendo(f.contexto(), {});
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.sinResultados).toBe(true);
    expect(vista.sugeridos?.map((s) => [s.id, s.motivo])).toEqual([
      [ESTRELLA, '1º internacional'],
      [OTRO, '4º internacional'],
    ]);
    const salida = html(React.createElement(EstadoSiguiendo, { vista, criterios: { cursor: '', soloMedallas: false }, siguiendo: 0 }));
    expect(salida).toContain('Aún no sigues a nadie');
    expect(salida).toContain('>Sugerencias<');
    expect(salida).toContain(`href="/explorar/${ESTRELLA}"`);
    expect(salida).toContain('Seguir');
  });

  it('seguir a alguien sin resultados: no se le vuelve a proponer', async () => {
    const f = fixture();
    f.persona(ESTRELLA, 'ESTRELLA Uno'); f.persona(OTRO, 'OTRO Dos');
    f.ranking(ESTRELLA, 1); f.ranking(OTRO, 4);
    f.seguir(ESTRELLA);
    const vista = await cargarSiguiendo(f.contexto(), {});
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.sugeridos?.map((s) => s.id)).toEqual([OTRO]);
    const salida = html(React.createElement(EstadoSiguiendo, { vista, criterios: { cursor: '', soloMedallas: false }, siguiendo: 1 }));
    expect(salida).toContain('Sin resultados');
    expect(salida).not.toContain('Aún no sigues a nadie');
  });

  it('con ficha propia confirmada: propone a sus rivales', async () => {
    const f = fixture();
    f.persona(YO, 'YO Propia'); f.persona(RIVAL, 'MARTIN RUIZ Ana'); f.persona(ESTRELLA, 'ESTRELLA Uno');
    f.ranking(ESTRELLA, 1);
    f.prueba('p1');
    f.asalto('p1', YO, RIVAL, 5, 3);
    f.asalto('p1', RIVAL, YO, 5, 2);
    const vista = await cargarSiguiendo(f.contexto({ propia: YO }), {});
    if (vista.tipo !== 'ok') throw new Error(vista.tipo);
    expect(vista.sugeridos?.map((s) => s.id)).toContain(RIVAL);
    expect(vista.sugeridos?.map((s) => s.id)).not.toContain(YO);
    expect(vista.sugeridos?.map((s) => s.id)).not.toContain(ESTRELLA);
  });

  it('estados distintos para sesión, cursor inválido y fallo', async () => {
    const f = fixture();
    expect(await cargarSiguiendo(f.contexto({ sesion: false }), {})).toEqual({ tipo: 'sin_sesion' });
    expect(await cargarConteoSiguiendo(f.contexto({ sesion: false }))).toBeNull();
    expect(await cargarSiguiendo(f.contexto(), { cursor: 'no-es-un-cursor' })).toEqual({ tipo: 'cursor_invalido' });
    const roto = { ...f.contexto(), db: { execute: async () => { throw new Error('D1_ERROR'); } } as unknown as ContextoExplorador['db'] };
    expect(await cargarSiguiendo(roto, {})).toEqual({ tipo: 'error' });
    const criterios = { cursor: '', soloMedallas: false };
    expect(html(React.createElement(EstadoSiguiendo, { vista: { tipo: 'cursor_invalido' }, criterios, siguiendo: 1 })))
      .toContain('Página caducada');
    expect(html(React.createElement(EstadoSiguiendo, { vista: { tipo: 'error' }, criterios, siguiendo: 1 })))
      .toContain('role="alert"');
    expect(html(React.createElement(EstadoSiguiendo, { vista: { tipo: 'no_disponible' }, criterios, siguiendo: null })))
      .toContain('Siguiendo aún no está activo');
  });
});
