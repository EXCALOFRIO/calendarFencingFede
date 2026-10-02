import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  type DocumentoPiloto,
  type EvidenciaViaIa,
  MODELO_PILOTO,
  PILOTO_IA,
  VIA_IA_ACTUAL,
  carenciasDeVia,
  comprometidoMicroEur,
  crearAlmacenMemoria,
  estadoPublicacionIa,
  estimarCoste,
  procesarDocumentoPiloto,
} from '@/lib/ingest/backfill/piloto-ia';
import { crearAlmacenFichero } from '@/lib/ingest/backfill/piloto-ia-almacen';
import { construirInformePiloto, medirPdfLocal } from '@/lib/ingest/backfill/piloto-ia-informe';

// Todo lo de este fichero es SIMULACION o cálculo local: ninguna prueba llama a un modelo.

const doc = (n: number, extra: Partial<DocumentoPiloto> = {}): DocumentoPiloto => ({
  documentoId: `sha-${n}`,
  paginas: 8,
  bytes: 190_000,
  caracteres: 20_000,
  privacidad: 'sin_datos_personales',
  ...extra,
});

const VIA_COMPLETA: EvidenciaViaIa = {
  accesoInferenciaCuenta: true,
  modeloConfirmado: MODELO_PILOTO,
  planYCuotaCuenta: true,
  condicionesDatosAceptadas: true,
  aprobacionExplicita: true,
};

const clienteFalso = (micro: number) => vi.fn(async () => ({ costeMicroEur: micro }));

describe('estimación previa de coste', () => {
  it('es conservadora y se distingue de la factura: cada escenario lleva su naturaleza', () => {
    const e = estimarCoste({ caracteres: 20_000 });
    expect(e).not.toBeNull();
    const { bajo, base, conservador } = e!.escenarios;
    expect(bajo.costeMicroEur).toBeLessThan(base.costeMicroEur);
    expect(base.costeMicroEur).toBeLessThan(conservador.costeMicroEur);
    expect(e!.aplicado).toBe(conservador);
    expect(Object.values(e!.escenarios).every((s) => s.naturaleza === 'estimacion_previa_no_factura')).toBe(true);
    // 1 token por carácter + prompt fijo + salida completa, con margen: nunca por debajo del cálculo directo.
    const directoUsd = ((20_000 + PILOTO_IA.tokensFijosPromptPeorCaso) * 0.15 + PILOTO_IA.maxTokensSalida * 0.5) / 1_000_000;
    expect(conservador.costeMicroEur).toBeGreaterThanOrEqual(Math.ceil(directoUsd * 1_000_000));
  });

  it('un modelo sin tarifa publicada no se estima', () => {
    expect(estimarCoste({ caracteres: 10 }, '@cf/otro/modelo')).toBeNull();
  });

  it('diez documentos del tope de texto caben en el presupuesto, así que el límite de documentos es el que corta primero', () => {
    const e = estimarCoste({ caracteres: PILOTO_IA.maxCaracteresEnviados })!;
    expect(e.aplicado.costeMicroEur * PILOTO_IA.maxDocumentos).toBeLessThan(PILOTO_IA.presupuestoMaxMicroEur);
  });
});

