import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { componerChunk, proyeccion } from '../scripts/indexado/sincronizar-d1';
import { sentenciasPublicacion } from '@/lib/ingest/ranking-skermo-historico';
import type { PublicacionRanking } from '@/lib/ingest/sources/ranking-oficial-historico';
import { personasOficiales } from '@/lib/queries/personas-ranking';
import { leerTablaNacional, listarGruposNacionales, listarTemporadasNacionales } from '@/lib/queries/ranking-temporadas';
import { chipsRanking } from '@/lib/sport/explorar/chips-ranking';
import { compararMedallas, medallaMasValiosa, type MedallaPerfil } from '@/lib/sport/explorar/medallas-perfil';
import { construirBloque, type PuestoInternacional } from '@/lib/sport/explorar/ranking-internacional';
import { conClasificacionVigente, fuentesCabecera } from '@/lib/sport/explorar/ranking-ambitos';
import {
  decidirLecturas,
  leerPuestosOficialesVigentes,
  leerRankingNacional,
  type ListaLeida,
} from '@/lib/sport/explorar/ranking-nacional';
import { clasificarCompeticion } from '@/lib/sport/explorar/tipo-competicion';
import type { ResultadoPerfil } from '@/lib/sport/explorar/tipos-perfil';
import type { TipoCompeticion } from '@/lib/sport/explorar/tipos-social';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const VIGENTE = '2026-2027';
const CERRADA = '2025-2026';

function publicacion(season: string, entradas: { ref: string; puesto: number | null; puntos?: string }[], categoria: PublicacionRanking['categoria'] = 'ABS'): PublicacionRanking {
  return {
    fuente: 'skermo_ranking', season, arma: 'FLORETE', genero: 'M', categoria, categoriaOriginal: categoria,
    formato: 'INDIVIDUAL', publicadoEl: '2026-10-06', url: 'https://app.skermo.org/ranking-rfee/public/RFEE', total: entradas.length,
    entradas: entradas.map((e) => ({
      sourceRef: `skermo:${e.ref}`, nombre: `TIRADOR ${e.ref}`, pais: null, posicion: e.puesto, puntos: e.puntos ?? null,
      referencia: { tipo: 'skermo', skermoId: e.ref },
    })),
  };
}

type Oficial = { temporada: string; skermo: string; puesto: number | null; puntos?: string; licencia?: string | null; leido: number; categoria?: string };

/**
 * Base con tres tiradores. Skermo `10` = P1, `20` = P2, `30` = P3. Las
 * publicaciones y la tabla oficial se dan por caso.
 */
function base(publicaciones: { p: PublicacionRanking; personas: Record<string, string>; leido: number }[], oficiales: Oficial[], licencias: { persona: string; licencia: string }[] = []) {
  const local = fixtureDeportivaD1();
  const ejecutar = (cuerpo: string, cargo = 200_000) =>
    local.sqlite.exec(componerChunk(cuerpo, { owner: randomUUID(), medidoBytes: 1, proyectadoBytes: proyeccion(cargo) }));
  ejecutar([P1, P2, P3].map((id, i) =>
    `INSERT INTO sport_person(id,display_name,name_normalized,gender) VALUES('${id}','TIRADOR ${i}','tirador ${i}','M');\n`).join(''));
  for (const l of licencias) {
    ejecutar(`INSERT INTO sport_external_id(id,person_id,scheme,value,scope_source,scope_federation,scope_season,scope_weapon,valid_from,link_status,linked_via)
      VALUES('${randomUUID()}','${l.persona}','rfee_license','${l.licencia}','skermo_rfee','RFEE','${VIGENTE}','','2026-09-01','CONFIRMADO','skermo_finales');\n`);
  }
  for (const { p, personas, leido } of publicaciones) {
    const filas = p.entradas.map((e) => ({ sourceRef: e.sourceRef, personId: personas[e.sourceRef] ?? null, sourceName: e.nombre, position: e.posicion, points: e.puntos }));
    const { sentencias, cargo, id } = sentenciasPublicacion(p, filas);
    ejecutar(sentencias.map((s) => `${s};\n`).join(''), cargo);
    ejecutar(`UPDATE sport_ranking_publication SET fetched_at = ${leido} WHERE id = '${id}';\n`);
  }
  for (const o of oficiales) {
    const categoria = o.categoria ?? 'ABS';
    local.sqlite.exec(`INSERT INTO official_ranking_entry(id,season_label,skermo_season_id,weapon,gender,category,category_raw,position,total_points,skermo_athlete_id,source_license,source_athlete_name,content_hash,ingested_at,updated_at)
      VALUES('${randomUUID()}','${o.temporada}','${o.temporada.slice(0, 4)}','FLORETE','M','${categoria}','${categoria}',${o.puesto ?? 'NULL'},${o.puntos ? `'${o.puntos}'` : 'NULL'},'${o.skermo}',${o.licencia ? `'${o.licencia}'` : 'NULL'},'TIRADOR ${o.skermo}','h',${o.leido},${o.leido})`);
  }
  return local;
}

