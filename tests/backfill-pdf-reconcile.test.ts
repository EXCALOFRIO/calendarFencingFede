import { describe, expect, it } from 'vitest';
import {
  decodificarCheckpointPdf,
  persistirLecturaPdf,
  type ClaveAsalto,
  type DepsPersistenciaPdf,
  type FilaCoberturaPdf,
  type PruebaPdfPersistible,
} from '@/lib/ingest/backfill/pdf-persist';
import type { FilaAsalto, FilaResultado, ResumenEscritura } from '@/lib/ingest/fie-resultados-persist';
import type { AsaltoPdf, LecturaPdf, PruebaPdf, PuestoPdf, Region } from '@/lib/ingest/sources/rfee-pdf/tipos';

/**
 * Almacén EN MEMORIA que imita el contrato de `pdf-db.ts`: claves naturales
 * reales (competición+fuente+clave del hecho, y fase+ronda+refs del asalto),
 * revisión sólo si cambia el hash, ACUMULA filas como la base y la cobertura
 * conserva cifras y checkpoint cuando llegan `undefined`. Es una simulación:
 * no demuestra SQL contra Neon.
 */

const URL_DOC = 'https://app.skermo.org/client/1/abc123.pdf';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

const region = (pagina: number, y: number): Region => ({ pagina, yMax: y + 10, yMin: y - 10 });

const puesto = (n: number, pagina = 1, extra: Partial<PuestoPdf> = {}): PuestoPdf => ({
  sourceFactKey: `pdf:p${pagina}:y${500 - n * 20}`,
  ref: `p${String(n).padStart(4, '0')}`,
  posicion: n,
  posicionRaw: null,
  nombre: `TIRADOR ${n}`,
  club: 'CLUB',
  region: region(pagina, 500 - n * 20),
  ...extra,
});