describe('guardas del piloto (SIMULACION)', () => {
  it('procesa 10 documentos y bloquea el 11 sin invocar al cliente', async () => {
    const almacen = crearAlmacenMemoria('simulacion');
    const invocar = clienteFalso(1_000);
    for (let i = 1; i <= 10; i += 1) {
      const r = await procesarDocumentoPiloto({ almacen, invocar }, doc(i));
      expect(r.estado).toBe('completado');
    }
    const r11 = await procesarDocumentoPiloto({ almacen, invocar }, doc(11));
    expect(r11).toMatchObject({ estado: 'bloqueado', enviado: false });
    expect(r11.estado === 'bloqueado' && r11.motivos).toContain('limite_documentos');
    expect(invocar).toHaveBeenCalledTimes(10);
    expect(almacen.leer().entradas).toHaveLength(10);
  });

  it('bloquea una llamada cuya estimación excedería el presupuesto, aunque el coste simulado sea pequeño', async () => {
    const almacen = crearAlmacenMemoria('simulacion');
    const invocar = clienteFalso(10);
    const r1 = await procesarDocumentoPiloto({ almacen, invocar }, doc(1));
    expect(r1.estado).toBe('completado');
    // Una operación cuya estimación conservadora sola ya supera 1 € (caracteres bajo el tope pero tarifa inflada).
    const casiLleno = crearAlmacenMemoria('simulacion', {
      version: 1,
      modo: 'simulacion',
      bloqueos: [],
      entradas: [
        {
          documentoId: 'previo',
          estado: 'reservada',
          estimadoMicroEur: PILOTO_IA.presupuestoMaxMicroEur - 1,
          observadoMicroEur: null,
          simuladoMicroEur: null,
          paginas: 1,
          bytes: 1,
          caracteres: 1,
          en: 'x',
          detalle: null,
        },
      ],
    });
    const invocar2 = clienteFalso(1);
    const r2 = await procesarDocumentoPiloto({ almacen: casiLleno, invocar: invocar2 }, doc(2));
    expect(r2.estado === 'bloqueado' && r2.motivos).toContain('presupuesto_excedido');
    expect(invocar2).not.toHaveBeenCalled();
  });

  it('el coste simulado se etiqueta como simulación y nunca como observado', async () => {
    const almacen = crearAlmacenMemoria('simulacion');
    const r = await procesarDocumentoPiloto({ almacen, invocar: clienteFalso(5_000) }, doc(1));
    expect(r).toMatchObject({ estado: 'completado', naturalezaCoste: 'simulado', publicacion: 'pendiente_revision_humana' });
    expect(r.estado === 'completado' && r.etiqueta).toMatch(/SIMULACION/);
    const [entrada] = almacen.leer().entradas;
    expect(entrada.simuladoMicroEur).toBe(5_000);
    expect(entrada.observadoMicroEur).toBeNull();
  });

  it('un documento ya intentado no se reintenta, ni tras un fallo, y el fallo sigue contando por su estimación', async () => {
    const almacen = crearAlmacenMemoria('simulacion');
    const falla = vi.fn(async () => {
      throw new Error('timeout');
    });
    const r1 = await procesarDocumentoPiloto({ almacen, invocar: falla }, doc(1));
    expect(r1).toMatchObject({ estado: 'fallido', enviado: true });
    const r2 = await procesarDocumentoPiloto({ almacen, invocar: falla }, doc(1));
    expect(r2.estado === 'bloqueado' && r2.motivos).toContain('documento_ya_intentado');
    expect(falla).toHaveBeenCalledTimes(1);
    const estado = almacen.leer();
    expect(estado.entradas[0].estado).toBe('fallida');
    expect(comprometidoMicroEur(estado)).toBe(estado.entradas[0].estimadoMicroEur);
  });

  it('un coste devuelto inválido no se contabiliza como consumo', async () => {
    const almacen = crearAlmacenMemoria('simulacion');
    const r = await procesarDocumentoPiloto({ almacen, invocar: clienteFalso(Number.NaN) }, doc(1));
    expect(r.estado).toBe('fallido');
    expect(almacen.leer().entradas[0]).toMatchObject({ estado: 'fallida', simuladoMicroEur: null, observadoMicroEur: null });
  });

  it('bloquea datos personales, privacidad desconocida y documentos por encima del tope de texto', async () => {
    const almacen = crearAlmacenMemoria('simulacion');
    const invocar = clienteFalso(1);
    const nominal = await procesarDocumentoPiloto({ almacen, invocar }, doc(1, { privacidad: 'nominal' }));
    const desconocida = await procesarDocumentoPiloto({ almacen, invocar }, doc(2, { privacidad: 'desconocida' }));
    const largo = await procesarDocumentoPiloto({ almacen, invocar }, doc(3, { caracteres: PILOTO_IA.maxCaracteresEnviados + 1 }));
    expect(nominal.estado === 'bloqueado' && nominal.motivos).toContain('privacidad_no_acreditada');
    expect(desconocida.estado === 'bloqueado' && desconocida.motivos).toContain('privacidad_no_acreditada');
    expect(largo.estado === 'bloqueado' && largo.motivos).toContain('supera_tope_caracteres');
    expect(invocar).not.toHaveBeenCalled();
    expect(almacen.leer().entradas).toHaveLength(0);
    expect(almacen.leer().bloqueos).toHaveLength(3);
  });

  it('dos operaciones concurrentes no pueden reservar por encima del límite de documentos', async () => {
    const almacen = crearAlmacenMemoria('simulacion');
    const invocar = clienteFalso(1);
    const resultados = await Promise.all(Array.from({ length: 14 }, (_, i) => procesarDocumentoPiloto({ almacen, invocar }, doc(i + 1))));
    expect(resultados.filter((r) => r.estado === 'completado')).toHaveLength(10);
    expect(resultados.filter((r) => r.estado === 'bloqueado')).toHaveLength(4);
    expect(invocar).toHaveBeenCalledTimes(10);
  });
});