const PERSONAS = { 'skermo:10': P1, 'skermo:20': P2, 'skermo:30': P3 };

describe('regla A: la temporada vigente sale siempre de la tabla oficial', () => {
  it('manda la tabla oficial aunque la publicación de la vigente sea más reciente y diga otra cosa', async () => {
    const local = base(
      [{ p: publicacion(VIGENTE, [{ ref: '10', puesto: 1, puntos: '3811.77' }, { ref: '20', puesto: 2 }]), personas: PERSONAS, leido: 2_000 }],
      [
        { temporada: VIGENTE, skermo: '10', puesto: 3, puntos: '1387.77', leido: 1_000 },
        { temporada: VIGENTE, skermo: '20', puesto: 1, leido: 1_000 },
        { temporada: VIGENTE, skermo: '30', puesto: 2, leido: 1_000 },
      ],
    );
    try {
      const r = await leerRankingNacional(local.db, [P1]);
      expect(r.vigente).toBe(VIGENTE);
      expect(r.actuales.map((l) => [l.ultimo.temporada, l.ultimo.puesto, l.ultimo.puntos, l.ultimo.de])).toEqual([[VIGENTE, 3, 1387.77, 3]]);
      const chips = chipsRanking({ nacional: r });
      expect(chips).toEqual([expect.objectContaining({ ambito: 'nacional', organismo: 'RFEE', puesto: 3, actual: true })]);
      // La tarjeta de /ranking usa la misma lectura.
      expect((await leerPuestosOficialesVigentes(local.db, [P1])).map((f) => [f.puesto, f.clasificados])).toEqual([[3, 3]]);
    } finally {
      local.close();
    }
  });

  it('quien está en la tabla oficial y no en la publicación se reconoce por su id de Skermo de otra temporada o por su licencia', async () => {
    const local = base(
      [
        { p: publicacion(CERRADA, [{ ref: '30', puesto: 9 }]), personas: PERSONAS, leido: 500 },
        { p: publicacion(VIGENTE, [{ ref: '10', puesto: 1 }]), personas: PERSONAS, leido: 2_000 },
      ],
      [
        { temporada: VIGENTE, skermo: '30', puesto: 4, leido: 1_000 },
        { temporada: VIGENTE, skermo: '99', puesto: 5, licencia: 'LIC0002', leido: 1_000 },
      ],
      [{ persona: P2, licencia: 'LIC0002' }],
    );
    try {
      const p3 = await leerRankingNacional(local.db, [P3]);
      expect(p3.actuales.map((l) => [l.ultimo.temporada, l.ultimo.puesto])).toEqual([[VIGENTE, 4]]);
      const p2 = await leerRankingNacional(local.db, [P2]);
      expect(p2.actuales.map((l) => [l.ultimo.temporada, l.ultimo.puesto])).toEqual([[VIGENTE, 5]]);
      // Y la tabla de /ranking los enlaza igual: la licencia y, sin ella, el id de Skermo de la publicación de la temporada.
      const personas = Object.values(await personasOficiales(local.db, VIGENTE)).sort();
      expect(personas).toEqual([P2].sort());
    } finally {
      local.close();
    }
  });

  it('quien ya no está en la tabla oficial no conserva el puesto de la publicación', async () => {
    const local = base(
      [
        { p: publicacion(CERRADA, [{ ref: '10', puesto: 7 }]), personas: PERSONAS, leido: 500 },
        { p: publicacion(VIGENTE, [{ ref: '10', puesto: 1 }, { ref: '20', puesto: 2 }]), personas: PERSONAS, leido: 2_000 },
      ],
      [{ temporada: VIGENTE, skermo: '20', puesto: 1, leido: 1_000 }],
    );
    try {
      const r = await leerRankingNacional(local.db, [P1]);
      expect(r.listas.flatMap((l) => l.serie.map((p) => [p.temporada, p.puesto]))).toEqual([[CERRADA, 7]]);
      const [chip] = chipsRanking({ nacional: r });
      // Sin puesto vigente: su mejor puesto de carrera, con temporada, y no el 1.º de la publicación.
      expect(chip).toMatchObject({ ambito: 'nacional', puesto: 7, temporada: CERRADA, actual: false });
      expect(await leerPuestosOficialesVigentes(local.db, [P1])).toEqual([]);
    } finally {
      local.close();
    }
  });
});

