import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { createD1Database } from '@/db/d1/runtime';
import { localD1 } from '@/db/d1/testing';
import { normalizeSportName as normalizarNombre } from '@/lib/identity/resolver';
import { crearGuardDb } from '@/lib/sport/id-guard-db';
import type { IdExternoCandidato } from '@/lib/sport/id-guard';
import { buscarDeportistas, complementos } from '@/lib/sport/explorar/busqueda';
import { listarRivales, leerCaraACara } from '@/lib/sport/explorar/cara-a-cara';
import { leerEdicion, leerSeries } from '@/lib/sport/explorar/ediciones';
import { guardarFavorito, quitarFavorito, listarFavoritos } from '@/lib/sport/explorar/favoritos';
import { listaUuid, plegarSql } from '@/lib/sport/explorar/filtros-sql';
import { resolverPersona } from '@/lib/sport/explorar/personas';
import { sugerirPersonas, sqlCandidatosSugerencias } from '@/lib/sport/explorar/sugerencias';
import { leerRankingOficial, leerRankingOficialDePersonas } from '@/lib/sport/ranking-oficial-db';
import { crearContexto, perfil, UUID_A as A, UUID_B as B, UUID_C as C, CLAVES_PRIVADAS, clavesDe } from './helpers/explorar';

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: () => { throw new Error('El test no puede acceder a Cloudflare'); },
}));

const D = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const CUENTA = perfil().profileId;
const OTRA = '00000000-0000-4000-8000-0000000000b2';
const EDICION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRUEBA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const cierres: (() => void)[] = [];
afterEach(() => cierres.splice(0).forEach((cerrar) => cerrar()));

function entorno() {
  const local = localD1();
  cierres.push(local.close);
  const db = createD1Database(local.binding);
  const ctx = { ...crearContexto().ctx, db };
  const s = local.sqlite;
  for (const id of [CUENTA, OTRA]) {
    s.prepare('INSERT INTO user_profile (id,email,full_name,ical_token) VALUES (?,?,?,?)')
      .run(id, `${id}@example.test`, 'Cuenta sintética', id);
  }
  function persona(id: string, nombre: string, destino: string | null = null, pais = 'ESP') {
    s.prepare(`INSERT INTO sport_person (id,display_name,name_normalized,merged_into_person_id,country_code,gender,birth_year)
      VALUES (?,?,?,?,?,'M',1998)`).run(id, nombre, normalizarNombre(nombre), destino, pais);
  }
  function alias(id: string, nombre: string) {
    s.prepare('INSERT INTO sport_person_alias (person_id,source,name_original,name_normalized) VALUES (?,?,?,?)')
      .run(id, 'sintetica', nombre, normalizarNombre(nombre));
  }
  function prueba(formato = 'INDIVIDUAL') {
    s.prepare(`INSERT INTO sport_edition (id,source,season,tournament_key,name,start_date)
      VALUES (?,'fie','2026',?,'CAMPEONATO OLÍMPICO DE CÓRDOBA','2026-05-03')`).run(EDICION, EDICION);
    s.prepare(`INSERT INTO sport_competition (id,edition_id,source,season,competition_key,weapon,gender,category,category_raw,format,competition_date)
      VALUES (?,?,'fie','2026',?,'ESPADA','M','ABS','Senior',?,'2026-05-03')`).run(PRUEBA, EDICION, PRUEBA, formato);
  }
  function resultado(id: string, personaId: string, fuente = 'fie', puesto: number | null = 1) {
    s.prepare(`INSERT INTO sport_result (id,competition_id,source,source_fact_key,person_id,source_name,source_country_code,position,content_hash)
      VALUES (?,?,?,?,?,'Nombre publicado','ESP',?,'hash')`).run(id, PRUEBA, fuente, id, personaId, puesto);
  }
  function favorito(personaId: string, fecha: number, cuenta = CUENTA) {
    s.prepare('INSERT INTO sport_favorite VALUES (?,?,?)').run(cuenta, personaId, fecha);
  }
  function publicacion(id: string, dia: string, fuente = 'fie', formato = 'INDIVIDUAL', temporada = '2026') {
    s.prepare(`INSERT INTO sport_ranking_publication (id,source,season,weapon,gender,category,category_raw,format,published_on,published_total)
      VALUES (?,?,?,'ESPADA','M','ABS','Senior',?,?,3)`).run(id, fuente, temporada, formato, dia);
  }
  function entrada(publicacionId: string, personaId: string, ref: string, puesto: number | null = 1) {
    s.prepare(`INSERT INTO sport_ranking_entry (publication_id,person_id,source_ref,source_name,country_code,position,points)
      VALUES (?,?,?,'Nombre publicado','ESP',?,'123456789012345.000001')`).run(publicacionId, personaId, ref, puesto);
  }
  return { ...local, db, ctx, persona, alias, prueba, resultado, favorito, publicacion, entrada };
}

