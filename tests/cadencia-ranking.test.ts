import { describe, expect, it } from 'vitest';
import {
  DIAS_DE_MANTENIMIENTO,
  DIAS_TRAS_COMPETICION,
  tocaLeerRanking,
} from '@/lib/ingest/cadencia-ranking';

/**
 * La cadencia del ranking nacional.
 *
 * Petición literal del usuario: *«el ranking después de cada TNR y eso 3 días
 * seguidos, y después cada semana»*. Esto lo comprueba con fechas concretas,
 * porque los fallos de calendario no se encuentran razonando.
 *
 * Y hay un motivo práctico para blindarlo: si la regla se rompe hacia el lado
 * tacaño, **el ranking se queda viejo sin que nadie se entere** —que es el
 * fallo peor de este proyecto, un dato malo publicado con cara de bueno—; y si
 * se rompe hacia el otro, volvemos a descargar 1.235 filas cada noche para
 * nada.
 */

const d = (iso: string) => new Date(`${iso}T04:00:00Z`);

describe('cuándo toca leer el ranking nacional', () => {
  it('si no se ha leído nunca, se lee', () => {
    const r = tocaLeerRanking(d('2026-10-15'), null, []);
    expect(r.leer).toBe(true);
    if (r.leer) expect(r.motivo).toBe('primera_vez');
  });

  /**
   * Los tres días siguientes a una competición. Se insiste **aunque se leyera
   * ayer**: lo que se espera es que la federación publique, y no se sabe en
   * qué día de los tres lo va a hacer.
   */
  it('insiste los tres días siguientes a una prueba, aunque se leyera ayer', () => {
    const finTnr = d('2026-10-11'); // un domingo
    for (const [dia, debe] of [
      ['2026-10-11', true], // el mismo día que acaba
      ['2026-10-12', true],
      ['2026-10-13', true],
      ['2026-10-14', false], // al cuarto día ya no
    ] as const) {
      const ayer = new Date(d(dia).getTime() - 86_400_000);
      const r = tocaLeerRanking(d(dia), ayer, [finTnr]);
      expect(r.leer, `el ${dia}`).toBe(debe);
      if (r.leer) expect(r.motivo).toBe('tras_competicion');
    }
  });

  it('sin competiciones recientes, lee una vez por semana', () => {
    const hoy = d('2026-12-01');
    const haceSeis = new Date(hoy.getTime() - 6 * 86_400_000);
    const haceSiete = new Date(hoy.getTime() - 7 * 86_400_000);

    expect(tocaLeerRanking(hoy, haceSeis, []).leer).toBe(false);

    const r = tocaLeerRanking(hoy, haceSiete, []);
    expect(r.leer).toBe(true);
    if (r.leer) expect(r.motivo).toBe('mantenimiento_semanal');
  });

  /**
   * Una prueba que todavía no ha acabado no puede haber movido el ranking, así
   * que no dispara nada. Sin esto, un torneo de cuatro días haría leer los
   * cuatro días de antes por error de signo.
   */
  it('una prueba futura no dispara la lectura', () => {
    const hoy = d('2026-10-08');
    const finFuturo = d('2026-10-11');
    const ayer = new Date(hoy.getTime() - 86_400_000);
    expect(tocaLeerRanking(hoy, ayer, [finFuturo]).leer).toBe(false);
  });

  it('con varias pruebas manda la que acabó más tarde', () => {
    const hoy = d('2026-10-13');
    const ayer = new Date(hoy.getTime() - 86_400_000);
    // Una vieja (fuera de ventana) y una de anteayer (dentro).
    const r = tocaLeerRanking(hoy, ayer, [d('2026-09-20'), d('2026-10-11')]);
    expect(r.leer).toBe(true);
    if (r.leer) expect(r.motivo).toBe('tras_competicion');
  });

  /**
   * El cambio de hora. En España el reloj se mueve la última madrugada de
   * octubre y de marzo, y un cálculo de días por milisegundos se desplaza una
   * hora. Con la ventana de tres días eso no debería cambiar la decisión, y
   * esto lo fija para que nadie lo rompa al «simplificar» la resta.
   */
  it('el cambio de hora no altera la ventana', () => {
    // El reloj español atrasa la madrugada del 25 de octubre de 2026.
    const finSabado = d('2026-10-24');
    for (const [dia, debe] of [
      ['2026-10-25', true],
      ['2026-10-26', true],
      ['2026-10-27', false],
    ] as const) {
      const ayer = new Date(d(dia).getTime() - 86_400_000);
      expect(tocaLeerRanking(d(dia), ayer, [finSabado]).leer, dia).toBe(debe);
    }
  });

  it('la explicación dice siempre por qué, para el registro de ingestión', () => {
    const hoy = d('2026-12-01');
    const ayer = new Date(hoy.getTime() - 86_400_000);
    const no = tocaLeerRanking(hoy, ayer, []);
    expect(no.explicacion).toContain(String(DIAS_DE_MANTENIMIENTO));

    const si = tocaLeerRanking(hoy, ayer, [d('2026-11-30')]);
    expect(si.explicacion).toContain(String(DIAS_TRAS_COMPETICION));
  });
});