describe('regla A: en una temporada cerrada gana la lectura más reciente', () => {
  const oficial = (l: Partial<ListaLeida>): ListaLeida => ({ temporada: CERRADA, arma: 'FLORETE', genero: 'M', categoriaRaw: 'ABS', clasificados: 3, lectura: 1_000, ...l });

  it('decide lista a lista', () => {
    const lecturas = decidirLecturas(
      [oficial({ temporada: VIGENTE, lectura: 1 }), oficial({ lectura: 3_000 }), oficial({ categoriaRaw: 'M20', lectura: 1_000 })],
      [oficial({ temporada: VIGENTE, lectura: 9_000 }), oficial({ lectura: 2_000 }), oficial({ categoriaRaw: 'M20', lectura: 2_000 })],
      null,
    );
    expect(lecturas.vigente).toBe(VIGENTE);
    expect(lecturas.ganaOficial(oficial({ temporada: VIGENTE }))).toBe(true);
    expect(lecturas.ganaOficial(oficial({}))).toBe(true);
    expect(lecturas.ganaOficial(oficial({ categoriaRaw: 'M20' }))).toBe(false);
    expect(lecturas.ganaOficial(oficial({ categoriaRaw: 'M17' }))).toBe(false);
    // Sin tabla oficial, la vigente es la última publicada.
    expect(decidirLecturas([], [], '2024-2025').vigente).toBe('2024-2025');
  });

  it('perfil y /ranking leen la tabla oficial de una temporada cerrada si es más reciente que la publicación', async () => {
    const local = base(
      [{ p: publicacion(CERRADA, [{ ref: '10', puesto: 6 }, { ref: '20', puesto: 1 }]), personas: PERSONAS, leido: 1_000 }],
      [
        { temporada: VIGENTE, skermo: '20', puesto: 1, leido: 5_000 },
        { temporada: CERRADA, skermo: '10', puesto: 2, licencia: 'LIC0001', leido: 3_000 },
        { temporada: CERRADA, skermo: '20', puesto: 1, leido: 3_000 },
      ],
      [{ persona: P1, licencia: 'LIC0001' }],
    );
    try {
      const r = await leerRankingNacional(local.db, [P1]);
      expect(r.listas.flatMap((l) => l.serie.map((p) => [p.temporada, p.puesto, p.de]))).toEqual([[CERRADA, 2, 2]]);
      expect(await listarTemporadasNacionales(local.db)).toEqual([VIGENTE, CERRADA]);
      const [grupo] = await listarGruposNacionales(local.db, CERRADA);
      expect(grupo).toMatchObject({ categoriaRaw: 'ABS', clasificados: 2, fuente: 'oficial' });
      const tabla = await leerTablaNacional(local.db, CERRADA, grupo);
      expect(tabla.filas.map((f) => [f.puesto, f.personaId])).toEqual([[1, P2], [2, P1]]);
    } finally {
      local.close();
    }
  });

  it('y la publicación si es ella la más reciente', async () => {
    const local = base(
      [{ p: publicacion(CERRADA, [{ ref: '10', puesto: 6 }]), personas: PERSONAS, leido: 4_000 }],
      [
        { temporada: VIGENTE, skermo: '20', puesto: 1, leido: 5_000 },
        { temporada: CERRADA, skermo: '10', puesto: 2, leido: 3_000 },
      ],
    );
    try {
      const r = await leerRankingNacional(local.db, [P1]);
      expect(r.listas.flatMap((l) => l.serie.map((p) => [p.temporada, p.puesto]))).toEqual([[CERRADA, 6]]);
      const [grupo] = await listarGruposNacionales(local.db, CERRADA);
      expect(grupo.fuente).toBe('publicacion');
    } finally {
      local.close();
    }
  });
});

