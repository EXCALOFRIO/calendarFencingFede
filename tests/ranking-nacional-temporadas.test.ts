import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { componerChunk, proyeccion } from '../scripts/indexado/sincronizar-d1';
import { RankingNacionalPerfil, rangoTemporadas } from '@/components/explorar/perfil/ranking-perfil';
import { TablaTemporada } from '@/components/ranking/tabla-temporada';
import {
  indicePorLicencia,
  idPublicacion,
  sentenciasPublicacion,
  uuidDeClave,
  vincular,
} from '@/lib/ingest/ranking-skermo-historico';
import type { PublicacionRanking } from '@/lib/ingest/sources/ranking-oficial-historico';
import {
  lecturaDePdf,
  numeroPdf,
  parseFilaPdf,
  parseRankingPdf,
  parseSkermoClasificaciones,
  temporadaCoincide,
  type DocumentoClasificacion,
} from '@/lib/ingest/sources/ranking-rfee-clasificacion-pdf';
import {
  elegirGrupo,
  leerTablaNacional,
  listarGruposNacionales,
  listarTemporadasNacionales,
  type GrupoNacional,
} from '@/lib/queries/ranking-temporadas';
import { categoriaRanking } from '@/lib/ranking/categoria-nacional';
import { leerFiltroRankingNacional, rutaRankingNacional, temporadaCorta } from '@/lib/ranking/url-nacional';
import {
  construirRankingNacional,
  leerRankingNacional,
  sqlRankingNacionalDePersonas,
  temporadaAnterior,
  type FilaRankingNacional,
} from '@/lib/sport/explorar/ranking-nacional';
import { fixtureDeportivaD1 } from './helpers/d1-deporte';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P_FUNDIDA = '33333333-3333-4333-8333-333333333333';

function publicacion(season: string, entradas: { ref: string; puesto: number | null; puntos?: string }[], extra: Partial<PublicacionRanking> = {}): PublicacionRanking {
  return {
    fuente: 'skermo_ranking',
    season,
    arma: 'ESPADA',
    genero: 'F',
    categoria: 'M20',
    categoriaOriginal: 'M20',
    formato: 'INDIVIDUAL',
    publicadoEl: '2026-10-05',
    url: `https://app.skermo.org/ranking-rfee/public/RFEE?season=${season}`,
    total: entradas.length,
    entradas: entradas.map((e) => ({
      sourceRef: `skermo:${e.ref}`, nombre: `TIRADORA ${e.ref}`, pais: null, posicion: e.puesto, puntos: e.puntos ?? null,
      referencia: { tipo: 'skermo', skermoId: e.ref },
    })),
    ...extra,
  };
}

describe('vínculo por licencia', () => {
  const indice = indicePorLicencia([
    { value: 'AAB04660', personId: P1, birthYear: 2005, gender: 'F' },
    { value: 'aab04660 ', personId: P1, birthYear: 2005, gender: 'F' },
    { value: 'DUP00001', personId: P1, birthYear: null, gender: null },
    { value: 'DUP00001', personId: P2, birthYear: null, gender: null },
  ]);

  it('adjunta sólo una licencia de una única persona coherente con nacimiento y género', () => {
    expect(vincular({ licencia: 'AAB04660', anioNacimiento: 2005, genero: 'F' }, indice)).toEqual({ personId: P1, motivo: null });
    expect(vincular({ licencia: 'AAB04660', anioNacimiento: null, genero: 'F' }, indice).personId).toBe(P1);
    expect(vincular({ licencia: 'AAB04660', anioNacimiento: 2006, genero: 'F' }, indice).motivo).toBe('nacimiento_distinto');
    expect(vincular({ licencia: 'AAB04660', anioNacimiento: 2005, genero: 'M' }, indice).motivo).toBe('genero_distinto');
    expect(vincular({ licencia: 'DUP00001', anioNacimiento: null, genero: 'F' }, indice).motivo).toBe('licencia_ambigua');
    expect(vincular({ licencia: 'ZZZ00000', anioNacimiento: null, genero: 'F' }, indice).motivo).toBe('licencia_desconocida');
    expect(vincular({ licencia: null, anioNacimiento: null, genero: 'F' }, indice).motivo).toBe('sin_licencia');
  });

  it('genera UUID deterministas con forma v4', () => {
    const a = uuidDeClave('x');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidDeClave('x')).toBe(a);
    expect(idPublicacion(publicacion('2021-2022', []))).not.toBe(idPublicacion(publicacion('2022-2023', [])));
  });
});

