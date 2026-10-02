import { describe, expect, it } from 'vitest';
import {
  decodificarCheckpointPdf,
  persistirLecturaPdf,
  type ClaveAsalto,
  type DepsPersistenciaPdf,
  type FilaCoberturaPdf,
} from '@/lib/ingest/backfill/pdf-persist';
import type { FilaAsalto, FilaResultado, ResumenEscritura } from '@/lib/ingest/fie-resultados-persist';
import type { AsaltoPdf, LecturaPdf, PruebaPdf, PuestoPdf, Region } from '@/lib/ingest/sources/rfee-pdf/tipos';

/**
 * Relectura de un PDF con la fila del inventario ausente y correcciones con
 * fallos tardíos. El almacén es una simulación en memoria con claves naturales
 * y upsert acumulativo (cobertura conserva cifras/checkpoint ante `undefined`);
 * no demuestra SQL contra Neon.
 */

const URL_DOC = 'https://app.skermo.org/client/1/abc123.pdf';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ctx = { season: '2018-2019' };
const ID = 'id:pdf:abc123:abc123:ESPADA:M:INDIVIDUAL:M15:';

const region = (pagina: number, y: number): Region => ({ pagina, yMax: y + 10, yMin: y - 10 });
const puesto = (n: number): PuestoPdf => ({
  sourceFactKey: `pdf:p1:y${500 - n * 20}`,
  ref: `p${String(n).padStart(4, '0')}`,
  posicion: n,
  posicionRaw: null,
  nombre: `TIRADOR ${n}`,
  club: 'CLUB',
  region: region(1, 500 - n * 20),
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
const cob = (estado: PruebaPdf['estado'], importado: number) => ({ estado, publicado: importado, importado, motivo: null });

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
    cobertura: { puestos: cob('completo', puestos.length), poules: cob('completo', asaltos.length), cuadro: { estado: 'sin_resultados', publicado: 0, importado: 0, motivo: null } },
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

type Fallos = {
  upsertAsaltos?: boolean;
  reconciliar?: boolean;
  /** Falla la escritura del checkpoint final (la fila `pdf` que acepta la huella). */
  checkpointFinal?: boolean;
};

function almacen() {
  const fallos: Fallos = {};
  const ediciones = new Map<string, { nombre: string }>();
  const resultados = new Map<string, FilaResultado & { competitionId: string }>();
  const asaltos = new Map<string, FilaAsalto & { competitionId: string }>();
  const cobertura = new Map<string, FilaCoberturaPdf>();
  const claveAsalto = (id: string, k: ClaveAsalto) => `${id}|${k.phase}|${k.roundKey}|${k.fencerARef}|${k.fencerBRef}`;
  const doc = () => cobertura.get('2018-2019|pdf|doc:abc123');
  const instantaneas: { en: string; doc: FilaCoberturaPdf | undefined }[] = [];

  const d: DepsPersistenciaPdf = {
    esquema: async () => ({ identidad: true, referencias: true }),
    categoriasHistoricas: async () => true,
    async leerCheckpoint(season, docKey) {
      const f = cobertura.get(`${season}|pdf|${docKey}`);
      return f ? { status: f.status, cursor: f.cursor ?? null, lastError: f.lastError } : null;
    },
    async upsertPrueba(p) {
      ediciones.set(p.edicionKey, { nombre: p.edicion.nombre });
      instantaneas.push({ en: 'upsertPrueba', doc: doc() });
      return `id:${p.competitionKey}`;
    },
    async upsertResultados(competitionId, filas) {
      const r: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) {
        const k = `${competitionId}|${f.sourceFactKey}`;
        const previa = resultados.get(k);
        resultados.set(k, { ...f, competitionId });
        if (!previa) r.nuevos += 1;
        else if (previa.contentHash !== f.contentHash) r.revisados += 1;
        else r.sinCambios += 1;
      }
      return r;
    },
    async upsertAsaltos(competitionId, filas) {
      if (fallos.upsertAsaltos) throw new Error('conexión perdida al escribir asaltos');
      const r: ResumenEscritura = { nuevos: 0, revisados: 0, sinCambios: 0 };
      for (const f of filas) {
        const k = claveAsalto(competitionId, { phase: f.phase, roundKey: f.roundKey, fencerARef: f.fencerARef, fencerBRef: f.fencerBRef });
        const previa = asaltos.get(k);
        asaltos.set(k, { ...f, competitionId });
        if (!previa) r.nuevos += 1;
        else if (previa.contentHash !== f.contentHash) r.revisados += 1;
        else r.sinCambios += 1;
      }
      return r;
    },
    async upsertCobertura(f) {
      const cp = decodificarCheckpointPdf(f.cursor);
      if (fallos.checkpointFinal && f.factKind === 'pdf' && cp?.sha256 && cp.sha256 !== SHA_A) {
        throw new Error('conexión perdida al escribir el checkpoint');
      }
      const k = `${f.season}|${f.factKind}|${f.competitionKey}`;
      const previa = cobertura.get(k);
      cobertura.set(k, {
        ...f,
        publishedTotal: f.publishedTotal === undefined ? previa?.publishedTotal : f.publishedTotal,
        importedTotal: f.importedTotal === undefined ? previa?.importedTotal : f.importedTotal,
        cursor: f.cursor === undefined ? previa?.cursor : f.cursor,
      });
    },
    async reconciliar({ vigentes }) {
      if (fallos.reconciliar) throw new Error('conexión perdida al retirar hechos');
      let puestosRetirados = 0;
      let asaltosRetirados = 0;
      for (const v of vigentes) {
        const claves = new Set(v.resultados.map((k) => `${v.competitionId}|${k}`));
        for (const k of [...resultados.keys()]) {
          if (k.startsWith(`${v.competitionId}|`) && !claves.has(k)) {
            resultados.delete(k);
            puestosRetirados += 1;
          }
        }
        const clavesA = new Set(v.asaltos.map((k) => claveAsalto(v.competitionId, k)));
        for (const k of [...asaltos.keys()]) {
          if (k.startsWith(`${v.competitionId}|`) && !clavesA.has(k)) {
            asaltos.delete(k);
            asaltosRetirados += 1;
          }
        }
      }
      return { puestosRetirados, asaltosRetirados, pruebasRetiradas: [] };
    },
  };
  const filasDe = (id: string) => [...resultados.values()].filter((f) => f.competitionId === id);
  const asaltosDe = (id: string) => [...asaltos.values()].filter((f) => f.competitionId === id);
  return { d, fallos, ediciones, cobertura, doc, filasDe, asaltosDe, instantaneas };
}

const segunda = (): PruebaPdf =>
  prueba({
    clave: 'abc123:FLORETE:F:INDIVIDUAL:M15:',
    cabecera: ['Otro título', 'Florete femenino M15', '21 ene 2019'],
    arma: 'FLORETE',
    genero: 'F',
    puestos: [puesto(1)],
    asaltos: [],
    cobertura: { puestos: cob('completo', 1), poules: cob('sin_resultados', 0), cuadro: cob('sin_resultados', 0) },
  });

describe('relectura con el contexto del inventario ausente', () => {
  const origenCompleto = { season: '2018-2019', indice: 7, refOriginal: 'catalogo:42', titulo: 'Copa verificada', sourceUrl: URL_DOC };

  it('--releer sin contexto conserva índice, referencia original y título del checkpoint previo', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura({ pruebas: [prueba(), segunda()] }), origenCompleto);
    const nombreInicial = [...a.ediciones.values()][0].nombre;
    expect(nombreInicial).toBe('Copa verificada');

    await persistirLecturaPdf(a.d, lectura({ pruebas: [prueba(), segunda()] }), ctx, { releer: true });
    const cp = decodificarCheckpointPdf(a.doc()?.cursor);
    expect(cp?.origen).toMatchObject({ indice: 7, refOriginal: 'catalogo:42', sourceUrl: URL_DOC, titulo: 'Copa verificada' });
    expect([...a.ediciones.values()][0].nombre).toBe(nombreInicial);
  });

  it('una corrección con otra huella sin contexto tampoco pierde la evidencia ni cambia la edición', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura({ pruebas: [prueba(), segunda()] }), origenCompleto);
    await persistirLecturaPdf(a.d, lectura({ sha256: SHA_B, pruebas: [prueba(), segunda()] }), ctx);
    const cp = decodificarCheckpointPdf(a.doc()?.cursor);
    expect(cp?.sha256).toBe(SHA_B);
    expect(cp?.origen).toMatchObject({ indice: 7, refOriginal: 'catalogo:42', titulo: 'Copa verificada' });
    expect([...a.ediciones.values()][0].nombre).toBe('Copa verificada');
  });

  it('un contexto nuevo con datos sustituye al anterior', async () => {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), origenCompleto);
    await persistirLecturaPdf(a.d, lectura(), { ...origenCompleto, indice: 9 }, { releer: true });
    expect(decodificarCheckpointPdf(a.doc()?.cursor)?.origen).toMatchObject({ indice: 9, refOriginal: 'catalogo:42' });
  });

  it('el checkpoint sembrado por el descubrimiento aporta el origen y no cuenta como una corrección', async () => {
    const a = almacen();
    a.cobertura.set('2018-2019|pdf|doc:abc123', {
      season: '2018-2019',
      factKind: 'pdf',
      competitionKey: 'doc:abc123',
      competitionId: null,
      status: 'pendiente',
      sourceUrl: URL_DOC,
      lastError: null,
      cursor: JSON.stringify({
        v: 1,
        sha256: null,
        semilla: true,
        origen: { indice: 3, refOriginal: 'catalogo:9', sourceUrl: URL_DOC, titulo: 'Copa sembrada' },
      }),
    });
    const dudosa = prueba({
      puestos: [puesto(1), puesto(2)],
      rechazos: [{ seccion: 'puestos', region: region(1, 440), motivo: 'Fila no atribuible' }],
      cobertura: { puestos: { estado: 'parcial', publicado: 3, importado: 2, motivo: null }, poules: cob('completo', 3), cuadro: cob('sin_resultados', 0) },
      estado: 'parcial',
    });
    const r = await persistirLecturaPdf(a.d, lectura({ estado: 'parcial', pruebas: [dudosa] }), ctx);
    expect(r.estado).toBe('aplicado');
    expect(a.filasDe(ID)).toHaveLength(2);
    expect(a.doc()?.status).toBe('parcial');
    expect(decodificarCheckpointPdf(a.doc()?.cursor)?.origen).toMatchObject({ indice: 3, refOriginal: 'catalogo:9', titulo: 'Copa sembrada' });
  });
});