const puesto = (p: Partial<PuestoInternacional>): PuestoInternacional => ({
  fuente: 'fie_historico', organismo: 'FIE', ambito: 'mundial', temporada: '2022', anioFin: 2022, arma: 'FLORETE', genero: 'M',
  categoria: 'ABS', categoriaRaw: 'S', puesto: 13, puntos: null, de: null, publicadoEl: '2022-07-01', url: null, ...p,
});

describe('regla B: dos filas en la cabecera', () => {
  it('Internacional primero y Nacional después; retirado = mejor puesto de la carrera con temporada', () => {
    const internacional = construirBloque('mundial', [puesto({}), puesto({ temporada: '2020', anioFin: 2020, puesto: 40 })], 2026);
    const chips = chipsRanking({
      ambitos: { pais: 'ESP', internacional, nacionalFuera: null },
      resumenMundial: { vigente: '2026', mejores: [], actuales: [] },
    });
    expect(chips).toEqual([expect.objectContaining({ ambito: 'internacional', organismo: 'FIE', puesto: 13, temporada: '2022', actual: false })]);
  });

  it('el extranjero lleva el nacional de su federación y no el de la RFEE; sin federación leída, no hay fila nacional', () => {
    const ffe = construirBloque('nacional', [puesto({ fuente: 'ffe_classement', organismo: 'FFE', ambito: 'nacional', temporada: '2025-2026', anioFin: 2026, puesto: 2 })], 2026);
    const rfee = { vigente: VIGENTE, temporadas: [VIGENTE], actuales: [], listas: [], mejor: null, top10: 0 };
    expect(chipsRanking({ ambitos: { pais: 'FRA', internacional: null, nacionalFuera: ffe }, nacional: rfee }))
      .toEqual([expect.objectContaining({ ambito: 'nacional', organismo: 'FFE', puesto: 2, actual: true })]);
    expect(chipsRanking({ ambitos: { pais: 'USA', internacional: null, nacionalFuera: null }, nacional: rfee })).toEqual([]);
    expect(fuentesCabecera('ESP')).toEqual(['fie_tiradores', 'fie_historico']);
    expect(fuentesCabecera('FRA')).toEqual(['fie_tiradores', 'fie_historico', 'ffe_classement']);
  });

  it('la pestaña toma el puesto vigente de la clasificación FIE de la cabecera si la lista por temporada no lo trae', () => {
    const bloque = construirBloque('mundial', [puesto({})], 2022)!;
    expect(bloque.actual.map((p) => p.puesto)).toEqual([13]);
    const sinVigente = construirBloque('mundial', [puesto({})], 2027)!;
    const resumen = { vigente: '2027', mejores: [], actuales: [{ arma: 'FLORETE' as const, genero: 'M' as const, categoria: 'ABS', puesto: 25, temporada: '2027' }] };
    expect(conClasificacionVigente(sinVigente, resumen)?.actual.map((p) => [p.puesto, p.anioFin])).toEqual([[25, 2027]]);
    expect(conClasificacionVigente(bloque, resumen)).toBe(bloque);
    expect(conClasificacionVigente(null, { vigente: '2027', mejores: [], actuales: [] })).toBeNull();
  });

  it('la insignia olímpica sólo va en la internacional absoluta vigente en zona de clasificación', () => {
    const anotacion = { estado: 'clasificado' } as never;
    const resumenMundial = { vigente: '2026', mejores: [], actuales: [{ arma: 'FLORETE', genero: 'M', categoria: 'ABS', puesto: 13, temporada: '2026', fieId: 1 }] } as never;
    const [chip] = chipsRanking({ resumenMundial, olimpica: [{ arma: 'FLORETE', genero: 'M', anotacion }] });
    expect(chip).toMatchObject({ ambito: 'internacional', actual: true, olimpica: anotacion });
    const [sinMarca] = chipsRanking({ resumenMundial, olimpica: [{ arma: 'SABLE', genero: 'M', anotacion }] });
    expect(sinMarca.olimpica).toBeUndefined();
  });
});

