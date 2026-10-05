import { describe, expect, it } from 'vitest';
import { metadatosDeCabecera } from '@/lib/ingest/sources/rfee-pdf/cabecera';
import { analizarPagina } from '@/lib/ingest/sources/rfee-pdf/paginas';
import { leerResultadosPdf } from '@/lib/ingest/sources/rfee-pdf/resultados';
import type { PaginaTexto, TipoPagina } from '@/lib/ingest/sources/rfee-pdf/tipos';
import { cabecera, fila, filasPoule, pagina, paginaClasificacion, paginaPoules, type Tirador } from './fixtures/rfee-pdf/sintetico';

const CTX = { url: 'https://app.skermo.org/client/1/prueba.pdf', docId: 'prueba' };
// Sin «individual»: la modalidad sólo la declara el total de la clasificación.
const ESPADA = cabecera('ESPADA MASCULINA');
const TIRADORES: Tirador[] = ['ALFA UNO', 'BRAVO DOS', 'CHARLIE TRES', 'DELTA CUATRO'].map((nombre, i) => ({
  puesto: String(i + 1),
  nombre,
  club: `CLUB-${i + 1}`,
}));
// Las dos «V» a secas (A→C y C→B) las obligan los totales de su fila.
const TOCADOS = [
  [0, 4, 5, 4],
  [3, 0, 2, 4],
  [2, 5, 0, 3],
  [3, 2, 4, 0],
];

const traducir = (p: PaginaTexto, textos: Record<string, string>): PaginaTexto => ({
  ...p,
  items: p.items.map((i) => ({ ...i, s: textos[i.s] ?? i.s })),
});
const tipoDe = (titulo: string): TipoPagina =>
  analizarPagina(pagina(1, [...ESPADA, fila(740, [43, titulo]), fila(727, [55, 'ARBITRO UNO'], [200, 'CLUB-1'])])).tipo;

describe('secciones de Engarde en catalán e inglés', () => {
  it.each<[string, TipoPagina]>([
    ['Classificació general (ordre per lloc - 4 tiradors)', 'clasificacion_final'],
    ['Overall ranking (sorted by rank - 4 fencers)', 'clasificacion_final'],
    ['Poules, volta núm. 1', 'poules'],
    ['Poules, round No 1', 'poules'],
    ['Classificació al acabar les poules', 'clasificacion_intermedia'],
    ['Ranking at the end of poules', 'clasificacion_intermedia'],
    ['Ranking of poules', 'clasificacion_intermedia'],
    ['Tiradors (presents, per ordre alfabètic)', 'participantes'],
    ['Fencers (present, in alphabetical order)', 'participantes'],
    ['Fórmula de la competició', 'formula'],
    ['Formula of the competition', 'formula'],
    ['Activitat dels àrbitres', 'arbitros'],
    ['Referee activities', 'arbitros'],
    ['Actividad de los árbitros en encuentros', 'arbitros'],
    ['Número total de participantes: 4', 'estadisticas'],
    ['Overall number of fencers: 4', 'estadisticas'],
    ['Clasificación de la liga', 'desconocida'],
  ])('«%s» es una página de %s', (titulo, tipo) => {
    expect(tipoDe(titulo)).toBe(tipo);
  });

  it('lee la clasificación catalana con su total y su modalidad', () => {
    const final = traducir(paginaClasificacion(1, ESPADA, TIRADORES), {
      'Clasificación general final (orden por lugar - 4 tiradores)': 'Classificació general (ordre per lloc - 4 tiradors)',
    });
    const p = leerResultadosPdf([final], CTX).pruebas[0];
    expect(p).toMatchObject({ formato: 'INDIVIDUAL', estado: 'completo' });
    expect(p.cobertura.puestos).toMatchObject({ estado: 'completo', publicado: 4, importado: 4 });
  });

  it('lee poules con V/M de coma decimal y la vuelta y la poule en catalán', () => {
    const poules = traducir(paginaPoules(1, ESPADA, [filasPoule(TOCADOS, TIRADORES, { coma: true })], 2), {
      'Poules, vuelta No 2': 'Poules, volta núm. 2',
      'Poule No 1': 'Poule núm. 1',
    });
    expect(poules.items.filter((i) => i.s === '0,333')).toHaveLength(3);
    const p = leerResultadosPdf([poules, paginaClasificacion(2, ESPADA, TIRADORES)], CTX).pruebas[0];
    const enPoule = p.asaltos.filter((a) => a.fase === 'POULE');
    expect(enPoule).toHaveLength(6);
    expect(new Set(enPoule.map((a) => a.ronda))).toEqual(new Set(['V2P1']));
    expect(enPoule.filter((a) => a.marcador === 'derivado_de_totales')).toHaveLength(2);
    expect(p.rechazos).toEqual([]);
    expect(p.cobertura.poules).toMatchObject({ estado: 'completo', publicado: 6, importado: 6 });
  });
});

