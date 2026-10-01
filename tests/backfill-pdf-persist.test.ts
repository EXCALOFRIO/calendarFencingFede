import { describe, expect, it } from 'vitest';
import {
  FUENTE_PDF,
  decodificarCheckpointPdf,
  persistirLecturaPdf,
  type DepsPersistenciaPdf,
  type FilaCoberturaPdf,
} from '@/lib/ingest/backfill/pdf-persist';
import type { FilaAsalto, FilaResultado } from '@/lib/ingest/fie-resultados-persist';
import type { AsaltoPdf, LecturaPdf, PruebaPdf, PuestoPdf } from '@/lib/ingest/sources/rfee-pdf/tipos';

const region = (pagina = 1, y = 500) => ({ pagina, yMax: y + 10, yMin: y - 10 });

const puesto = (n: number, extra: Partial<PuestoPdf> = {}): PuestoPdf => ({
  sourceFactKey: `p1:y${500 - n}`,
  ref: `p000${n}`,
  posicion: n,
  posicionRaw: null,
  nombre: `TIRADOR ${n}`,
  club: 'CLUB',
  region: region(1, 500 - n),
  ...extra,
});

const asalto = (a: number, b: number, extra: Partial<AsaltoPdf> = {}): AsaltoPdf => ({
  fase: 'POULE',
  ronda: 'P1',
  rondaOriginal: 'Poule 1',
  refA: `p000${a}`,
  refB: `p000${b}`,
  nombreA: `TIRADOR ${a}`,
  nombreB: `TIRADOR ${b}`,
  puntosA: 5,
  puntosB: 3,
  marcador: 'explicito',
  region: region(2, 300),
  ...extra,
});

const cob = (estado: PruebaPdf['estado'], importado: number, publicado: number | null = importado) => ({
  estado,
  publicado,
  importado,
  motivo: null,
});

function prueba(extra: Partial<PruebaPdf> = {}): PruebaPdf {
  return {
    clave: 'ESPADA-M-INDIVIDUAL-M15',
    cabecera: ['Copa de España', 'Espada masculina M15'],
    arma: 'ESPADA',
    genero: 'M',
    formato: 'INDIVIDUAL',
    categoria: 'M15',
    categoriaOriginal: 'M-15',
    cohorte: null,
    categoriaPublicada: 'M-15',
    fecha: '2019-01-20',
    paginas: [1, 2],
    puestos: [puesto(1), puesto(2)],
    asaltos: [asalto(1, 2)],
    excluidos: { equipo: 0, bye: 0, sinMarcador: 0, sinGanador: 0, incoherente: 0, identidadNoConfirmada: 0, conflicto: 0, duplicado: 0 },
    rechazos: [],
    cobertura: { puestos: cob('completo', 2), poules: cob('completo', 1), cuadro: cob('sin_resultados', 0, 0) },
    estado: 'completo',
    ...extra,
  };
}

function lectura(extra: Partial<LecturaPdf> = {}): LecturaPdf {
  return {
    url: 'https://app.skermo.org/client/1/abc123.pdf',
    docId: 'abc123',
    sha256: 'a'.repeat(64),
    perfil: { bytes: 1000, paginas: 2, items: 50, ms: 10, heapMb: 1 },
    paginas: [],
    pruebas: [prueba()],
    rechazos: [],
    ocr: { necesario: false, paginas: [], ejecutado: false, motivo: null },
    estado: 'completo',
    error: null,
    ...extra,
  };
}

type Estado = {
  pruebas: string[];
  resultados: Map<string, FilaResultado[]>;
  asaltos: Map<string, FilaAsalto[]>;
  coberturas: FilaCoberturaPdf[];
  previo: { status: string; cursor: string | null } | null;
};