const medalla = (m: Partial<MedallaPerfil> & { tipo: TipoCompeticion }): MedallaPerfil => ({
  medalla: 'oro', etiquetaTipo: m.tipo, ambito: 'internacional', categoria: 'ABS', formato: 'INDIVIDUAL',
  torneo: 'X', temporada: '2024', fecha: '2024-01-01', resultadoId: randomUUID(), ...m,
});

describe('regla C: la medalla más valiosa', () => {
  it('ordena por nivel, categoría, metal, individual antes que equipos y la más reciente', () => {
    const lista = [
      medalla({ tipo: 'CTO_ESPANA', ambito: 'nacional', resultadoId: 'esp' }),
      medalla({ tipo: 'CIRCUITO_EUROPEO', resultadoId: 'efc' }),
      medalla({ tipo: 'COPA_MUNDO', resultadoId: 'cdm' }),
      medalla({ tipo: 'CTO_EUROPA', medalla: 'bronce', resultadoId: 'europa-bronce' }),
      medalla({ tipo: 'CTO_MUNDO', categoria: 'M20', resultadoId: 'mundial-m20' }),
      medalla({ tipo: 'CTO_MUNDO', medalla: 'plata', resultadoId: 'mundial-abs-plata' }),
      medalla({ tipo: 'CTO_MUNDO', medalla: 'plata', formato: 'EQUIPOS', resultadoId: 'mundial-abs-plata-eq' }),
      medalla({ tipo: 'JUEGOS_OLIMPICOS', medalla: 'bronce', resultadoId: 'jjoo' }),
      medalla({ tipo: 'TNR', ambito: 'nacional', resultadoId: 'tnr' }),
      medalla({ tipo: 'CTO_ESPANA', ambito: 'nacional', categoria: 'M17', resultadoId: 'esp-m17' }),
    ];
    expect([...lista].sort(compararMedallas).map((m) => m.resultadoId)).toEqual([
      'jjoo', 'mundial-abs-plata', 'mundial-abs-plata-eq', 'mundial-m20', 'europa-bronce', 'cdm', 'efc', 'esp', 'esp-m17', 'tnr',
    ]);
  });

  it('cada cara destaca sólo las de su ámbito', () => {
    const r = (id: string, puesto: number, nombre: string, fuente: string, pais: string | null): ResultadoPerfil => ({
      id, puesto, puestoPublicado: null, puntosOficiales: null, fuente, enlace: null,
      torneo: { id, nombre, ciudad: null, pais }, tipoDocumentado: null,
      prueba: { id, arma: 'FLORETE', genero: 'M', categoria: { codigo: 'ABS', raw: 'ABS' }, formato: 'INDIVIDUAL' },
      temporada: '2024', fecha: '2024-01-01',
      clasificacion: clasificarCompeticion({ nombre, fuente, pais }), asaltos: null, puestoFiable: puesto,
    } as ResultadoPerfil);
    const items = [r('a', 1, 'Campeonato de España', 'skermo_rfee', 'ESP'), r('b', 3, 'Coupe du Monde Paris', 'fie', 'FRA'), r('c', 5, 'Grand Prix', 'fie', 'ITA')];
    expect(medallaMasValiosa(items)?.resultadoId).toBe('b');
    expect(medallaMasValiosa(items, 'nacional')?.resultadoId).toBe('a');
    expect(medallaMasValiosa(items.slice(0, 1), 'internacional')).toBeNull();
  });

  it('la fuente efc cuenta como internacional', () => {
    expect(clasificarCompeticion({ nombre: 'Torneo Satélite', fuente: 'efc', pais: 'ESP' }).ambito).toBe('internacional');
    expect(clasificarCompeticion({ nombre: 'Torneo de Vigo', fuente: 'efc', pais: 'ESP' })).toMatchObject({ tipo: 'CIRCUITO_EUROPEO', ambito: 'internacional' });
  });
});
