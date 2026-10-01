import { describe, expect, it } from 'vitest';
import { evaluarCapacidad, proyectarCrecimiento, TASAS_CONSERVADORAS, UMBRAL_CONSERVADOR_BYTES } from '@/lib/ingest/backfill/capacidad';
import { crearGuardaCapacidad } from '@/lib/ingest/backfill/guarda-capacidad';
import { MAX_REESCRITURAS_POR_REFERENCIAS, repartirReescriturasConGuarda, type ClaseHuella } from '@/lib/ingest/backfill/referencias';

type Lista = { id: number; clase: ClaseHuella; inscritos: unknown[] };

const lista = (id: number, clase: ClaseHuella, n = 40): Lista => ({ id, clase, inscritos: Array.from({ length: n }, () => ({})) });

const guardaCon = (ocupado: number | 'falla') =>
  crearGuardaCapacidad({
    plan: { tipo: 'free' },
    medir: async () => {
      if (ocupado === 'falla') throw new Error('sin medición');
      return { medidoEn: 'x', logicoBytes: ocupado, baseDatosBytes: null, tablas: [], conteos: {} } as never;
    },
  });

describe('reescritura forzada 0018 con guarda de capacidad', () => {
  const leidas = [lista(1, 'reescritura_por_referencias'), lista(2, 'contenido_cambiado'), lista(3, 'reescritura_por_referencias'), lista(4, 'sin_cambios')];

  it('sin guarda conserva el reparto por tope de 60 listas', async () => {
    const muchas = Array.from({ length: 70 }, (_, i) => lista(i, 'reescritura_por_referencias'));
    const r = await repartirReescriturasConGuarda(muchas, MAX_REESCRITURAS_POR_REFERENCIAS);
    expect(r.escribir).toHaveLength(60);
    expect(r.diferidas).toHaveLength(10);
    expect(r.capacidad).toBeNull();
  });

  it('con margen escribe las forzadas y reporta la decisión', async () => {
    const r = await repartirReescriturasConGuarda(leidas, 60, guardaCon(1024));
    expect(r.escribir.map((l) => l.id)).toEqual([1, 2, 3, 4]);
    expect(r.reescritas).toBe(2);
    expect(r.capacidad?.continuar).toBe(true);
  });

  it('sin margen para el tamaño leído difiere las forzadas, sigue escribiendo el contenido nuevo y no cuenta reescrituras', async () => {
    const forzadas = proyectarCrecimiento(TASAS_CONSERVADORAS, { puestos: 80, asaltos: 0, documentos: 0, unidades: 2 });
    const r = await repartirReescriturasConGuarda(leidas, 60, guardaCon(UMBRAL_CONSERVADOR_BYTES - Math.floor(forzadas / 2)));
    expect(r.capacidad?.continuar).toBe(false);
    expect(r.reescritas).toBe(0);
    expect(r.escribir.map((l) => l.id)).toEqual([2, 4]);
    expect(r.diferidas.map((l) => l.id)).toEqual([1, 3]);
  });

  it('si la medición falla no autoriza la reescritura opcional', async () => {
    const r = await repartirReescriturasConGuarda(leidas, 60, guardaCon('falla'));
    expect(r.capacidad?.motivo).toBe('sin_medicion');
    expect(r.diferidas.map((l) => l.id)).toEqual([1, 3]);
  });

  it('sin forzadas no consulta la guarda', async () => {
    let llamadas = 0;
    const r = await repartirReescriturasConGuarda([lista(1, 'contenido_cambiado')], 60, async () => {
      llamadas += 1;
      return evaluarCapacidad({ actualBytes: 0, proyectadoBytes: 0, plan: { tipo: 'free' } });
    });
    expect(llamadas).toBe(0);
    expect(r.capacidad).toBeNull();
  });
});
