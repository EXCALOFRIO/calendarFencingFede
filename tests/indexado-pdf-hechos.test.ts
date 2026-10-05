import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hechosPrueba, type HechosPrueba } from '@/lib/ingest/hechos/formato';
import { docIdDeUrl, docIdLegadoDeUrl } from '@/lib/ingest/sources/rfee-pdf/lectura';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import type { LecturaPdf, PaginaTexto } from '@/lib/ingest/sources/rfee-pdf/tipos';
import {
  calidadDe,
  estadoSeccion,
  lecturaAHechos,
  nombreUnico,
  peorEstado,
  resolverDocId,
  type IndiceBase,
} from '../scripts/indexado/pdf-a-hechos';
import { indiceFechas } from '../scripts/indexado/fechas-catalogo';

type Fixture = { fuente: { url: string; sha256: string }; paginas: PaginaTexto[] };
const fixture = (n: string): Fixture => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'rfee-pdf', n), 'utf8'));

function leer(n: string, docId?: string): LecturaPdf {
  const f = fixture(n);
  const id = docId ?? docIdLegadoDeUrl(f.fuente.url);
  return { ...leerResultadosPdf(f.paginas, { url: f.fuente.url, docId: id }), sha256: f.fuente.sha256, perfil: null };
}

const base = (l: LecturaPdf) => ({ pdfId: 'pdf-x', url: l.url, sha256: l.sha256, blobPath: null, season: '2018-2019', docId: l.docId });

describe('lecturaAHechos', () => {
  it('emite hechos válidos con las claves de pdf-persist y asaltos referidos a resultados', () => {
    const l = leer('abs-individual-espada-2019.json');
    const { hechos, descartadas } = lecturaAHechos(l, '2018-2019');
    expect(descartadas).toEqual([]);
    expect(hechos.length).toBe(l.pruebas.length);
    const h = hechos[0];
    const p = l.pruebas[0];
    expect(() => hechosPrueba.parse(h)).not.toThrow();
    expect(h).toMatchObject({ source: 'rfee_pdf', extractor: 'lector_pdf', sourceUrl: l.url, sourceSha256: l.sha256 });
    expect(h.edition.tournamentKey).toBe(`pdf:${l.docId}`);
    expect(h.competition.competitionKey).toBe(`pdf:${l.docId}:${p.clave}`);
    expect(h.competition.categoryRaw).toBe(p.categoriaOriginal);
    expect(h.results.length).toBe(p.puestos.length);
    expect(h.results[0].factKey).toBe(`${l.docId}:${p.clave}:${p.puestos[0].sourceFactKey}`);
    expect(h.results[0].factKey).toMatch(/:pdf:p\d+:y\d+$/);
    expect(h.bouts.length).toBeGreaterThan(0);
    const claves = new Set(h.results.map((r) => r.factKey));
    for (const b of h.bouts) {
      expect(claves.has(b.aRef)).toBe(true);
      expect(claves.has(b.bRef)).toBe(true);
    }
    expect(h.status.results).toBe(estadoSeccion('results', p.cobertura.puestos, p.rechazos));
  });

  it('los asaltos llevan el nombre completo del puesto, no el truncado del cuadro', () => {
    const l = leer('abs-individual-espada-2019.json');
    const truncada: LecturaPdf = {
      ...l,
      pruebas: l.pruebas.map((p) => ({ ...p, asaltos: p.asaltos.map((a) => ({ ...a, nombreA: a.nombreA.slice(0, 5), nombreB: a.nombreB.slice(0, 5) })) })),
    };
    const h = lecturaAHechos(truncada, '2018-2019').hechos[0];
    const nombres = new Map(h.results.map((r) => [r.factKey, r.name]));
    const atribuidos = h.bouts.filter((b) => nombres.has(b.aRef));
    expect(atribuidos.length).toBeGreaterThan(0);
    for (const b of atribuidos) expect(b.aName).toBe(nombres.get(b.aRef));
  });

  it('sin fecha en el PDF, la edición y la prueba toman la del catálogo nacional', () => {
    const l = leer('abs-individual-espada-2019.json');
    const sinFecha: LecturaPdf = { ...l, pruebas: l.pruebas.map((p) => ({ ...p, fecha: null })) };
    const p = l.pruebas[0];
    const indice = indiceFechas({
      ownRfeeCatalog: [{
        claveCatalogo: 'k1', temporada: '2018-2019', fecha: '2019-03-02', arma: p.arma, genero: p.genero,
        categoria: p.categoria, formato: p.formato,
      }],
      readingUnits: [{ sourceUrl: l.url, datos: { refOriginal: 'k1' } }],
    });
    const h = lecturaAHechos(sinFecha, '2018-2019', indice).hechos[0];
    expect(h.edition).toMatchObject({ startDate: '2019-03-02', endDate: '2019-03-02' });
    expect(h.competition.date).toBe('2019-03-02');
    expect(lecturaAHechos(sinFecha, '2018-2019').hechos[0].edition.startDate).toBeNull();
  });

  it('una prueba por equipos no publica asaltos individuales', () => {
    const l = leer('abs-equipos-florete-2019.json');
    const { hechos } = lecturaAHechos(l, '2018-2019');
    expect(hechos.length).toBeGreaterThan(0);
    for (const h of hechos) {
      expect(h.competition.format).toBe('EQUIPOS');
      expect(h.bouts).toEqual([]);
      expect(h.status.pools).toBe('sin_resultados');
    }
  });

  it('descarta con motivo la prueba de cabecera incompleta y la marca para droid', () => {
    const l = leer('abs-individual-espada-2019.json');
    const rota: LecturaPdf = { ...l, pruebas: l.pruebas.map((p) => ({ ...p, categoria: null })) };
    const conv = lecturaAHechos(rota, '2018-2019');
    expect(conv.hechos).toEqual([]);
    expect(conv.descartadas[0].motivo).toBe('cabecera_incompleta:categoria');
    const c = calidadDe(base(rota), rota, conv);
    expect(c.needsDroid).toBe(true);
    expect(c.reason).toMatch(/descartadas/);
    expect(c.reason).toMatch(/0 resultados/);
  });

  it('no emite una prueba que el lector no puede atribuir (formato contradictorio)', () => {
    const l = leer('abs-individual-espada-2019.json');
    const pendiente = { estado: 'pendiente' as const, publicado: null, importado: 0, motivo: 'revisión pendiente' };
    const rota: LecturaPdf = {
      ...l,
      pruebas: l.pruebas.map((p) => ({
        ...p, puestos: [], asaltos: [], estado: 'conflicto' as const,
        rechazos: [{ seccion: 'prueba' as const, region: null, motivo: 'La cabecera y la clasificación declaran modalidades distintas' }],
        cobertura: { puestos: pendiente, poules: pendiente, cuadro: pendiente },
      })),
    };
    const conv = lecturaAHechos(rota, '2018-2019');
    expect(conv.hechos).toEqual([]);
    expect(conv.descartadas[0].motivo).toMatch(/^prueba_no_atribuible:La cabecera y la clasificación/);
    expect(calidadDe(base(rota), rota, conv).needsDroid).toBe(true);
  });

  it('un PDF sin pruebas reconocibles necesita droid', () => {
    const l: LecturaPdf = { ...leer('abs-individual-espada-2019.json'), pruebas: [] };
    const c = calidadDe(base(l), l, lecturaAHechos(l, '2018-2019'));
    expect(c).toMatchObject({ needsDroid: true, competitions: 0, results: 0 });
    expect(c.reason).toMatch(/sin cabecera/);
  });
});