/** Base local con guardas: personas sembradas y las publicaciones aplicadas como en D1. */
function base(publicaciones: { p: PublicacionRanking; personas: Record<string, string | null> }[]) {
  const local = fixtureDeportivaD1();
  const ejecutar = (cuerpo: string, cargo: number) =>
    local.sqlite.exec(componerChunk(cuerpo, { owner: randomUUID(), medidoBytes: 1, proyectadoBytes: proyeccion(cargo) }));
  ejecutar(
    [
      `INSERT INTO sport_person(id,display_name,name_normalized,gender,birth_year) VALUES('${P1}','UNA Tiradora','una tiradora','F',2005)`,
      `INSERT INTO sport_person(id,display_name,name_normalized,gender,birth_year) VALUES('${P2}','OTRA Tiradora','otra tiradora','F',2004)`,
      `INSERT INTO sport_person(id,display_name,name_normalized,gender,birth_year,merged_into_person_id) VALUES('${P_FUNDIDA}','UNA Tiradora','una tiradora','F',2005,'${P1}')`,
    ].map((s) => `${s};\n`).join(''),
    200_000,
  );
  const ficheros: string[] = [];
  for (const { p, personas } of publicaciones) {
    const filas = p.entradas.map((e) => ({
      sourceRef: e.sourceRef, personId: personas[e.sourceRef] ?? null, sourceName: e.nombre, position: e.posicion, points: e.puntos,
    }));
    const { sentencias, cargo } = sentenciasPublicacion(p, filas);
    const cuerpo = sentencias.map((s) => `${s};\n`).join('');
    ficheros.push(cuerpo);
    ejecutar(cuerpo, cargo);
  }
  return { ...local, ficheros, ejecutar };
}

