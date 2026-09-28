import { describe, expect, it, vi } from 'vitest';
import { hoyMadrid } from '../src/lib/callups/fechas';
import { diasHasta } from '../src/components/calendario/lo-que-viene';

/**
 * «HOY» ES EL DE ESPAÑA, NO EL DEL QUE EJECUTA
 * ===========================================================================
 *
 * Este fallo tardó en aparecer porque **solo se ve dos horas al día**, y en
 * local no se ve nunca: la máquina de quien desarrolla ya está en hora
 * española. En producción el servidor es un Worker de Cloudflare, que corre en
 * UTC, y el navegador está en `Europe/Madrid`. Entre las 00:00 y las 02:00 de
 * Madrid son días distintos, así que:
 *
 *   - el calendario resaltaba **ayer**,
 *   - «lo que viene» contaba **un día más** del que quedaba,
 *   - y React cazaba la diferencia entre lo que pintó el servidor y lo que
 *     pinta el navegador (error #418), rehaciendo trozos del árbol ya
 *     pintados, que es de donde salen los saltos de maquetación tardíos.
 *
 * Las pruebas fijan el reloj a la madrugada española con el huso del proceso
 * en UTC, que es exactamente la situación del Worker. Sin el anclaje a Madrid,
 * `hoyMadrid()` devolvería el día anterior y estas pruebas fallarían.
 */
describe('hoy se calcula en hora española', () => {
  it('a la una de la madrugada de Madrid ya es el día siguiente, aunque en UTC no', () => {
    // 2026-09-27 23:30 UTC = 2026-09-28 01:30 en Madrid (verano, +02:00).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T23:30:00Z'));
    try {
      expect(hoyMadrid()).toBe('2026-09-28');
      // Y lo que haría el código anterior, para que se vea la diferencia:
      expect(new Date().toISOString().slice(0, 10)).toBe('2026-09-27');
    } finally {
      vi.useRealTimers();
    }
  });

  it('en invierno el desfase es de una hora y el día también cambia', () => {
    // 2026-12-15 23:30 UTC = 2026-12-16 00:30 en Madrid (invierno, +01:00).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-15T23:30:00Z'));
    try {
      expect(hoyMadrid()).toBe('2026-12-16');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a mediodía coinciden, que es el caso de siempre', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    try {
      expect(hoyMadrid()).toBe('2026-09-28');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('los días que faltan se cuentan desde el día español', () => {
  it('a la una de la madrugada no sobra un día', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T23:30:00Z')); // 28/09 01:30 en Madrid
    try {
      // El torneo empieza el 30: faltan dos días, no tres.
      expect(diasHasta('2026-09-30')).toBe(2);
      expect(diasHasta('2026-09-28')).toBe(0);
      expect(diasHasta('2026-09-27')).toBe(-1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('el cambio de hora no suma ni resta un día', () => {
    vi.useFakeTimers();
    // El último domingo de octubre de 2026 (25/10) España atrasa el reloj.
    vi.setSystemTime(new Date('2026-10-23T10:00:00Z'));
    try {
      expect(diasHasta('2026-10-24')).toBe(1);
      expect(diasHasta('2026-10-25')).toBe(2);
      expect(diasHasta('2026-10-26')).toBe(3);
      expect(diasHasta('2026-11-02')).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it('acepta una fecha con hora, que es como vienen de la base', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    try {
      expect(diasHasta('2026-10-01T00:00:00.000Z')).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