describe('SQL deportivo nativo, con esquema D1 real y SQLite efímero', () => {
  it('plegado Unicode, signos y grupos de más de 100 IDs se ejecutan sin truncar ni interpolar', async () => {
    const t = entorno();
    const plegado = await t.db.execute(sql`SELECT ${plegarSql(sql`'ÁÉÍÓÚ Ñ Ç-Med'`)} AS texto`);
    expect(plegado.rows).toEqual([{ texto: 'aeiou n c med' }]);
    const ids = Array.from({ length: 240 }, (_, n) => `id-${n}`);
    const lectura = await t.db.execute(sql`SELECT value FROM json_each(${JSON.stringify(ids)}) WHERE value IN (${listaUuid(ids)})`);
    expect(lectura.rows).toHaveLength(240);
    expect(t.calls.at(-1)?.parameters).toBe(2);
    const peligro = "'; DROP TABLE sport_person;--";
    expect((await t.db.execute(sql`SELECT ${peligro} AS valor WHERE ${peligro} IN (${listaUuid([peligro])})`)).rows)
      .toEqual([{ valor: peligro }]);
  });

  it('resuelve tres saltos, rechaza ciclos y conserva alias/hechos nacionales e internacionales del grupo', async () => {
    const t = entorno();
    t.persona(C, 'Carlos Llavador Fernández');
    t.persona(B, 'Llavador Carlos', C);
    t.persona(A, 'Carlos Llavador', B);
    t.alias(A, 'Llavador Carlos');
    t.prueba();
    t.resultado(D, A);
    t.publicacion('pub-nacional', '2026-06-01', 'skermo_ranking');
    t.entrada('pub-nacional', B, 'nacional');
    expect(await resolverPersona(t.db, A)).toEqual({ canonicaId: C, ids: [C, B, A] });
    const r = await buscarDeportistas(t.ctx, { q: 'llavador carlos', temporada: '2026', arma: 'ESPADA', nacionalidad: 'ESP' });
    expect(r.estado).toBe('ok');
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: C, resultadosImportados: 1, armas: ['ESPADA'] });
    expect((await complementos(t.db, [C], [normalizarNombre('Carlos Llavador Fernández')])).conteos[0].resultados).toBe(1);
    t.sqlite.prepare('UPDATE sport_person SET merged_into_person_id = ? WHERE id = ?').run(A, C);
    expect(await resolverPersona(t.db, A)).toBeNull();
  });

  it('torneo/fecha/ámbito requieren un resultado coincidente; un ranking no fabrica participación', async () => {
    const t = entorno();
    t.persona(A, 'Carlos Llavador');
    t.persona(B, 'Carlos Otro');
    t.prueba();
    t.resultado(C, A);
    t.publicacion('oficial', '2026-06-01');
    t.entrada('oficial', B, 'solo-ranking');
    const sinTorneo = await buscarDeportistas(t.ctx, { temporada: '2026', arma: 'ESPADA' });
    if (sinTorneo.estado !== 'ok') throw new Error(sinTorneo.estado);
    expect(sinTorneo.items.map((p) => p.id).sort()).toEqual([A, B]);
    const conTorneo = await buscarDeportistas(t.ctx, {
      torneo: 'olimpico de cordoba', desde: '2026-05-03', hasta: '2026-05-03', ambito: 'INTERNACIONAL',
    });
    if (conTorneo.estado !== 'ok') throw new Error(conTorneo.estado);
    expect(conTorneo.items.map((p) => p.id)).toEqual([A]);
  });

  it('sugerencias con acentos, erratas, orden inverso, alias y homónimos se ejecutan y sólo devuelven DTO público', async () => {
    const t = entorno();
    t.persona(C, 'Carlos Llavador Fernández');
    t.persona(A, 'Carlos Llavador', C);
    t.alias(A, 'CARLOS YAVADOR');
    t.persona(B, 'Carlos Llavador Fernández', null, 'FRA');
    t.sqlite.prepare('UPDATE sport_person SET birth_year = 2001 WHERE id = ?').run(B);
    for (const q of ['LLÁVADOR Cárlos', 'carlos llavdor', 'yavador carlos']) {
      const r = await sugerirPersonas(t.ctx, { q });
      if (r.estado !== 'ok') throw new Error(r.estado);
      expect(r.items.map((p) => p.id)).toContain(C);
      expect(r.items.map((p) => p.id)).not.toContain(A);
      expect(CLAVES_PRIVADAS.filter((k) => clavesDe(r).has(k))).toEqual([]);
    }
    const homonimos = await sugerirPersonas(t.ctx, { q: 'carlos llavador' });
    if (homonimos.estado !== 'ok') throw new Error(homonimos.estado);
    expect(homonimos.items).toHaveLength(2);
    expect(homonimos.items.map((p) => [p.pais, p.anioNacimiento])).toEqual([['FRA', 2001], ['ESP', 1998]]);
    const consulta = new SQLiteSyncDialect().sqlToQuery(sqlCandidatosSugerencias('carlos llavador fernandez'));
    const planes = t.sqlite.prepare(`EXPLAIN QUERY PLAN ${consulta.sql}`).all(...consulta.params as never[]);
    expect(planes.filter((p) => String(p.detail).includes('sport_person_name_idx')).length).toBeGreaterThan(0);
    expect(planes.filter((p) => String(p.detail).includes('sport_person_alias_name_idx')).length).toBeGreaterThan(0);
    expect(planes.some((p) => String(p.detail).includes('RIGHT PART OF ORDER BY'))).toBe(false);
    expect(t.calls.every((c) => c.parameters <= 100)).toBe(true);
  });

  it('acota lecturas de candidatos a 216, resultados a ocho y no consulta por texto corto o inválido', async () => {
    const t = entorno();
    for (let n = 0; n < 240; n++) t.persona(`candidato-${n}`, `Carlos Garcia Z${n}`);
    const raw = await t.db.execute(sqlCandidatosSugerencias('carlos garcia fernandez lopez'));
    expect(raw.rows.length).toBeLessThanOrEqual(216);
    expect(t.calls.at(-1)?.parameters).toBe(50);
    const r = await sugerirPersonas(t.ctx, { q: 'carlos' });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.items).toHaveLength(8);
    const antes = t.calls.length;
    expect(await sugerirPersonas(t.ctx, { q: 'a b' })).toEqual({ estado: 'ok', items: [] });
    expect(await sugerirPersonas(t.ctx, { q: 'x'.repeat(81) })).toEqual({ estado: 'entrada_invalida' });
    expect(t.calls).toHaveLength(antes);
  });

  it('ranking oficial conserva decimales TEXT, orden, temporada, modalidad, fuente y la última publicación antes de buscar personas', async () => {
    const t = entorno();
    t.persona(A, 'Carlos Llavador');
    t.persona(B, 'Otro Tirador');
    t.publicacion('vieja', '2026-05-01');
    t.publicacion('nueva', '2026-06-01');
    t.publicacion('equipos', '2026-07-01', 'fie', 'EQUIPOS');
    t.publicacion('otro-anio', '2027-01-01', 'fie', 'INDIVIDUAL', '2027');
    t.publicacion('nacional', '2026-05-01', 'skermo_ranking');
    t.entrada('vieja', A, 'vieja');
    t.entrada('nueva', B, 'segunda', 2);
    t.entrada('nueva', B, 'sin-puesto', null);
    t.entrada('nueva', B, 'primera', 1);
    t.entrada('equipos', A, 'equipo');
    t.entrada('otro-anio', A, '2027');
    t.entrada('nacional', A, 'nacional');
    const filtro = { source: 'fie', season: '2026', weapon: 'ESPADA', gender: 'M' };
    const r = await leerRankingOficial(t.db, filtro);
    expect(r?.publicacion.id).toBe('nueva');
    expect(r?.filas.map((f) => f.sourceRef)).toEqual(['primera', 'segunda', 'sin-puesto']);
    expect(r?.filas[0].points).toBe('123456789012345.000001');
    expect((await leerRankingOficial(t.db, filtro, { limite: 1, desde: 1 }))?.filas[0].sourceRef).toBe('segunda');
    expect((await leerRankingOficial(t.db, { ...filtro, hasta: '2026-05-10' }))?.publicacion.id).toBe('vieja');
    const ids = Array.from({ length: 220 }, (_, n) => n === 219 ? A : `ausente-${n}`);
    const propias = await leerRankingOficialDePersonas(t.db, ids, '2026', 'INDIVIDUAL');
    expect(propias.map((p) => p.publicacion.id)).toEqual(['nacional']);
    expect(t.calls.at(-1)?.parameters).toBe(3);
  });

  it('edición selecciona UNA fuente de clasificación y pagina puestos nulos sin mezclar otras lecturas', async () => {
    const t = entorno();
    t.persona(A, 'Carlos Llavador');
    t.prueba();
    t.resultado(B, A, 'fie', 1);
    t.resultado(C, A, 'fie', null);
    t.resultado(D, A, 'skermo', 2);
    const r = await leerEdicion(t.ctx, { edicionId: EDICION, prueba: PRUEBA, limite: 1 });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.edicion.clasificacion?.fuente).toBe('fie');
    expect(r.edicion.clasificacion?.filas.map((f) => f.id)).toEqual([B]);
    expect(r.edicion.clasificacion?.otrasFuentes).toEqual([{ fuente: 'skermo', filas: 1 }]);
    const siguiente = await leerEdicion(t.ctx, {
      edicionId: EDICION, prueba: PRUEBA, limite: 1, cursor: r.edicion.clasificacion!.siguiente!,
    });
    if (siguiente.estado !== 'ok') throw new Error(siguiente.estado);
    expect(siguiente.edicion.clasificacion?.filas.map((f) => f.id)).toEqual([C]);
    expect((await leerSeries(t.ctx)).estado).toBe('ok');
  });

  it('cara a cara orienta el marcador, excluye empates del listado y agrupa rivales a través de tres fusiones', async () => {
    const t = entorno();
    t.persona(A, 'Carlos Llavador');
    t.persona(E, 'Mateo Rival');
    t.persona(D, 'Mateo Intermedio', E);
    t.persona(C, 'Mateo Fundido', D);
    t.persona(B, 'Mateo Antiguo', C);
    t.prueba();
    const insertar = t.sqlite.prepare(`INSERT INTO sport_bout
      (id,competition_id,source,phase,round_key,fencer_a_ref,fencer_b_ref,fencer_a_person_id,fencer_b_person_id,
      fencer_a_name,fencer_b_name,score_a,score_b,content_hash)
      VALUES (?,?,'fie','TABLEAU',?,'a','b',?,?,'A','B',?,?,'hash')`);
    insertar.run('asalto-1', PRUEBA, 'T16', A, B, 15, 10);
    insertar.run('asalto-2', PRUEBA, 'T8', B, A, 15, 8);
    insertar.run('asalto-3', PRUEBA, 'T4', A, B, 5, 5);
    const r = await leerCaraACara(t.ctx, { personaId: A, rivalId: B });
    if (r.estado !== 'ok') throw new Error(r.estado);
    expect(r.personas.rival.id).toBe(E);
    expect(r.resumen).toEqual({ asaltos: 3, victorias: 1, derrotas: 1, sinDecidir: 1, tantosFavor: 28, tantosContra: 30 });
    expect(r.items).toHaveLength(2);
    expect(r.cobertura.estado).toBe('parcial');
    const rivales = await listarRivales(t.ctx, { personaId: A, q: 'mateo' });
    if (rivales.estado !== 'ok') throw new Error(rivales.estado);
    expect(rivales.items).toEqual([{ id: E, nombre: 'Mateo Rival', pais: 'ESP', asaltos: 3 }]);
  });
});