const cuenta = (local: ReturnType<typeof base>, tabla: string) =>
  Number((local.sqlite.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n);

describe('SQL de carga histórica', () => {
  const pubs: { p: PublicacionRanking; personas: Record<string, string | null> }[] = [
    { p: publicacion('2021-2022', [{ ref: '1', puesto: 5, puntos: '100.5' }, { ref: '2', puesto: 1 }, { ref: '9', puesto: null }]), personas: { 'skermo:1': P_FUNDIDA, 'skermo:2': P2 } },
    { p: publicacion('2022-2023', [{ ref: '1', puesto: 2, puntos: '300' }, { ref: '2', puesto: 3 }]), personas: { 'skermo:1': P1 } },
    { p: publicacion('2022-2023', [{ ref: '1', puesto: 7 }], { categoria: 'ABS', categoriaOriginal: 'ABS' }), personas: { 'skermo:1': P1 } },
  ];

  it('pasa las guardas, crea cabecera, entradas y cobertura, y re-aplicar no duplica', () => {
    const local = base(pubs);
    try {
      expect(cuenta(local, 'sport_ranking_publication')).toBe(3);
      expect(cuenta(local, 'sport_ranking_entry')).toBe(6);
      expect(cuenta(local, "sport_import_coverage WHERE source='skermo_ranking' AND status='completo'")).toBe(3);
      for (const f of local.ficheros) local.ejecutar(f, 100_000);
      expect(cuenta(local, 'sport_ranking_publication')).toBe(3);
      expect(cuenta(local, 'sport_ranking_entry')).toBe(6);
      expect(local.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      // Sin lease, la guarda sigue cerrando la tabla.
      expect(() => local.sqlite.exec(local.ficheros[0])).toThrow(/sport_write_lease_required/);
    } finally {
      local.close();
    }
  });

  it('no crea una segunda publicación si la lista ya existe de otro día', () => {
    const local = base([pubs[0]]);
    try {
      const otroDia = { ...pubs[0], p: { ...pubs[0].p, publicadoEl: '2026-10-09' } };
      const { sentencias, cargo } = sentenciasPublicacion(otroDia.p, otroDia.p.entradas.map((e) => ({
        sourceRef: e.sourceRef, personId: null, sourceName: e.nombre, position: e.posicion, points: e.puntos,
      })));
      local.ejecutar(sentencias.map((s) => `${s};\n`).join(''), cargo);
      expect(cuenta(local, 'sport_ranking_publication')).toBe(1);
      expect(cuenta(local, 'sport_ranking_entry')).toBe(3);
    } finally {
      local.close();
    }
  });

  it('el perfil y la página leen las temporadas, con personas fundidas', async () => {
    const local = base(pubs);
    try {
      const ranking = await leerRankingNacional(local.db, [P1, P_FUNDIDA]);
      expect(ranking.temporadas).toEqual(['2021-2022', '2022-2023']);
      expect(ranking.vigente).toBe('2022-2023');
      const m20 = ranking.listas.find((l) => l.categoriaRaw === 'M20')!;
      expect(m20.serie.map((p) => [p.temporada, p.puesto, p.de])).toEqual([['2021-2022', 5, 2], ['2022-2023', 2, 2]]);
      expect(m20.cambio).toBe(3);
      expect(m20.ultimo.puntos).toBe(300);
      expect(ranking.actuales.map((l) => l.categoriaRaw)).toEqual(['M20', 'ABS']);
      expect(ranking.mejor?.puesto).toBe(2);
      expect(ranking.top10).toBe(3);

      expect(await listarTemporadasNacionales(local.db)).toEqual(['2022-2023', '2021-2022']);
      const grupos = await listarGruposNacionales(local.db, '2022-2023');
      expect(grupos.map((g) => g.categoriaRaw)).toEqual(['ABS', 'M20']);
      const tabla = await leerTablaNacional(local.db, '2021-2022', elegirGrupo(await listarGruposNacionales(local.db, '2021-2022'), { arma: 'ESPADA', genero: 'F', categoria: 'M20' })!);
      // Sin clasificar no sale; la persona fundida se enlaza a la que prevalece.
      expect(tabla.filas).toEqual([
        { puesto: 1, nombre: 'TIRADORA 2', puntos: null, personaId: P2 },
        { puesto: 5, nombre: 'TIRADORA 1', puntos: 100.5, personaId: P1 },
      ]);
    } finally {
      local.close();
    }
  });
});

describe('modelo del perfil', () => {
  const fila = (temporada: string, categoriaRaw: string, puesto: number | null, clasificados = 50): FilaRankingNacional => ({
    temporada, arma: 'SABLE', genero: 'M', categoria: categoriaRaw.startsWith('VET') ? 'VET' : categoriaRaw, categoriaRaw,
    puesto, puntos: puesto === null ? null : '10', clasificados,
  });

  it('cambio sólo frente a la temporada inmediatamente anterior; nuevo si es la primera', () => {
    const r = construirRankingNacional([
      fila('2019-2020', 'M17', 8), fila('2021-2022', 'M17', 4), fila('2021-2022', 'M20', 12), fila('2020-2021', 'ABS', 30),
    ], '2022-2023');
    const m17 = r.listas.find((l) => l.categoriaRaw === 'M17')!;
    expect(m17.cambio).toBeNull();
    expect(m17.nueva).toBe(false);
    expect(r.listas.find((l) => l.categoriaRaw === 'M20')!.nueva).toBe(true);
    expect(r.actuales.map((l) => l.categoriaRaw)).toEqual(['M17', 'M20']);
    expect(r.mejor).toMatchObject({ puesto: 4, temporada: '2021-2022' });
    expect(temporadaAnterior('2021-2022')).toBe('2020-2021');
    expect(rangoTemporadas(r.temporadas)).toEqual(['2019-2020', '2020-2021', '2021-2022']);
  });

  it('la consulta lee sólo el ranking oficial de Skermo, nunca el interno', () => {
    const q = JSON.stringify(sqlRankingNacionalDePersonas([P1]));
    expect(q).toContain('sport_ranking_entry');
    expect(q).toContain('skermo_ranking');
    expect(q).not.toMatch(/ranking_snapshot|ranking_point/);
  });

  it('pinta tarjetas, evolución e historial con enlaces por temporada', () => {
    const r = construirRankingNacional([
      fila('2021-2022', 'M20', 3, 40), fila('2022-2023', 'M20', 1, 42), fila('2022-2023', 'VET40', 12, 30),
    ], '2022-2023');
    const html = renderToStaticMarkup(React.createElement(RankingNacionalPerfil, { ranking: r, nivel: 'pagina' }));
    expect(html).toContain('Actual');
    expect(html).toContain('Sable M20');
    expect(html).toContain('Sable Vet 40');
    expect(html).toContain('/ranking?temporada=2021-2022&amp;arma=SABLE&amp;genero=M&amp;categoria=M20');
    expect(html).toContain('Evolución');
    expect(html).toContain('de 42');
    // Mejora de 2 puestos, con texto y no sólo color.
    expect(html).toContain('2 puestos mejor que la temporada anterior');
    expect(renderToStaticMarkup(React.createElement(RankingNacionalPerfil, {
      ranking: construirRankingNacional([], null), nivel: 'pagina',
    }))).toBe('');
  });
});

describe('clasificaciones en PDF (2017-2021)', () => {
  const doc: DocumentoClasificacion = {
    nombre: 'Ranking Nacional', arma: 'ESPADA', genero: 'M', categoriaRaw: 'ABS', individual: true, fecha: '2021-06-06',
    url: 'https://app.skermo.org/client/1/CLASSIFICATION_FILES/abc.pdf', archivo: 'abc.pdf', esRankingIndividual: true,
  };
  const texto = [
    'Generar Ranking', 'POS APELLIDOS NOMBRE CLUB NACIMIENTO 1920', 'TNR ABS 1 ESPADA', 'PUNT',
    '1 IBAÑEZ BRINGAS ALVARO SAES-BU 1995 1087,35 2424 (1) 2424 (1) 3636 (1) 9.571,35',
    '2 ROMERO GOMEZ JUAN PEDRO CEP-M 1992 1089,08 1189,15 (9) 2083,48 (2)',
    '2134,94 (5) 6.496,65',
    '3 CARVALHO GERARDO PIRES DA', 'CRUZ JOAO RODRIGO VCE-VA 1998 255,4 2.000,00',
    '4 MARTINI COSIMO (Sin Licencia - 2021) 1997 393,6 393,6',
    '5 TORRES CANO Alejo SAM\u2010B ESP 1993 0,00 160,09 300,00',
    '210 220 193 146 28',
    'RANKING TEMPORADA 2021', 'Espada Masculina - ABSOLUTA',
  ].join('\n');

  it('lee filas partidas, sin licencia, país y pies de página', () => {
    const r = parseRankingPdf(texto);
    expect(r.anioTemporada).toBe(2021);
    expect(r.filas.map((f) => [f.puesto, f.nombre, f.club, f.anio, f.total])).toEqual([
      [1, 'IBAÑEZ BRINGAS ALVARO', 'SAES-BU', 1995, '9571.35'],
      [2, 'ROMERO GOMEZ JUAN PEDRO', 'CEP-M', 1992, '6496.65'],
      [3, 'CARVALHO GERARDO PIRES DA CRUZ JOAO RODRIGO', 'VCE-VA', 1998, '2000.00'],
      [4, 'MARTINI COSIMO', null, 1997, '393.6'],
      [5, 'TORRES CANO Alejo', 'SAM-B', 1993, '300.00'],
    ]);
    expect(parseFilaPdf('7 SIN TOTAL CE-M 1996 #### ####')).toBeNull();
    expect(numeroPdf('9.571,35')).toBe('9571.35');
  });

  it('sólo da por completa una lista coherente; sin persona y con la fecha de referencia', () => {
    const l = lecturaDePdf('2020-2021', doc, texto, '2026-10-06');
    expect(l.cobertura.estado).toBe('completo');
    expect(l.publicacion?.publicadoEl).toBe('2021-06-06');
    expect(l.publicacion?.entradas.every((e) => e.referencia === null)).toBe(true);
    expect(lecturaDePdf('2019-2020', doc, texto, '2026-10-06').cobertura.estado).toBe('conflicto');
    expect(lecturaDePdf('2020-2021', { ...doc, genero: 'F' }, texto, '2026-10-06').cobertura.estado).toBe('conflicto');
    expect(lecturaDePdf('2020-2021', doc, `${texto}\n1 OTRA LISTA CE-M 1960 10,0 10,0`, '2026-10-06').cobertura.estado).toBe('parcial');
    expect(lecturaDePdf('2020-2021', doc, texto.replace('393,6 393,6', '393,6 9.999,00'), '2026-10-06').cobertura.estado).toBe('parcial');
    expect(temporadaCoincide(1819, '2018-2019')).toBe(true);
    expect(temporadaCoincide(2019, '2018-2019')).toBe(true);
    expect(temporadaCoincide(2020, '2018-2019')).toBe(false);
  });

  it('lee el índice de clasificaciones y se queda con los rankings individuales', () => {
    const html = `<table class="table"><tbody>
      <tr><td>Ranking Nacional<br/><small>06/06/2021</small></td><td>Espada</td><td>ABS</td><td>Masculino</td><td>Individual</td><td>EM ABS</td><td>06/06/2021</td><td><a href="https://app.skermo.org/client/1/CLASSIFICATION_FILES/abc.pdf">x</a></td></tr>
      <tr><td>Copa de S.M. El Rey</td><td>Espada</td><td>ABS</td><td>Masculino</td><td>Equipos</td><td>x</td><td>01/07/2021</td><td><a href="https://app.skermo.org/client/1/CLASSIFICATION_FILES/def.pdf">x</a></td></tr>
    </tbody></table>`;
    const docs = parseSkermoClasificaciones(html);
    expect(docs.filter((d) => d.esRankingIndividual).map((d) => [d.arma, d.genero, d.categoriaRaw, d.fecha, d.archivo]))
      .toEqual([['ESPADA', 'M', 'ABS', '2021-06-06', 'abc.pdf']]);
  });
});

describe('enlaces y tabla de temporada', () => {
  it('lee y construye la URL de una lista', () => {
    expect(leerFiltroRankingNacional({ temporada: '2021-2022', arma: 'espada', genero: 'f', categoria: 'vet40' }))
      .toEqual({ temporada: '2021-2022', arma: 'ESPADA', genero: 'F', categoria: 'VET40' });
    expect(leerFiltroRankingNacional({ temporada: '2021-2023', arma: 'arco', genero: 'x', categoria: "M20'--" }))
      .toEqual({ temporada: null, arma: null, genero: null, categoria: null });
    expect(rutaRankingNacional({ temporada: '2021-2022', arma: 'SABLE' })).toBe('/ranking?temporada=2021-2022&arma=SABLE');
    expect(rutaRankingNacional({})).toBe('/ranking');
    expect(temporadaCorta('2021-2022')).toBe('21-22');
    expect(categoriaRanking('VET', 'VET40')).toBe('Vet 40');
    expect(categoriaRanking('ABS', 'ABS')).toBe('Absoluto');
  });

  it('elige el grupo pedido o el más parecido', () => {
    const g = (arma: GrupoNacional['arma'], genero: GrupoNacional['genero'], categoriaRaw: string): GrupoNacional =>
      ({ arma, genero, categoria: categoriaRaw.replace(/\d+$/, '') === 'VET' ? 'VET' : categoriaRaw, categoriaRaw, clasificados: 1 });
    const grupos = [g('ESPADA', 'M', 'M20'), g('ESPADA', 'M', 'ABS'), g('SABLE', 'F', 'M17')];
    expect(elegirGrupo(grupos, { arma: 'ESPADA', genero: 'M', categoria: 'M20' })?.categoriaRaw).toBe('M20');
    expect(elegirGrupo(grupos, { arma: 'ESPADA', genero: 'M', categoria: 'M13' })?.categoriaRaw).toBe('ABS');
    expect(elegirGrupo(grupos, { arma: 'SABLE', genero: 'M', categoria: null })?.arma).toBe('SABLE');
    expect(elegirGrupo([], { arma: null, genero: null, categoria: null })).toBeNull();
  });

  it('resalta los tuyos y enlaza al perfil', () => {
    const html = renderToStaticMarkup(React.createElement(TablaTemporada, {
      tabla: {
        temporada: '2021-2022',
        grupo: { arma: 'ESPADA', genero: 'F', categoria: 'M20', categoriaRaw: 'M20', clasificados: 2 },
        filas: [
          { puesto: 1, nombre: 'ANA PÉREZ', puntos: 1234.5, personaId: P1 },
          { puesto: 2, nombre: 'EVA RUIZ', puntos: null, personaId: null },
        ],
      },
      mios: [P1],
    }));
    expect(html).toContain(`href="/explorar/${P1}"`);
    expect(html).toContain('data-mio="true"');
    expect(html).toContain('1234,5');
  });
});