describe('corrección de un documento con fallos tardíos', () => {
  const corregida = () => lectura({ sha256: SHA_B, pruebas: [prueba({ puestos: [puesto(1), puesto(2)], asaltos: [asalto(1, 2, { puntosB: 4 })] })] });

  async function conPrimeraLectura() {
    const a = almacen();
    await persistirLecturaPdf(a.d, lectura(), ctx);
    expect(a.doc()?.status).toBe('completo');
    return a;
  }

  it('antes de mutar hechos el checkpoint ya es incompleto y no conserva la huella vieja como aceptada', async () => {
    const a = await conPrimeraLectura();
    await persistirLecturaPdf(a.d, corregida(), ctx);
    const primera = a.instantaneas.filter((i) => i.doc?.cursor && decodificarCheckpointPdf(i.doc.cursor)?.sha256 === null);
    expect(primera.length).toBeGreaterThan(0);
    const visto = a.instantaneas.at(-1)?.doc;
    expect(visto?.status).not.toBe('completo');
    expect(decodificarCheckpointPdf(visto?.cursor)?.correccion).toMatchObject({ shaPrevio: SHA_A, shaNuevo: SHA_B });
    expect(decodificarCheckpointPdf(a.doc()?.cursor)?.sha256).toBe(SHA_B);
    expect(a.doc()?.status).toBe('completo');
  });

  it('un fallo al escribir asaltos deja error persistido y sin huella aceptada; la siguiente ejecución completa', async () => {
    const a = await conPrimeraLectura();
    a.fallos.upsertAsaltos = true;
    await expect(persistirLecturaPdf(a.d, corregida(), ctx)).rejects.toThrow('asaltos');
    expect(a.doc()?.status).toBe('error');
    expect(a.doc()?.lastError).toContain('asaltos');
    expect(decodificarCheckpointPdf(a.doc()?.cursor)).toMatchObject({ sha256: null, correccion: { shaPrevio: SHA_A, shaNuevo: SHA_B } });

    a.fallos.upsertAsaltos = false;
    const r = await persistirLecturaPdf(a.d, corregida(), ctx);
    expect(r.estado).toBe('aplicado');
    expect(a.doc()?.status).toBe('completo');
    expect(decodificarCheckpointPdf(a.doc()?.cursor)?.sha256).toBe(SHA_B);
    expect(a.filasDe(ID)).toHaveLength(2);
    expect(a.asaltosDe(ID)).toHaveLength(1);
  });

  it('un fallo al retirar hechos (reconcile) no deja la huella nueva ni el estado completo con hechos mezclados', async () => {
    const a = await conPrimeraLectura();
    a.fallos.reconciliar = true;
    await expect(persistirLecturaPdf(a.d, corregida(), ctx)).rejects.toThrow('retirar');
    expect(a.filasDe(ID)).toHaveLength(3);
    expect(a.doc()?.status).toBe('error');
    expect(decodificarCheckpointPdf(a.doc()?.cursor)?.sha256).toBeNull();

    a.fallos.reconciliar = false;
    await persistirLecturaPdf(a.d, corregida(), ctx);
    expect(a.filasDe(ID)).toHaveLength(2);
    expect(a.doc()?.status).toBe('completo');
  });

  it('si también falla el checkpoint final queda el marcador incompleto, nunca completo con la huella vieja', async () => {
    const a = await conPrimeraLectura();
    a.fallos.checkpointFinal = true;
    await expect(persistirLecturaPdf(a.d, corregida(), ctx)).rejects.toThrow('checkpoint');
    const cp = decodificarCheckpointPdf(a.doc()?.cursor);
    expect(cp?.sha256).toBeNull();
    expect(cp?.sha256).not.toBe(SHA_A);
    expect(a.doc()?.status).not.toBe('completo');
    expect(a.doc()?.status).toBe('error');
  });
});
