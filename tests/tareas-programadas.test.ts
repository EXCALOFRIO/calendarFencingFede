import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localD1 } from '@/db/d1/testing';
import {
  hayQueMarcarVisto,
  nivelDeTorneo,
  tocaClasificacionFie,
  tocaPorPeriodo,
  tocaRefrescar,
} from '@/lib/cron/niveles';

const h = vi.hoisted(() => ({ binding: undefined as unknown }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: { DB: h.binding } }) }));

import { anotarLecturas, ultimasLecturas } from '@/lib/cron/refresco';

const HOY = '2026-05-10';
/** Hora a la que corre el cron de la FIE. */
const AHORA = new Date(`${HOY}T03:30:00Z`);
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000);
const dia = (offset: number) =>
  new Date(Date.parse(`${HOY}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const rango = (desde: number, hasta = desde) => ({ desde: dia(desde), hasta: dia(hasta) });

describe('nivelDeTorneo', () => {
  it.each([
    [rango(2, 3), 'diario'],
    [rango(14), 'diario'],
    [rango(-7), 'diario'],
    [rango(-2, 1), 'diario'],
    [rango(15), 'semanal'],
    [rango(60), 'semanal'],
    [rango(61), 'quincenal'],
    [rango(-8), 'espera'],
    [rango(-13), 'espera'],
    [rango(-14), 'final'],
    [rango(-35), 'final'],
    [rango(-36), 'congelado'],
    [rango(-400), 'congelado'],
  ] as const)('%o → %s', (r, nivel) => {
    expect(nivelDeTorneo(r, HOY)).toBe(nivel);
  });
});

describe('tocaRefrescar', () => {
  it('diario: una lectura por noche, con media jornada de margen por la hora del cron', () => {
    expect(tocaRefrescar(rango(3), AHORA, null)).toEqual({ leer: true, nivel: 'diario' });
    expect(tocaRefrescar(rango(3), AHORA, hace(23.98)).leer).toBe(true);
    expect(tocaRefrescar(rango(3), AHORA, hace(7)).leer).toBe(false);
  });

  it('semanal y quincenal: según la última lectura', () => {
    expect(tocaRefrescar(rango(30), AHORA, hace(24 * 6)).leer).toBe(false);
    expect(tocaRefrescar(rango(30), AHORA, hace(24 * 7 - 0.1)).leer).toBe(true);
    expect(tocaRefrescar(rango(90), AHORA, hace(24 * 10)).leer).toBe(false);
    expect(tocaRefrescar(rango(90), AHORA, hace(24 * 15)).leer).toBe(true);
  });

  it('pasada final: una sola vez, aunque el cron se haya caído el día 14', () => {
    // Acabó hace 20 días; la última lectura fue durante la semana diaria.
    expect(tocaRefrescar(rango(-20), AHORA, hace(24 * 16))).toEqual({ leer: true, nivel: 'final' });
    // Ya se hizo la pasada final hace 5 días: no se repite.
    expect(tocaRefrescar(rango(-20), AHORA, hace(24 * 5)).leer).toBe(false);
    expect(tocaRefrescar(rango(-14), AHORA, null).leer).toBe(true);
  });

  it('en espera y congelado: ninguna petición, ni siquiera sin lectura previa', () => {
    expect(tocaRefrescar(rango(-10), AHORA, null)).toEqual({ leer: false, nivel: 'espera' });
    expect(tocaRefrescar(rango(-36), AHORA, null)).toEqual({ leer: false, nivel: 'congelado' });
    expect(tocaRefrescar(rango(-3000), AHORA, hace(24 * 900)).leer).toBe(false);
  });
});

describe('tocaPorPeriodo', () => {
  it('sin lectura previa siempre toca; luego, cada N días', () => {
    expect(tocaPorPeriodo(AHORA, null, 7)).toBe(true);
    expect(tocaPorPeriodo(AHORA, hace(24 * 3), 7)).toBe(false);
    expect(tocaPorPeriodo(AHORA, hace(24 * 7), 7)).toBe(true);
  });
});

describe('tocaClasificacionFie', () => {
  it('la primera vez se lee', () => {
    expect(tocaClasificacionFie(AHORA, null, null)).toEqual({ leer: true, motivo: 'primera' });
  });

  it('cada dos días en los cuatro posteriores a una prueba FIE', () => {
    const finDomingo = dia(-2);
    expect(tocaClasificacionFie(AHORA, hace(24 * 3), finDomingo)).toEqual({
      leer: true,
      motivo: 'tras_competicion',
    });
    expect(tocaClasificacionFie(AHORA, hace(24), finDomingo)).toEqual({ leer: false, motivo: 'no_toca' });
  });

  it('sin pruebas recientes, una vez por semana', () => {
    expect(tocaClasificacionFie(AHORA, hace(24 * 3), dia(-9)).leer).toBe(false);
    expect(tocaClasificacionFie(AHORA, hace(24 * 3), null).leer).toBe(false);
    expect(tocaClasificacionFie(AHORA, hace(24 * 7), null)).toEqual({ leer: true, motivo: 'semanal' });
  });

  it('una prueba que acaba hoy todavía no cuenta: la FIE no ha recalculado', () => {
    expect(tocaClasificacionFie(AHORA, hace(24 * 3), HOY).leer).toBe(false);
  });
});

describe('hayQueMarcarVisto', () => {
  it('lo que viene o acabó hace poco se marca cada noche', () => {
    expect(hayQueMarcarVisto({ endDate: dia(20), lastSeenAt: hace(1) }, AHORA)).toBe(true);
    expect(hayQueMarcarVisto({ endDate: dia(-10), lastSeenAt: hace(1) }, AHORA)).toBe(true);
  });

  it('lo acabado hace más de dos semanas, como mucho una vez por semana', () => {
    expect(hayQueMarcarVisto({ endDate: dia(-30), lastSeenAt: hace(24) }, AHORA)).toBe(false);
    expect(hayQueMarcarVisto({ endDate: dia(-30), lastSeenAt: hace(24 * 8) }, AHORA)).toBe(true);
  });

  it('un evento que había desaparecido y vuelve se marca siempre', () => {
    expect(
      hayQueMarcarVisto({ endDate: dia(-30), lastSeenAt: hace(1), disappearedAt: hace(48) }, AHORA),
    ).toBe(true);
  });
});

describe('refresco_programado', () => {
  let local: ReturnType<typeof localD1>;
  beforeEach(() => {
    local = localD1();
    h.binding = local.binding;
  });
  afterEach(() => {
    h.binding = undefined;
    local.close();
  });

  it('sin la migración 0012, todo cuenta como nunca leído y anotar no falla', async () => {
    await expect(anotarLecturas('fie_torneo', ['1'], AHORA)).resolves.toBeUndefined();
    expect((await ultimasLecturas('fie_torneo', ['1'])).size).toBe(0);
  });

  it('con la migración, guarda y relee la última lectura por tarea y clave', async () => {
    local.sqlite.exec(
      readFileSync(new URL('../drizzle-d1/0012_refresco_programado.sql', import.meta.url), 'utf8'),
    );
    await anotarLecturas('fie_torneo', ['10', '11'], hace(48));
    await anotarLecturas('fie_torneo', ['11'], AHORA);
    await anotarLecturas('efc', ['calendario'], AHORA);
    const leidas = await ultimasLecturas('fie_torneo', ['10', '11', '12']);
    expect(leidas.get('10')?.getTime()).toBe(hace(48).getTime());
    expect(leidas.get('11')?.getTime()).toBe(AHORA.getTime());
    expect(leidas.has('12')).toBe(false);
  });
});