describe('ejecución real sin vía verificada', () => {
  it('el estado actual declara cada carencia y bloquea sin llamar al cliente', async () => {
    expect(carenciasDeVia(VIA_IA_ACTUAL)).toEqual([
      'acceso_inferencia_cuenta',
      'modelo_confirmado',
      'plan_y_cuota_cuenta',
      'condiciones_datos',
      'aprobacion_explicita',
    ]);
    const almacen = crearAlmacenMemoria('real');
    const invocar = clienteFalso(1);
    const r = await procesarDocumentoPiloto({ almacen, invocar }, doc(1));
    expect(r).toMatchObject({ estado: 'bloqueado', enviado: false });
    expect(r.estado === 'bloqueado' && r.motivos).toContain('via_no_verificada');
    expect(invocar).not.toHaveBeenCalled();
    expect(almacen.leer().entradas).toHaveLength(0);
  });

  it('falta una sola pieza de evidencia y sigue bloqueado', async () => {
    const almacen = crearAlmacenMemoria('real');
    const invocar = clienteFalso(1);
    const r = await procesarDocumentoPiloto({ almacen, via: { ...VIA_COMPLETA, aprobacionExplicita: false }, invocar }, doc(1));
    expect(r.estado === 'bloqueado' && r.motivos).toEqual(['via_no_verificada']);
    expect(invocar).not.toHaveBeenCalled();
  });

  it('con la vía completa (hipotético, cliente falso) el coste queda como observado y no se publica solo', async () => {
    const almacen = crearAlmacenMemoria('real');
    const r = await procesarDocumentoPiloto({ almacen, via: VIA_COMPLETA, invocar: clienteFalso(7_000) }, doc(1));
    expect(r).toMatchObject({ estado: 'completado', naturalezaCoste: 'observado', publicacion: 'pendiente_revision_humana' });
    expect(almacen.leer().entradas[0]).toMatchObject({ observadoMicroEur: 7_000, simuladoMicroEur: null });
  });

  it('un libro de otro modo no se puede usar con la operación', async () => {
    const almacen = crearAlmacenMemoria('real', { version: 1, modo: 'simulacion', entradas: [], bloqueos: [] });
    await expect(procesarDocumentoPiloto({ almacen, via: VIA_COMPLETA, invocar: clienteFalso(1) }, doc(1))).rejects.toThrow(/modo/);
  });
});

describe('publicación de extracciones de IA', () => {
  const base = { modo: 'real', ambigua: false, citasVerificadas: true, revisadaPorPersona: true } as const;
  it('sólo publica lo no ambiguo, con citas verificadas, real y revisado por una persona', () => {
    expect(estadoPublicacionIa(base)).toBe('publicable');
    expect(estadoPublicacionIa({ ...base, revisadaPorPersona: false })).toBe('pendiente_revision');
    expect(estadoPublicacionIa({ ...base, ambigua: true })).toBe('descartado');
    expect(estadoPublicacionIa({ ...base, citasVerificadas: false })).toBe('descartado');
    expect(estadoPublicacionIa({ ...base, modo: 'simulacion' })).toBe('descartado');
  });
});

