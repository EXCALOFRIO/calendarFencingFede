import { describe, expect, it } from 'vitest';
import {
  documentosQueCambian,
  mapWpMedia,
  type OfficialDocumentCandidate,
  type OfficialDocumentGuardado,
} from '../src/lib/ingest/sources/rfee-wp';
import {
  calcularVigencia,
  vigenciasQueCambian,
  type DocumentoParaVigencia,
} from '../src/lib/documentos/vigencia';
import {
  decidirEscrituraRanking,
  puestosParaHuella,
  rankingContentHash,
} from '../src/lib/ingest/sources/ranking-rfee';

/** Lo que devuelve la API de WordPress, con sus entidades HTML. */
const respuestaWp = [
  {
    id: 9001,
    date_gmt: '2026-09-15T10:20:30',
    title: { rendered: 'CIRCULAR 12-26 GESTI&Oacute;N ADMINISTRATIVA 26-27' },
    source_url: 'https://esgrima.es/wp-content/uploads/2026/09/CIRCULAR-12-26.pdf',
    media_type: 'file',
    mime_type: 'application/pdf',
  },
  {
    id: 9002,
    date_gmt: '2026-09-20T08:00:00',
    title: { rendered: 'Convocatoria Copa de Espa&ntilde;a &#8211; Madrid' },
    source_url: 'https://esgrima.es/wp-content/uploads/2026/09/convocatoria.pdf',
    media_type: 'file',
    mime_type: 'application/pdf',
  },
];

function leer(items = respuestaWp): OfficialDocumentCandidate[] {
  return items.map(mapWpMedia).filter((d): d is OfficialDocumentCandidate => d !== null);
}

/** Como vuelve de D1: `published_at` en milisegundos enteros, leído como Date. */
function guardar(docs: OfficialDocumentCandidate[]): Map<number, OfficialDocumentGuardado> {
  return new Map(
    docs.map((d) => [
      d.wpMediaId,
      { wpMediaId: d.wpMediaId, title: d.title, pdfUrl: d.pdfUrl, publishedAt: new Date(d.publishedAt.getTime()) },
    ]),
  );
}

describe('rfee_wp: lo que no cambia no se reescribe', () => {
  it('dos lecturas iguales: 0 a escribir, 0 actualizados', () => {
    const guardadas = guardar(leer());
    const { nuevos, aEscribir } = documentosQueCambian(leer(), guardadas);
    expect(nuevos).toHaveLength(0);
    expect(aEscribir).toHaveLength(0);
  });

  it('también si la fecha guardada llega como número o como texto ISO', () => {
    const docs = leer();
    const comoNumero = new Map(
      docs.map((d) => [d.wpMediaId, { ...d, publishedAt: d.publishedAt.getTime() }]),
    );
    const comoTexto = new Map(
      docs.map((d) => [d.wpMediaId, { ...d, publishedAt: d.publishedAt.toISOString() }]),
    );
    expect(documentosQueCambian(leer(), comoNumero).aEscribir).toHaveLength(0);
    expect(documentosQueCambian(leer(), comoTexto).aEscribir).toHaveLength(0);
  });

  it('un cambio real de título, URL o fecha: exactamente 1 actualizado', () => {
    const guardadas = guardar(leer());
    const cambios = [
      { ...respuestaWp[0], title: { rendered: 'CIRCULAR 12-26 GESTIÓN ADMINISTRATIVA 26-27 (corrección)' } },
      { ...respuestaWp[0], source_url: 'https://esgrima.es/wp-content/uploads/2026/10/CIRCULAR-12-26-v2.pdf' },
      { ...respuestaWp[0], date_gmt: '2026-09-16T10:20:30' },
    ];
    for (const cambiado of cambios) {
      const { nuevos, aEscribir } = documentosQueCambian(leer([cambiado, respuestaWp[1]]), guardadas);
      expect(nuevos).toHaveLength(0);
      expect(aEscribir.map((d) => d.wpMediaId)).toEqual([9001]);
    }
  });

  it('una circular nueva cuenta como creada, no como actualizada', () => {
    const guardadas = guardar(leer([respuestaWp[0]]));
    const { nuevos, aEscribir } = documentosQueCambian(leer(), guardadas);
    expect(nuevos.map((d) => d.wpMediaId)).toEqual([9002]);
    expect(aEscribir.length - nuevos.length).toBe(0);
  });
});