describe('estados', () => {
  it('sin_resultados de una sección con regiones rechazadas no es «no publicado»', () => {
    const c = { estado: 'sin_resultados' as const, publicado: null, importado: 0, motivo: null };
    expect(estadoSeccion('pools', c, [{ seccion: 'poules', region: null, motivo: 'x' }])).toBe('parcial');
    expect(estadoSeccion('pools', c, [])).toBe('sin_resultados');
    expect(estadoSeccion('tableau', { ...c, estado: 'conflicto' }, [])).toBe('parcial');
    expect(estadoSeccion('results', { ...c, estado: 'error' }, [])).toBe('ilegible');
  });

  it('agrega por el peor estado publicado', () => {
    expect(peorEstado(['completo', 'sin_resultados'])).toBe('completo');
    expect(peorEstado(['completo', 'parcial'])).toBe('parcial');
    expect(peorEstado(['sin_resultados'])).toBe('sin_resultados');
  });
});

describe('resolverDocId', () => {
  const url = 'https://app.skermo.org/client/1/8a18f4649d0b77c3c078165715948a7a.pdf';
  const indice = (urls: (string | null)[]): IndiceBase => ({
    namespaces: new Map([[`2018-2019|${docIdLegadoDeUrl(url)}`, urls]]),
    competiciones: new Map(),
    docsPorSeason: new Map(),
  });

  it('reutiliza el namespace legado de producción cuando sus URLs son las del documento', () => {
    expect(resolverDocId(indice([url, `${url}#page=2`]), '2018-2019', url)).toEqual({ docId: docIdLegadoDeUrl(url), motivo: 'legado' });
  });
  it('no reutiliza un legado con otra URL ni sin base', () => {
    expect(resolverDocId(indice(['https://app.skermo.org/client/2/8a18f4649d0b77c3c078165715948a7a.pdf']), '2018-2019', url).docId).toBe(docIdDeUrl(url));
    expect(resolverDocId(indice([url]), '2019-2020', url).docId).toBe(docIdDeUrl(url));
    expect(resolverDocId(null, '2018-2019', url).docId).toBe(docIdDeUrl(url));
  });
});

describe('nombreUnico', () => {
  it('desambigua nombres que el recorte de ficheroHechos hace coincidir', () => {
    const h = (k: string) =>
      ({ source: 'rfee_pdf', edition: { season: '2018-2019' }, competition: { competitionKey: `pdf:${'a'.repeat(160)}${k}` } }) as HechosPrueba;
    const usados = new Set<string>();
    const a = nombreUnico(h('1'), usados);
    const b = nombreUnico(h('2'), usados);
    expect(a).not.toBe(b);
    expect(b).toMatch(/__[0-9a-f]{10}\.json$/);
  });
});