describe('libro persistente en disco', () => {
  it('conserva contadores entre instancias y no deja reiniciar el tope con un libro corrupto', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'piloto-ia-'));
    try {
      const a = crearAlmacenFichero('simulacion', dir);
      await procesarDocumentoPiloto({ almacen: a, invocar: clienteFalso(1) }, doc(1));
      const b = crearAlmacenFichero('simulacion', dir);
      const r = await procesarDocumentoPiloto({ almacen: b, invocar: clienteFalso(1) }, doc(1));
      expect(r.estado === 'bloqueado' && r.motivos).toContain('documento_ya_intentado');
      expect(b.leer().entradas).toHaveLength(1);

      // El libro real es un fichero distinto: la simulación no consume presupuesto real.
      expect(crearAlmacenFichero('real', dir).leer().entradas).toHaveLength(0);

      fs.writeFileSync(path.join(dir, 'libro-simulacion.json'), '{corrupto');
      await expect(procesarDocumentoPiloto({ almacen: crearAlmacenFichero('simulacion', dir), invocar: clienteFalso(1) }, doc(2))).rejects.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

function pdfMinimo(contenidos: string[]): Uint8Array {
  const objetos: string[] = [];
  const kids = contenidos.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objetos.push('<</Type/Catalog/Pages 2 0 R>>');
  objetos.push(`<</Type/Pages/Kids[${kids}]/Count ${contenidos.length}>>`);
  contenidos.forEach((c, i) => {
    objetos.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents ${4 + i * 2} 0 R/Resources<</Font<</F1 ${3 + contenidos.length * 2} 0 R>>>>>>`);
    objetos.push(`<</Length ${c.length}>>\nstream\n${c}\nendstream`);
  });
  objetos.push('<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>');
  let salida = '%PDF-1.4\n';
  objetos.forEach((o, i) => {
    salida += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  salida += `trailer\n<</Root 1 0 R/Size ${objetos.length + 1}>>\n%%EOF\n`;
  return new TextEncoder().encode(salida);
}

describe('informe local', () => {
  it('mide páginas, bytes y texto de un PDF en memoria sin acreditar privacidad', async () => {
    const bytes = pdfMinimo(['BT /F1 10 Tf 100 700 Td (Clasificacion final) Tj ET', 'BT /F1 10 Tf 100 700 Td (Segunda pagina) Tj ET']);
    const m = await medirPdfLocal(bytes);
    expect(m).toMatchObject({ paginas: 2, bytes: bytes.length, items: 2 });
    expect(m.caracteres).toBeGreaterThan(20);
    expect(m.documentoId).toMatch(/^[0-9a-f]{64}$/);
    expect(m.privacidad).not.toBe('sin_datos_personales');
  });

  it('con la vía actual la ejecución real queda bloqueada y el informe no declara consumo observado ni factura', () => {
    const informe = construirInformePiloto([doc(1), doc(2)]);
    expect(informe.naturaleza).toBe('informe_local_estimacion_no_factura');
    expect(informe.ejecucionReal).toBe('bloqueada');
    expect(informe.via.verificada).toBe(false);
    expect(informe.libro).toMatchObject({ observadoMicroEur: 0, simuladoMicroEur: 0, documentosIntentados: 0 });
    expect(informe.documentos.every((d) => d.bloqueos.includes('via_no_verificada'))).toBe(true);
    expect(informe.totales.estimacionMicroEur.base).toBeLessThan(informe.totales.estimacionMicroEur.conservador);
    expect(informe.aviso).toMatch(/no son consumo observado ni factura/);
    expect(JSON.stringify(informe)).not.toMatch(/"texto"/);
  });

  it('con 11 documentos el plan marca el undécimo como bloqueado por límite', () => {
    const docs = Array.from({ length: 11 }, (_, i) => doc(i + 1));
    const informe = construirInformePiloto(docs, { modo: 'real', via: VIA_COMPLETA });
    expect(informe.ejecucionReal).toBe('permitida_por_guardas');
    expect(informe.totales).toMatchObject({ documentos: 11, elegibles: 10, bloqueados: 1 });
    expect(informe.documentos[10].bloqueos).toEqual(['limite_documentos']);
  });
});