describe('páginas que no separan la prueba', () => {
  // El número del contador cae en la esquina que se descarta y deja sólo «Página».
  const conContador = (p: PaginaTexto): PaginaTexto => ({
    ...p,
    items: [...p.items, { s: 'Página', x: 470, y: 822, w: 22, h: 8 }, { s: '2/3', x: 530, y: 822, w: 11, h: 8 }],
  });

  it('un contador «Página» sin número no forma parte de la cabecera de la prueba', () => {
    const arbitros = conContador(pagina(2, [...ESPADA, fila(740, [43, 'Actividad de los árbitros']), fila(727, [55, 'ARBITRO UNO'], [200, '3'])]));
    expect(analizarPagina(arbitros).cabecera).toEqual(analizarPagina(paginaClasificacion(1, ESPADA, TIRADORES)).cabecera);

    const l = leerResultadosPdf([paginaClasificacion(1, ESPADA, TIRADORES), arbitros], CTX);
    expect(l.pruebas).toHaveLength(1);
    expect(l.paginas.map((p) => [p.tipo, p.prueba])).toEqual([
      ['clasificacion_final', l.pruebas[0].clave],
      ['arbitros', l.pruebas[0].clave],
    ]);
    expect(l.estado).toBe('completo');
  });

  it('la página de estadísticas se reconoce y se atribuye a su prueba sin rechazos', () => {
    const estadisticas = pagina(2, [...ESPADA, fila(740, [43, 'Número total de participantes: 4']), fila(727, [55, 'CLUB-1'], [200, '1'])]);
    const l = leerResultadosPdf([paginaClasificacion(1, ESPADA, TIRADORES), estadisticas], CTX);
    expect(l.paginas[1]).toMatchObject({ tipo: 'estadisticas', prueba: l.pruebas[0].clave, motivo: null });
    expect(l.rechazos).toEqual([]);
    expect(l.estado).toBe('completo');
  });
});

describe('categorías que publica la cabecera', () => {
  const categoria = (...lineas: string[]) => {
    const m = metadatosDeCabecera(lineas);
    return { categoria: m.categoria, original: m.categoriaOriginal };
  };

  it.each<[string[], string, string]>([
    [['CAMPEONATO DE ESPAÑA SUB-23', 'ESPADA MASCULINA'], 'M23', 'M23'],
    [['CAMPEONATO DE ESPAÑA SUB23', 'SABLE FEMENINO'], 'M23', 'M23'],
    [['CAMPEONATO DE ESPAÑA SUB 23 2019', 'FLORETE MASCULINO'], 'M23', 'M23'],
    [['U23 Circuit Barcelona Sabadell', 'FLORETE MASCULINO'], 'M23', 'M23'],
    [['TNR ABS', 'ESPADA FEMENINA'], 'ABS', 'ABS'],
    [['TLM VET30 y 40', 'SABLE MASCULINO'], 'VET', 'VET'],
    [['TLM VET', 'SABLE MASCULINO'], 'VET', 'VET'],
    [['TLM VET+50 Y +60', 'ESPADA MASCULINA'], 'VET', 'VET'],
    [['TORNEO', 'FLORETE MASCULINO +40'], 'VET', '+40'],
  ])('%j → %s', (lineas, codigo, original) => {
    expect(categoria(...lineas)).toEqual({ categoria: codigo, original });
  });

  it('no lee una edad en un prefijo telefónico ni en tramos que se contradicen', () => {
    expect(categoria('TORNEO', 'ESPADA MASCULINA', 'Tel. +34 91 123 45 67').categoria).toBeNull();
    expect(categoria('TORNEO', 'ESPADA MASCULINA M-17 +40').categoria).toBeNull();
    expect(metadatosDeCabecera(['TORNEO', 'ESPADA MASCULINA M-17 +40']).errores).toContain('La cabecera declara categorías contradictorias');
  });
});