describe('favoritos: batch D1 real, fechas en ms y carreras', () => {
  function preparado() {
    const t = entorno();
    t.persona(B, 'Carlos Llavador');
    t.persona(A, 'Carlos Antiguo', B);
    t.persona(C, 'Otro Tirador');
    t.favorito(B, 1_750_000_000_100);
    t.favorito(C, 1_750_000_000_200);
    t.favorito(A, 1_750_000_000_300);
    t.favorito(A, 1_750_000_000_400, OTRA);
    return t;
  }

  it('hereda la fecha efectiva, retira fundidas atómicamente y conserva cursores/otra cuenta', async () => {
    const t = preparado();
    const antes = await listarFavoritos(t.ctx, { limite: 1 });
    if (antes.estado !== 'ok') throw new Error(antes.estado);
    expect(antes.items[0].id).toBe(B);
    await guardarFavorito(t.ctx, { personaId: A });
    expect(t.sqlite.prepare('SELECT person_id,created_at FROM sport_favorite WHERE profile_id = ? ORDER BY person_id').all(CUENTA))
      .toEqual([{ person_id: B, created_at: 1_750_000_000_300 }, { person_id: C, created_at: 1_750_000_000_200 }]);
    const despues = await listarFavoritos(t.ctx, { limite: 1 });
    if (despues.estado !== 'ok') throw new Error(despues.estado);
    expect(despues.items[0].guardadoEl).toBe(antes.items[0].guardadoEl);
    const resto = await listarFavoritos(t.ctx, { limite: 1, cursor: antes.siguiente! });
    if (resto.estado !== 'ok') throw new Error(resto.estado);
    expect(resto.items.map((f) => f.id)).toEqual([C]);
    await guardarFavorito(t.ctx, { personaId: B });
    expect(t.sqlite.prepare('SELECT created_at FROM sport_favorite WHERE profile_id = ? AND person_id = ?').get(CUENTA, B)?.created_at)
      .toBe(1_750_000_000_300);
    await quitarFavorito(t.ctx, { personaId: A });
    expect(t.sqlite.prepare('SELECT person_id FROM sport_favorite WHERE profile_id = ?').all(CUENTA)).toEqual([{ person_id: C }]);
    expect(t.sqlite.prepare('SELECT person_id FROM sport_favorite WHERE profile_id = ?').all(OTRA)).toEqual([{ person_id: A }]);
  });

  it('el fallo del segundo paso revierte la fecha canónica: no deja una consolidación parcial', async () => {
    const t = preparado();
    t.sqlite.exec(`CREATE TEMP TRIGGER fallo BEFORE DELETE ON sport_favorite
      WHEN OLD.profile_id = '${CUENTA}' BEGIN SELECT RAISE(ABORT, 'FALLO_SINTETICO'); END`);
    await expect(guardarFavorito(t.ctx, { personaId: A })).rejects.toThrow('FALLO_SINTETICO');
    expect(t.sqlite.prepare('SELECT created_at FROM sport_favorite WHERE profile_id = ? AND person_id = ?').get(CUENTA, B)?.created_at)
      .toBe(1_750_000_000_100);
    expect(t.sqlite.prepare('SELECT count(*) AS n FROM sport_favorite WHERE profile_id = ?').get(CUENTA)?.n).toBe(3);
  });

  it('guardar/quitar concurrentes son linealizables y no dejan un miembro resucitado', async () => {
    for (const quitarPrimero of [true, false]) {
      const t = preparado();
      const acciones = quitarPrimero
        ? [quitarFavorito(t.ctx, { personaId: A }), guardarFavorito(t.ctx, { personaId: B })]
        : [guardarFavorito(t.ctx, { personaId: A }), quitarFavorito(t.ctx, { personaId: B })];
      await Promise.all(acciones);
      const escrituras = t.calls.filter((c) => /^\s*(INSERT|DELETE)/i.test(c.sql));
      const ultima = escrituras.at(-1)!;
      const n = Number(t.sqlite.prepare('SELECT count(*) AS n FROM sport_favorite WHERE profile_id = ? AND person_id IN (?,?)')
        .get(CUENTA, A, B)?.n);
      // El DELETE de consolidación va inmediatamente detrás de su INSERT:
      // si es la última escritura ganó guardar; si no, ganó quitar.
      expect(n).toBe(ultima.sql.includes('INSERT') || ultima.sql.includes('json_each') && escrituras.at(-2)?.sql.includes('INSERT') ? 1 : 0);
      expect(t.sqlite.prepare('SELECT 1 FROM sport_favorite WHERE profile_id = ? AND person_id = ?').get(CUENTA, A)).toBeUndefined();
    }
  });
});