describe('rfee_wp: la vigencia solo se escribe si cambia', () => {
  const documentos: DocumentoParaVigencia[] = [
    { id: 'a', title: 'CIRCULAR 12-26 GESTION ADMINISTRATIVA 26-27', publishedAt: new Date('2026-09-15T10:00:00Z'), fileHash: null, wpMediaId: 1 },
    { id: 'b', title: 'CIRCULAR 12-26 GESTION ADMINISTRATIVA 26-27 V2', publishedAt: new Date('2026-09-20T10:00:00Z'), fileHash: null, wpMediaId: 2 },
    { id: 'c', title: 'NORMATIVA DE COMPETICIONES 26-27', publishedAt: new Date('2026-09-01T10:00:00Z'), fileHash: null, wpMediaId: 3 },
  ];

  it('dos cálculos sobre los mismos documentos: 0 filas a escribir', () => {
    const guardadas = calcularVigencia(documentos);
    expect(vigenciasQueCambian(calcularVigencia(documentos), guardadas)).toHaveLength(0);
  });

  it('la primera vez se escriben todas', () => {
    expect(vigenciasQueCambian(calcularVigencia(documentos), [])).toHaveLength(documentos.length);
  });

  it('un documento con otro asunto cambia su fila', () => {
    const guardadas = calcularVigencia(documentos);
    const cambiados = documentos.map((d) =>
      d.id === 'c' ? { ...d, title: 'CIRCULAR 20-26 CALENDARIO 26-27' } : d,
    );
    const aEscribir = vigenciasQueCambian(calcularVigencia(cambiados), guardadas);
    expect(aEscribir.map((v) => v.documentoId)).toEqual(['c']);
  });

  it('null y undefined guardados no cuentan como cambio', () => {
    const calculadas = calcularVigencia(documentos);
    const guardadas = calculadas.map((v) => ({ ...v, motivo: v.motivo ?? undefined })) as never;
    expect(vigenciasQueCambian(calculadas, guardadas)).toHaveLength(0);
  });
});

describe('skermo_ranking: una fila igual con licencia no se reescribe', () => {
  const guardada = { contentHash: 'h1', sourceLicense: 'LIC-1', athleteId: 'atl-1' };

  it('dos lecturas iguales: igual', () => {
    expect(decidirEscrituraRanking(guardada, { contentHash: 'h1', licencia: 'LIC-1', athleteId: 'atl-1' })).toBe('igual');
    expect(decidirEscrituraRanking(guardada, { contentHash: 'h1', licencia: null, athleteId: null })).toBe('igual');
  });

  it('cambio de puesto o puntos: actualizada', () => {
    expect(decidirEscrituraRanking(guardada, { contentHash: 'h2', licencia: 'LIC-1', athleteId: 'atl-1' })).toBe('actualizada');
  });

  it('licencia o tirador nuevo con el mismo contenido: emparejada', () => {
    const sinLicencia = { contentHash: 'h1', sourceLicense: null, athleteId: null };
    expect(decidirEscrituraRanking(sinLicencia, { contentHash: 'h1', licencia: 'LIC-1', athleteId: null })).toBe('emparejada');
    const sinTirador = { contentHash: 'h1', sourceLicense: 'LIC-1', athleteId: null };
    expect(decidirEscrituraRanking(sinTirador, { contentHash: 'h1', licencia: 'LIC-1', athleteId: 'atl-1' })).toBe('emparejada');
  });

  it('fila que no estaba: creada', () => {
    expect(decidirEscrituraRanking(undefined, { contentHash: 'h1', licencia: null, athleteId: null })).toBe('creada');
  });
});

describe('skermo_ranking: los empatados que Skermo reordena no cuentan como cambio', () => {
  type Fila = { position: number | null; sourceAthleteName: string; sourceClub: string | null; totalPoints: string | null; skermoAthleteId: string };
  const fila = (id: string, position: number, totalPoints: string): Fila => ({
    position, totalPoints, skermoAthleteId: id, sourceAthleteName: `TIRADOR ${id}`, sourceClub: 'CLUB',
  });

  async function huellas(filas: Fila[]): Promise<Map<string, string>> {
    const marcas = puestosParaHuella(filas);
    const salida = new Map<string, string>();
    for (const [i, f] of filas.entries()) salida.set(f.skermoAthleteId, await rankingContentHash({ ...f, position: marcas[i] }));
    return salida;
  }

  function distintas(a: Map<string, string>, b: Map<string, string>): string[] {
    return [...b].filter(([id, h]) => a.get(id) !== h).map(([id]) => id);
  }

  // Lo visto en vivo: 4302 y 4705, empatados a 149,08, se cambian el 100 y el 101.
  const lectura1 = [fila('a', 99, '150.00'), fila('4302', 100, '149.08'), fila('4705', 101, '149.08'), fila('b', 102, '148.00')];
  const lectura2 = [fila('a', 99, '150.00'), fila('4705', 100, '149.08'), fila('4302', 101, '149.08'), fila('b', 102, '148.00')];

  it('dos lecturas iguales salvo el orden del empate: 0 actualizados', async () => {
    expect(distintas(await huellas(lectura1), await huellas(lectura2))).toEqual([]);
  });

  it('quien no empata conserva el hash de siempre', async () => {
    const h = await huellas(lectura1);
    expect(h.get('a')).toBe(await rankingContentHash(lectura1[0]));
  });

  it('un cambio real de puntos: exactamente 1 actualizado', async () => {
    const cambio = lectura1.map((f) => (f.skermoAthleteId === 'b' ? { ...f, totalPoints: '148.50' } : f));
    expect(distintas(await huellas(lectura1), await huellas(cambio))).toEqual(['b']);
  });

  it('si el empate crece o se mueve, se reescriben todos sus miembros juntos', async () => {
    const crece = [fila('a', 99, '150.00'), fila('4302', 100, '149.08'), fila('b', 101, '149.08'), fila('4705', 102, '149.08')];
    expect(distintas(await huellas(lectura1), await huellas(crece)).sort()).toEqual(['4302', '4705', 'b']);
  });
});