const asalto = (a: number, b: number, extra: Partial<AsaltoPdf> = {}): AsaltoPdf => ({
  fase: 'POULE',
  ronda: 'P1',
  rondaOriginal: 'Poule 1',
  refA: `p${String(a).padStart(4, '0')}`,
  refB: `p${String(b).padStart(4, '0')}`,
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
  const puestos = extra.puestos ?? [puesto(1), puesto(2), puesto(3)];
  const asaltos = extra.asaltos ?? [asalto(1, 2), asalto(1, 3), asalto(2, 3)];
  return {
    clave: 'abc123:ESPADA:M:INDIVIDUAL:M15:',
    cabecera: ['Copa de España', 'Espada masculina M15', '20 ene 2019'],
    arma: 'ESPADA',
    genero: 'M',
    formato: 'INDIVIDUAL',
    categoria: 'M15',
    categoriaOriginal: 'M-15',
    cohorte: null,
    categoriaPublicada: 'M-15',
    fecha: '2019-01-20',
    paginas: [1, 2],
    puestos,
    asaltos,
    excluidos: { equipo: 0, bye: 0, sinMarcador: 0, sinGanador: 0, incoherente: 0, identidadNoConfirmada: 0, conflicto: 0, duplicado: 0 },
    rechazos: [],
    cobertura: { puestos: cob('completo', puestos.length), poules: cob('completo', asaltos.length), cuadro: cob('sin_resultados', 0, 0) },
    estado: 'completo',
    ...extra,
  };
}

function lectura(extra: Partial<LecturaPdf> = {}): LecturaPdf {
  return {
    url: URL_DOC,
    docId: 'abc123',
    sha256: SHA_A,
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

type FilaGuardada<T> = T & { competitionId: string; revision: number };

function almacen() {
  const ediciones = new Map<string, PruebaPdfPersistible['edicion']>();
  const competiciones = new Map<string, { id: string; edicionKey: string; fecha: string | null; nombre: string }>();
  const resultados = new Map<string, FilaGuardada<FilaResultado>>();
  const asaltos = new Map<string, FilaGuardada<FilaAsalto>>();
  const cobertura = new Map<string, FilaCoberturaPdf & { intentos: number }>();

  const claveAsalto = (id: string, k: ClaveAsalto) => `${id}|${k.phase}|${k.roundKey}|${k.fencerARef}|${k.fencerBRef}`;

  const d: DepsPersistenciaPdf = {
    esquema: async () => ({ identidad: true, referencias: true }),
    categoriasHistoricas: async () => true,
    async leerCheckpoint(season, docKey) {
      const f = cobertura.get(`${season}|pdf|${docKey}`);
      return f ? { status: f.status, cursor: f.cursor ?? null, lastError: f.lastError } : null;
    },
    async upsertPrueba(p) {
      // Como el INSERT … ON CONFLICT real: la última escritura de la edición gana.
      ediciones.set(p.edicionKey, p.edicion);
      const id = `id:${p.competitionKey}`;
      competiciones.set(p.competitionKey, { id, edicionKey: p.edicionKey, fecha: p.fecha, nombre: p.nombre });
      return id;
    },
    async upsertResultados(competitionId, filas) {
      const r: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) {
        const k = `${competitionId}|${f.sourceFactKey}`;
        const previa = resultados.get(k);
        if (!previa) {
          resultados.set(k, { ...f, competitionId, revision: 1 });
          r.nuevos += 1;
        } else if (previa.contentHash !== f.contentHash) {
          resultados.set(k, { ...f, competitionId, revision: previa.revision + 1 });
          r.revisados += 1;
        } else r.sinCambios += 1;
      }
      return r;
    },
    async upsertAsaltos(competitionId, filas) {
      const r: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) {
        const k = claveAsalto(competitionId, { phase: f.phase, roundKey: f.roundKey, fencerARef: f.fencerARef, fencerBRef: f.fencerBRef });
        const previa = asaltos.get(k);
        if (!previa) {
          asaltos.set(k, { ...f, competitionId, revision: 1 });
          r.nuevos += 1;
        } else if (previa.contentHash !== f.contentHash) {
          asaltos.set(k, { ...f, competitionId, revision: previa.revision + 1 });
          r.revisados += 1;
        } else r.sinCambios += 1;
      }
      return r;
    },
    async upsertCobertura(f) {
      const k = `${f.season}|${f.factKind}|${f.competitionKey}`;
      const previa = cobertura.get(k);
      cobertura.set(k, {
        ...f,
        publishedTotal: f.publishedTotal === undefined ? previa?.publishedTotal : f.publishedTotal,
        importedTotal: f.importedTotal === undefined ? previa?.importedTotal : f.importedTotal,
        cursor: f.cursor === undefined ? previa?.cursor : f.cursor,
        intentos: (previa?.intentos ?? 0) + 1,
      });
    },
    async reconciliar({ docId, vigentes }) {
      const prefijo = `pdf:${docId}:`;
      const porId = new Map(vigentes.map((v) => [v.competitionId, v]));
      let puestosRetirados = 0;
      let asaltosRetirados = 0;
      const pruebasRetiradas: { competitionKey: string; competitionId: string }[] = [];
      for (const [competitionKey, c] of competiciones) {
        if (!competitionKey.startsWith(prefijo)) continue;
        const v = porId.get(c.id);
        if (!v) pruebasRetiradas.push({ competitionKey, competitionId: c.id });
        const claves = new Set((v?.resultados ?? []).map((k) => `${c.id}|${k}`));
        for (const k of [...resultados.keys()]) {
          if (k.startsWith(`${c.id}|`) && !claves.has(k)) {
            resultados.delete(k);
            puestosRetirados += 1;
          }
        }
        const clavesA = new Set((v?.asaltos ?? []).map((k) => claveAsalto(c.id, k)));
        for (const k of [...asaltos.keys()]) {
          if (k.startsWith(`${c.id}|`) && !clavesA.has(k)) {
            asaltos.delete(k);
            asaltosRetirados += 1;
          }
        }
      }
      return { puestosRetirados, asaltosRetirados, pruebasRetiradas };
    },
  };
  const filasDe = (id: string) => [...resultados.values()].filter((f) => f.competitionId === id);
  const asaltosDe = (id: string) => [...asaltos.values()].filter((f) => f.competitionId === id);
  const doc = () => cobertura.get('2018-2019|pdf|doc:abc123');
  return { d, ediciones, competiciones, resultados, asaltos, cobertura, filasDe, asaltosDe, doc };
}

const ctx = { season: '2018-2019' };
const ID = 'id:pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M15:';

describe('relectura de un documento con otra huella (almacén acumulativo)', () => {
  it('una fila que se mueve de página no duplica el puesto: queda sólo la lectura nueva', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), ctx);
    expect(a.filasDe(ID)).toHaveLength(3);

    const movida = prueba({ puestos: [puesto(1), puesto(2), puesto(3, 3)], paginas: [1, 2, 3] });
    const r = await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, pruebas: [movida] }), ctx);

    const filas = a.filasDe(ID);
    expect(filas).toHaveLength(3);
    expect(filas.map((f) => f.sourceFactKey).sort()).toEqual(
      movida.puestos.map((p) => `abc123:${movida.clave}:${p.sourceFactKey}`).sort(),
    );
    expect(r.retirados?.puestos).toBe(1);
    expect(decodificarCheckpointPdf(a.doc()?.cursor)?.sha256).toBe(SHA_B);
  });

  it('un marcador corregido actualiza el mismo asalto, sin duplicarlo', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), ctx);
    const corregida = prueba({ asaltos: [asalto(1, 2, { puntosA: 5, puntosB: 4 }), asalto(1, 3), asalto(2, 3)] });
    await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, pruebas: [corregida] }), ctx);

    const bouts = a.asaltosDe(ID);
    expect(bouts).toHaveLength(3);
    const b = bouts.find((x) => x.fencerBRef.endsWith('p0002'));
    expect(b).toMatchObject({ scoreA: 5, scoreB: 4, revision: 2 });
  });

  it('una corrección sólo de fecha cambia el hash del asalto y lo revisa', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), ctx);
    const fechaCorregida = prueba({ fecha: '2019-01-21' });
    await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, pruebas: [fechaCorregida] }), ctx);

    const bouts = a.asaltosDe(ID);
    expect(bouts).toHaveLength(3);
    expect(bouts.every((b) => b.revision === 2 && b.occurredOn === '2019-01-21')).toBe(true);
  });

  it('un asalto que pasa a estar en conflicto deja de estar vigente', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), ctx);
    const enConflicto = prueba({
      asaltos: [asalto(1, 3), asalto(2, 3)],
      excluidos: { equipo: 0, bye: 0, sinMarcador: 0, sinGanador: 0, incoherente: 0, identidadNoConfirmada: 0, conflicto: 2, duplicado: 0 },
      cobertura: {
        puestos: cob('completo', 3),
        poules: { estado: 'conflicto', publicado: 3, importado: 2, motivo: 'Un mismo asalto con marcadores distintos' },
        cuadro: cob('sin_resultados', 0, 0),
      },
      estado: 'conflicto',
    });
    const r = await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, estado: 'conflicto', pruebas: [enConflicto] }), ctx);

    expect(a.asaltosDe(ID).map((b) => b.fencerBRef.slice(-5))).toEqual(['p0003', 'p0003']);
    expect(a.asaltosDe(ID).some((b) => b.fencerARef.endsWith('p0001') && b.fencerBRef.endsWith('p0002'))).toBe(false);
    expect(r.retirados?.asaltos).toBe(1);
    expect(a.doc()?.status).toBe('conflicto');
  });

  it('un error técnico conserva los últimos hechos y el checkpoint válidos', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), ctx);
    const antes = a.doc()?.cursor;
    const r = await persistirLecturaPdf(
      a.d,
      lectura({ estado: 'error', error: 'HTTP 503 al pedir el PDF', sha256: null, perfil: null, pruebas: [] }),
      ctx,
    );
    expect(r.estado).toBe('documento_no_leido');
    expect(a.filasDe(ID)).toHaveLength(3);
    expect(a.asaltosDe(ID)).toHaveLength(3);
    expect(a.doc()?.status).toBe('error');
    expect(a.doc()?.cursor).toBe(antes);
  });

  it('una prueba que ya no aparece en el documento retira sus hechos y marca su cobertura', async () => {
    const a = almacen();
    const m12 = prueba({
      clave: 'abc123:ESPADA:M:INDIVIDUAL:M12:',
      categoria: 'M12',
      categoriaOriginal: 'M-12',
      puestos: [puesto(1, 4)],
      asaltos: [],
      paginas: [4],
      cobertura: { puestos: cob('completo', 1), poules: cob('sin_resultados', 0, 0), cuadro: cob('sin_resultados', 0, 0) },
    });
    await persistirLecturaPdf(a.d, lectura({ pruebas: [prueba(), m12] }), ctx);
    expect(a.filasDe('id:pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M12:')).toHaveLength(1);

    const r = await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, pruebas: [prueba()] }), ctx);
    expect(a.filasDe('id:pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M12:')).toHaveLength(0);
    expect(a.filasDe(ID)).toHaveLength(3);
    expect(r.retirados?.pruebas).toBe(1);
    const k = 'pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M12:';
    expect(a.cobertura.get(`2018-2019|results|${k}`)).toMatchObject({ status: 'sin_resultados', importedTotal: 0 });
  });

  it('una corrección que no se puede aplicar con seguridad queda en revisión, sin retirar nada ni aceptar la huella', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), ctx);

    const dudosa = prueba({
      puestos: [puesto(1), puesto(2)],
      rechazos: [{ seccion: 'puestos', region: region(1, 440), motivo: 'Fila de clasificación no atribuible a nombre y club' }],
      cobertura: { puestos: cob('parcial', 2, 3), poules: cob('completo', 3), cuadro: cob('sin_resultados', 0, 0) },
      estado: 'parcial',
    });
    const r = await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, estado: 'parcial', pruebas: [dudosa] }), ctx);

    expect(r.estado).toBe('correccion_en_revision');
    expect(a.filasDe(ID)).toHaveLength(3);
    expect(a.asaltosDe(ID)).toHaveLength(3);
    expect(a.doc()?.status).toBe('conflicto');
    expect(a.doc()?.lastError).toContain('correccion_pendiente_revision');
    const cp = decodificarCheckpointPdf(a.doc()?.cursor);
    expect(cp?.sha256).toBeNull();
    expect(cp?.correccion).toMatchObject({ shaPrevio: SHA_A, shaNuevo: SHA_B });

    const otra = await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, estado: 'parcial', pruebas: [dudosa] }), ctx);
    expect(otra.estado).toBe('correccion_en_revision');

    const limpia = await persistirLecturaPdf(a.d, lectura({ sha256: SHA_C, pruebas: [prueba({ puestos: [puesto(1), puesto(2)], asaltos: [asalto(1, 2)] })] }), ctx);
    expect(limpia.estado).toBe('aplicado');
    expect(a.filasDe(ID)).toHaveLength(2);
    expect(decodificarCheckpointPdf(a.doc()?.cursor)?.sha256).toBe(SHA_C);
  });

  it('la primera lectura con rechazos no es una corrección: escribe y queda parcial', async () => {
    const a = almacen();
    const r = await persistirLecturaPdf(
      a.d,
      lectura({ rechazos: [{ seccion: 'pagina', region: region(5, 100), motivo: 'Layout no parseable' }] }),
      ctx,
    );
    expect(r.estado).toBe('aplicado');
    expect(a.doc()?.status).toBe('parcial');
    expect(a.filasDe(ID)).toHaveLength(3);
  });
});