describe('confirmación de identidad: CAS y batch, sin cerrojos PostgreSQL', () => {
  const candidato = (personId: string, cambios: Partial<IdExternoCandidato> = {}): IdExternoCandidato => ({
    personId, scheme: 'fie_license', value: '12345', scopeSource: 'fie', scopeFederation: '',
    scopeSeason: '', scopeWeapon: '', validFrom: '2025-01-01', validTo: null,
    linkedVia: 'sintetica', evidence: '{}', ...cambios,
  });

  it('dos confirmaciones concurrentes con inicios distintos no confirman dos personas', async () => {
    const t = entorno();
    t.persona(A, 'Carlos Llavador');
    t.persona(B, 'Carlos Homónimo');
    const guard = crearGuardDb(t.db);
    const r = await Promise.all([
      guard.confirmar(candidato(A)),
      guard.confirmar(candidato(B, { validFrom: '2026-01-01' })),
    ]);
    expect(r).toEqual([true, false]);
    expect(t.sqlite.prepare("SELECT person_id FROM sport_external_id WHERE link_status = 'CONFIRMADO'").all()).toEqual([{ person_id: A }]);
    expect((await guard.conflictos(candidato(B)))[0].personId).toBe(A);
    expect(t.calls.every((c) => c.parameters <= 100)).toBe(true);
  });

  it('comodines y extremos inclusivos bloquean; periodos no solapados o ámbitos distintos se permiten', async () => {
    const t = entorno();
    t.persona(A, 'Primero');
    t.persona(B, 'Segundo');
    const guard = crearGuardDb(t.db);
    expect(await guard.confirmar(candidato(A, { validTo: '2025-12-31', scopeWeapon: 'ESPADA' }))).toBe(true);
    expect(await guard.confirmar(candidato(B, { validFrom: '2025-12-31' }))).toBe(false);
    expect(await guard.confirmar(candidato(B, { validFrom: '2026-01-01' }))).toBe(true);
    expect(await guard.confirmar(candidato(B, { scopeWeapon: 'SABLE', validTo: '2025-12-30' }))).toBe(true);
  });

  it('reutiliza un ID propio de un miembro fundido sin violar la clave confirmada global; una ampliación conflictiva no lo cambia', async () => {
    const t = entorno();
    t.persona(B, 'Canónica');
    t.persona(A, 'Fundida', B);
    t.persona(C, 'Otra');
    const guard = crearGuardDb(t.db);
    expect(await guard.confirmar(candidato(A, { validTo: '2025-12-31' }))).toBe(true);
    expect(await guard.confirmar(candidato(B, { validTo: '2025-12-31' }))).toBe(true);
    expect(t.sqlite.prepare('SELECT count(*) AS n FROM sport_external_id').get()?.n).toBe(1);
    expect(await guard.confirmar(candidato(C, { validFrom: '2026-01-01' }))).toBe(true);
    expect(await guard.confirmar(candidato(B))).toBe(false);
    expect(t.sqlite.prepare('SELECT valid_to FROM sport_external_id WHERE person_id = ?').get(A)?.valid_to).toBe('2025-12-31');
  });

  it('rechaza un alta conflictiva sin huérfanos y revierte persona/alias si la confirmación final falla', async () => {
    const t = entorno();
    t.persona(A, 'Ya confirmada');
    const guard = crearGuardDb(t.db);
    expect(await guard.confirmar(candidato(A))).toBe(true);
    const nueva = { id: B, displayName: 'Nueva', nameNormalized: 'nueva', gender: 'F' as const, countryCode: 'ESP', aliasSource: 'sintetica' };
    expect(await guard.confirmar(candidato(B), nueva)).toBe(false);
    expect(t.sqlite.prepare('SELECT 1 FROM sport_person WHERE id = ?').get(B)).toBeUndefined();
    expect(await guard.confirmar(candidato(B, { value: '67890' }), nueva)).toBe(true);
    expect(t.sqlite.prepare('SELECT count(*) AS n FROM sport_person_alias WHERE person_id = ?').get(B)?.n).toBe(1);
    t.sqlite.exec("CREATE TEMP TRIGGER fallo_id BEFORE INSERT ON sport_external_id WHEN NEW.value = 'fallo' BEGIN SELECT RAISE(ABORT, 'FALLO_ID'); END");
    await expect(guard.confirmar(candidato(C, { value: 'fallo' }), { ...nueva, id: C })).rejects.toThrow('FALLO_ID');
    expect(t.sqlite.prepare('SELECT 1 FROM sport_person WHERE id = ?').get(C)).toBeUndefined();
    expect(t.sqlite.prepare('SELECT 1 FROM sport_person_alias WHERE person_id = ?').get(C)).toBeUndefined();
  });
});