function deps(over: Partial<DepsPersistenciaPdf> = {}, estado?: Partial<Estado>): { d: DepsPersistenciaPdf; e: Estado } {
  const e: Estado = { pruebas: [], resultados: new Map(), asaltos: new Map(), coberturas: [], previo: null, ...estado };
  const d: DepsPersistenciaPdf = {
    esquema: async () => ({ identidad: true, referencias: true }),
    categoriasHistoricas: async () => true,
    leerCheckpoint: async () => e.previo,
    upsertPrueba: async (p) => {
      e.pruebas.push(p.competitionKey);
      return `id:${p.competitionKey}`;
    },
    upsertResultados: async (id, filas) => {
      e.resultados.set(id, filas);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertAsaltos: async (id, filas) => {
      e.asaltos.set(id, filas);
      return { nuevos: filas.length, revisados: 0, sinCambios: 0 };
    },
    upsertCobertura: async (f) => {
      e.coberturas.push(f);
    },
    reconciliar: async () => ({ puestosRetirados: 0, asaltosRetirados: 0, pruebasRetiradas: [] }),
    ...over,
  };
  return { d, e };
}

const ctx = { season: '2018-2019' };
const fila = (e: Estado, factKind: string, key?: string) =>
  e.coberturas.filter((c) => c.factKind === factKind && (key === undefined || c.competitionKey === key)).at(-1);

describe('persistirLecturaPdf', () => {
  it('namespacea las referencias locales por documento y prueba y nunca crea persona', async () => {
    const { d, e } = deps();
    const r = await persistirLecturaPdf(d, lectura(), ctx);
    expect(r.estado).toBe('aplicado');
    const [clave] = e.pruebas;
    expect(clave).toBe('pdf:abc123:ESPADA-M-INDIVIDUAL-M15');
    const filas = e.resultados.get(`id:${clave}`) as FilaResultado[];
    expect(filas.every((f) => f.personId === null)).toBe(true);
    expect(filas[0].sourceFactKey).toBe('abc123:ESPADA-M-INDIVIDUAL-M15:p1:y499');
    const asaltos = e.asaltos.get(`id:${clave}`) as FilaAsalto[];
    expect(asaltos[0]).toMatchObject({
      fencerARef: 'abc123:ESPADA-M-INDIVIDUAL-M15:p0001',
      fencerBRef: 'abc123:ESPADA-M-INDIVIDUAL-M15:p0002',
      fencerAPersonId: null,
      fencerBPersonId: null,
    });
    expect(asaltos[0].fencerARef < asaltos[0].fencerBRef).toBe(true);
  });

  it('el mismo p0001 en dos documentos o dos pruebas da claves distintas', async () => {
    const a = deps();
    const b = deps();
    await persistirLecturaPdf(a.d, lectura(), ctx);
    await persistirLecturaPdf(b.d, lectura({ docId: 'otro', url: 'https://app.skermo.org/client/1/otro.pdf' }), ctx);
    const ka = [...a.e.resultados.values()][0].map((f) => f.sourceFactKey);
    const kb = [...b.e.resultados.values()][0].map((f) => f.sourceFactKey);
    expect(ka.filter((k) => kb.includes(k))).toEqual([]);
  });

  it('conserva la página de origen en la URL de cada hecho', async () => {
    const { d, e } = deps();
    await persistirLecturaPdf(d, lectura(), ctx);
    const filas = [...e.resultados.values()][0];
    expect(filas[0].sourceUrl).toBe('https://app.skermo.org/client/1/abc123.pdf#page=1');
    expect([...e.asaltos.values()][0][0].sourceUrl).toBe('https://app.skermo.org/client/1/abc123.pdf#page=2&y=290-310&marcador=explicito');
  });

  it('cobertura por hecho y documento; poules/cuadro ausentes en el documento quedan como no publicados', async () => {
    const { d, e } = deps();
    await persistirLecturaPdf(d, lectura(), ctx);
    const k = 'pdf:abc123:ESPADA-M-INDIVIDUAL-M15';
    expect(fila(e, 'results', k)).toMatchObject({ status: 'completo', importedTotal: 2, cursor: null });
    expect(fila(e, 'pools', k)).toMatchObject({ status: 'completo', importedTotal: 1 });
    expect(fila(e, 'tableau', k)).toMatchObject({ status: 'sin_resultados', cursor: 'no_publicado' });
    expect(fila(e, 'pdf', 'doc:abc123')).toMatchObject({ status: 'completo', importedTotal: 2 });
    const cp = decodificarCheckpointPdf(fila(e, 'pdf', 'doc:abc123')?.cursor);
    expect(cp?.sha256).toBe('a'.repeat(64));
  });

  it('misma huella SHA-256 sin releer: sin cambios, no reescribe nada', async () => {
    const primero = deps();
    await persistirLecturaPdf(primero.d, lectura(), ctx);
    const cursor = fila(primero.e, 'pdf', 'doc:abc123')?.cursor as string;

    const { d, e } = deps({}, { previo: { status: 'completo', cursor } });
    const r = await persistirLecturaPdf(d, lectura(), ctx);
    expect(r.estado).toBe('sin_cambios');
    expect(e.pruebas).toEqual([]);
    expect(e.resultados.size).toBe(0);
    expect(fila(e, 'pdf', 'doc:abc123')).toMatchObject({ status: 'completo' });
    expect(fila(e, 'pdf', 'doc:abc123')?.cursor).toBeUndefined();
  });

  it('misma huella con releer, o huella distinta (documento corregido), vuelve a escribir', async () => {
    const primero = deps();
    await persistirLecturaPdf(primero.d, lectura(), ctx);
    const cursor = fila(primero.e, 'pdf', 'doc:abc123')?.cursor as string;

    const releido = deps({}, { previo: { status: 'completo', cursor } });
    expect((await persistirLecturaPdf(releido.d, lectura(), ctx, { releer: true })).estado).toBe('aplicado');
    expect(releido.e.pruebas).toHaveLength(1);

    const corregido = deps({}, { previo: { status: 'completo', cursor } });
    const r = await persistirLecturaPdf(corregido.d, lectura({ sha256: 'b'.repeat(64) }), ctx);
    expect(r.estado).toBe('aplicado');
    expect(corregido.e.resultados.size).toBe(1);
  });

  it('error técnico, límite o host no admitido: queda reanudable con motivo y no toca el checkpoint previo', async () => {
    const casos: [string, string, string][] = [
      ['HTTP 503 al pedir el PDF', 'error', 'tecnico'],
      ['El PDF pesa 99999999 bytes y el límite es 26214400', 'pendiente', 'limite'],
      ['El PDF tiene 500 páginas y el límite es 400', 'pendiente', 'limite'],
      ['Origen no permitido para un PDF de resultados: evil.example', 'pendiente', 'host_no_admitido'],
    ];
    for (const [error, status, motivo] of casos) {
      const { d, e } = deps();
      const r = await persistirLecturaPdf(
        d,
        lectura({ estado: 'error', error, sha256: null, perfil: null, pruebas: [] }),
        ctx,
      );
      expect(r.estado).toBe('documento_no_leido');
      expect(r.motivo).toBe(motivo);
      expect(e.pruebas).toEqual([]);
      const f = fila(e, 'pdf', 'doc:abc123');
      expect(f?.status).toBe(status);
      expect(f?.lastError).toContain(error);
      expect(f?.cursor).toBeUndefined();
      expect(f?.publishedTotal).toBeUndefined();
    }
  });

  it('prueba con cabecera incompleta: no crea prueba ni puestos, queda en revisión con motivo, página y huella', async () => {
    const sinGenero = prueba({ clave: 'SIN-GENERO', genero: null, puestos: [puesto(1)], asaltos: [], paginas: [3] });
    const { d, e } = deps();
    const r = await persistirLecturaPdf(d, lectura({ pruebas: [prueba(), sinGenero] }), ctx);
    expect(e.pruebas).toEqual(['pdf:abc123:ESPADA-M-INDIVIDUAL-M15']);
    expect(r.revision).toEqual([expect.objectContaining({ clave: 'SIN-GENERO', motivo: 'cabecera_incompleta:genero', paginas: [3] })]);
    const doc = fila(e, 'pdf', 'doc:abc123');
    expect(doc?.status).toBe('parcial');
    const cp = decodificarCheckpointPdf(doc?.cursor);
    expect(cp?.sha256).toBe('a'.repeat(64));
    expect(cp?.revision[0]).toMatchObject({ clave: 'SIN-GENERO', paginas: [3] });
  });

  it('rechazos del documento y OCR necesario (no ejecutado) dejan el documento parcial con su región', async () => {
    const { d, e } = deps();
    await persistirLecturaPdf(
      d,
      lectura({
        rechazos: [{ seccion: 'pagina', region: region(4, 200), motivo: 'Layout no parseable' }],
        ocr: { necesario: true, paginas: [5], ejecutado: false, motivo: 'Página sin texto' },
      }),
      ctx,
    );
    const doc = fila(e, 'pdf', 'doc:abc123');
    expect(doc?.status).toBe('parcial');
    const cp = decodificarCheckpointPdf(doc?.cursor);
    expect(cp?.rechazos[0]).toMatchObject({ motivo: 'Layout no parseable', region: { pagina: 4 } });
    expect(cp?.ocr).toEqual({ necesario: true, paginas: [5] });
    expect(doc?.lastError).toContain('OCR');
  });

  it('no trunca en silencio: guarda hasta 50 motivos y declara el total', async () => {
    const rechazos = Array.from({ length: 60 }, (_, i) => ({ seccion: 'pagina' as const, region: region(i + 1), motivo: `m${i}` }));
    const { d, e } = deps();
    await persistirLecturaPdf(d, lectura({ rechazos }), ctx);
    const cp = decodificarCheckpointPdf(fila(e, 'pdf', 'doc:abc123')?.cursor);
    expect(cp?.rechazos).toHaveLength(50);
    expect(cp?.rechazosTotal).toBe(60);
  });

  it('categoría M10/M12 sin la migración 0019 no se guarda como otra: pendiente con motivo', async () => {
    const { d, e } = deps({ categoriasHistoricas: async () => false });
    const r = await persistirLecturaPdf(d, lectura({ pruebas: [prueba({ categoria: 'M10', categoriaOriginal: 'M-10' })] }), ctx);
    expect(e.pruebas).toEqual([]);
    expect(r.revision[0].motivo).toBe('categoria_pendiente_migracion_0019');
    expect(fila(e, 'pdf', 'doc:abc123')?.status).toBe('pendiente');
    expect(fila(e, 'pdf', 'doc:abc123')?.lastError).toContain('0019');
  });

  it('esquema 0017 sin aplicar: no escribe nada', async () => {
    const { d, e } = deps({ esquema: async () => ({ identidad: false, referencias: false }) });
    const r = await persistirLecturaPdf(d, lectura(), ctx);
    expect(r.estado).toBe('esquema_no_aplicado');
    expect(e.coberturas).toEqual([]);
  });

  it('equipos: se guardan sus puestos sin personas ni asaltos individuales', async () => {
    const equipos = prueba({ formato: 'EQUIPOS', asaltos: [], cobertura: { puestos: cob('completo', 2), poules: cob('sin_resultados', 0, 0), cuadro: cob('sin_resultados', 0, 0) } });
    const { d, e } = deps();
    await persistirLecturaPdf(d, lectura({ pruebas: [equipos] }), ctx);
    expect(e.asaltos.size).toBe(0);
    expect([...e.resultados.values()][0].every((f) => f.personId === null)).toBe(true);
  });

  it('una prueba sin hechos publicados y sin lectura que lo acredite no se marca no_publicado', async () => {
    const dudosa = prueba({ cobertura: { puestos: cob('completo', 2), poules: cob('parcial', 0, null), cuadro: cob('error', 0, null) }, asaltos: [] });
    const { d, e } = deps();
    await persistirLecturaPdf(d, lectura({ pruebas: [dudosa] }), ctx);
    const k = 'pdf:abc123:ESPADA-M-INDIVIDUAL-M15';
    expect(fila(e, 'pools', k)).toMatchObject({ status: 'parcial', cursor: null });
    expect(fila(e, 'tableau', k)).toMatchObject({ status: 'error', cursor: null });
  });
});