describe('hechos de un asalto aceptado', () => {
  it('guarda página, región y marcador en la URL de origen', async () => {
    const a = almacen();
    const p = prueba({
      asaltos: [
        asalto(1, 2, { region: region(2, 300), marcador: 'explicito' }),
        asalto(1, 3, { region: region(3, 120), marcador: 'derivado_de_totales' }),
      ],
    });
    await persistirLecturaPdf(a.d, lectura({ pruebas: [p] }), ctx);
    const urls = a.asaltosDe(ID).map((b) => b.sourceUrl).sort();
    expect(urls).toEqual([`${URL_DOC}#page=2&y=290-310&marcador=explicito`, `${URL_DOC}#page=3&y=110-130&marcador=derivado_de_totales`]);
  });

  it('el marcador forma parte del hash: pasar de explícito a derivado revisa el hecho', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura({ pruebas: [prueba({ asaltos: [asalto(1, 2)] })] }), ctx);
    await persistirLecturaPdf(
      a.d,
      lectura({ sha256: SHA_B, pruebas: [prueba({ asaltos: [asalto(1, 2, { marcador: 'derivado_de_totales' })] })] }),
      ctx,
    );
    expect(a.asaltosDe(ID)[0].revision).toBe(2);
  });
});

describe('edición decidida una sola vez por documento', () => {
  const criterium = (): PruebaPdf[] => [
    prueba({
      clave: 'abc123:ESPADA:M:INDIVIDUAL:M10:',
      cabecera: ['Criterium Nacional', 'Espada masculina M-10', '15 jun 2019'],
      categoria: 'M10',
      categoriaOriginal: 'M-10',
      fecha: '2019-06-15',
      paginas: [1],
      puestos: [puesto(1, 1)],
      asaltos: [],
      cobertura: { puestos: cob('completo', 1), poules: cob('sin_resultados', 0, 0), cuadro: cob('sin_resultados', 0, 0) },
    }),
    prueba({
      clave: 'abc123:ESPADA:M:INDIVIDUAL:M12:',
      cabecera: ['Criterium Nacional', 'Espada masculina M-12', '16 jun 2019'],
      categoria: 'M12',
      categoriaOriginal: 'M-12',
      fecha: '2019-06-16',
      paginas: [2],
      puestos: [puesto(1, 2)],
      asaltos: [],
      cobertura: { puestos: cob('completo', 1), poules: cob('sin_resultados', 0, 0), cuadro: cob('sin_resultados', 0, 0) },
    }),
  ];

  for (const orden of ['M10 primero', 'M12 primero'] as const) {
    it(`rango de fechas de todas las pruebas, ${orden}`, async () => {
      const a = almacen();
      const pruebas = orden === 'M10 primero' ? criterium() : criterium().reverse();
      await persistirLecturaPdf(a.d, lectura({ pruebas }), ctx);
      expect(a.ediciones.get('pdf:abc123')).toMatchObject({
        nombre: 'Criterium Nacional',
        inicio: '2019-06-15',
        fin: '2019-06-16',
      });
      expect(a.competiciones.get('pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M10:')?.fecha).toBe('2019-06-15');
      expect(a.competiciones.get('pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M12:')?.fecha).toBe('2019-06-16');
    });
  }

  it('la fecha de una prueba en revisión también cuenta para el rango y su cabecera queda en el checkpoint', async () => {
    const a = almacen();
    const [m10, m12] = criterium();
    const sinGenero = { ...m12, genero: null };
    await persistirLecturaPdf(a.d, lectura({ pruebas: [m10, sinGenero] }), ctx);
    expect(a.ediciones.get('pdf:abc123')).toMatchObject({ inicio: '2019-06-15', fin: '2019-06-16' });
    const cp = decodificarCheckpointPdf(a.doc()?.cursor);
    expect(cp?.pruebas?.map((p) => [p.clave, p.cabecera[1], p.fecha])).toEqual([
      ['abc123:ESPADA:M:INDIVIDUAL:M10:', 'Espada masculina M-10', '2019-06-15'],
      ['abc123:ESPADA:M:INDIVIDUAL:M12:', 'Espada masculina M-12', '2019-06-16'],
    ]);
  });

  it('cabeceras distintas: cada prueba conserva la suya y la edición usa el título de la fila verificada', async () => {
    const a = almacen();
    const [m10, m12] = criterium();
    const otra = { ...m12, cabecera: ['Open Levante', ...m12.cabecera.slice(1)] };
    await persistirLecturaPdf(a.d, lectura({ pruebas: [m10, otra] }), { ...ctx, titulo: 'Criterium M10/M12 15-16 junio' });
    expect(a.competiciones.get('pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M10:')?.nombre).toBe('Criterium Nacional');
    expect(a.competiciones.get('pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M12:')?.nombre).toBe('Open Levante');
    expect(a.ediciones.get('pdf:abc123')?.nombre).toBe('Criterium M10/M12 15-16 junio');
  });
});

describe('referencia a la fila original del inventario', () => {
  it('conserva índice, referencia original y URL de la fila en el checkpoint', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), { ...ctx, indice: 7, refOriginal: 'doc-7', sourceUrl: URL_DOC });
    const cp = decodificarCheckpointPdf(a.doc()?.cursor);
    expect(cp?.origen).toEqual({ indice: 7, refOriginal: 'doc-7', sourceUrl: URL_DOC });
  });

  it('el título de la fila sólo sustituye a la cabecera ausente de un documento de una sola prueba', async () => {
    const solo = almacen();
    await persistirLecturaPdf(solo.d, lectura({ pruebas: [prueba({ cabecera: [] })] }), { ...ctx, titulo: 'Fila: Copa Mediterráneo' });
    expect([...solo.competiciones.values()][0].nombre).toBe('Fila: Copa Mediterráneo');

    const varias = almacen();
    const dos = [
      prueba({ cabecera: [] }),
      prueba({ clave: 'abc123:ESPADA:F:INDIVIDUAL:M15:', genero: 'F', cabecera: [], puestos: [puesto(1)], asaltos: [] }),
    ];
    await persistirLecturaPdf(varias.d, lectura({ pruebas: dos }), { ...ctx, titulo: 'Fila: Copa Mediterráneo' });
    expect([...varias.competiciones.values()].map((c) => c.nombre)).toEqual(['RFEE abc123', 'RFEE abc123']);
  });
});
