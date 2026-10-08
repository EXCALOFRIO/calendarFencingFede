import { describe, expect, it, vi } from 'vitest';
import {
  diaMadrid, diasEntre, fechaCorta, fechaHora, frescura, hoyMadrid, nombreMes, rangoFechas,
} from '@/lib/fechas';

const REF = '2026-06-01';

describe('fechaCorta', () => {
  it('día y mes; el año según el modo', () => {
    expect(fechaCorta('2026-10-05', { referencia: REF })).toBe('5 oct');
    expect(fechaCorta('2027-10-05', { referencia: REF })).toBe('5 oct 2027');
    expect(fechaCorta('2026-10-05', { anio: 'siempre' })).toBe('5 oct 2026');
    expect(fechaCorta('2027-10-05', { anio: 'nunca' })).toBe('5 oct');
    expect(fechaCorta('2026-09-30', { anio: 'nunca' })).toBe('30 sept');
    expect(fechaCorta('no es fecha')).toBe('');
  });

  it('un instante se lee en Madrid, no en UTC', () => {
    // 23:30 UTC del 4 de octubre son las 01:30 del 5 en Madrid (horario de verano).
    expect(fechaCorta('2026-10-04T23:30:00Z', { anio: 'nunca' })).toBe('5 oct');
    // En invierno, UTC+1: las 23:30 UTC del 31 dic ya son 1 de enero.
    expect(fechaCorta(new Date('2026-12-31T23:30:00Z'), { anio: 'siempre' })).toBe('1 ene 2027');
    expect(fechaCorta('2026-12-31T22:59:00Z', { anio: 'siempre' })).toBe('31 dic 2026');
  });
});

describe('rangoFechas', () => {
  it('en línea', () => {
    expect(rangoFechas('2026-10-15', '2026-10-18', 'linea')).toBe('15–18 oct');
    expect(rangoFechas('2026-09-30', '2026-10-02', 'linea')).toBe('30 sept–2 oct');
    expect(rangoFechas('2026-12-30', '2027-01-02', 'linea')).toBe('30 dic 2026–2 ene 2027');
    expect(rangoFechas('2026-10-15', null, 'linea')).toBe('15 oct');
    expect(rangoFechas('2026-10-15', '2026-10-15', 'linea', { anio: 'siempre' })).toBe('15 oct 2026');
    expect(rangoFechas('2027-10-15', '2027-10-18', 'linea', { anio: 'auto', referencia: REF })).toBe('15–18 oct 2027');
  });
  it('en bloque', () => {
    expect(rangoFechas('2026-10-15', '2026-10-18', 'bloque')).toEqual({ dias: '15–18', mes: 'OCT', etiqueta: '15–18 oct 2026' });
    expect(rangoFechas('2026-09-30', '2026-10-02', 'bloque')).toMatchObject({ dias: '30–2', mes: 'SEPT–OCT' });
    expect(rangoFechas('2026-10-15', undefined, 'bloque')).toMatchObject({ dias: '15', mes: 'OCT' });
  });
  it('un final anterior al inicio se ignora', () => {
    expect(rangoFechas('2026-10-15', '2026-10-01', 'linea')).toBe('15 oct');
  });
});

describe('fechaHora, nombreMes, frescura', () => {
  it('fecha y hora en Madrid', () => {
    expect(fechaHora('2026-10-05T21:59:00Z', { anio: 'nunca' })).toBe('5 oct, 23:59');
    expect(fechaHora('2026-01-05T22:59:00Z', { anio: 'nunca' })).toBe('5 ene, 23:59');
    expect(fechaHora('mal')).toBe('');
  });
  it('días de cambio de hora', () => {
    // 29 mar 2026: a las 02:00 se pasa a las 03:00.
    expect(fechaHora('2026-03-29T00:59:00Z', { anio: 'nunca' })).toBe('29 mar, 01:59');
    expect(fechaHora('2026-03-29T01:00:00Z', { anio: 'nunca' })).toBe('29 mar, 03:00');
    // 25 oct 2026: a las 03:00 se vuelve a las 02:00.
    expect(fechaHora('2026-10-25T00:30:00Z', { anio: 'nunca' })).toBe('25 oct, 02:30');
    expect(fechaHora('2026-10-25T01:30:00Z', { anio: 'nunca' })).toBe('25 oct, 02:30');
  });
  it('nombre del mes', () => {
    expect(nombreMes('2026-10-01')).toBe('Octubre');
    expect(nombreMes('2026-10-01', { anio: true })).toBe('Octubre 2026');
    expect(nombreMes(9, { variante: 'corto' })).toBe('sept');
    // Medianoche de Madrid del 1 de noviembre es todavía 31 de octubre en UTC.
    expect(nombreMes(new Date('2026-10-31T23:30:00Z'))).toBe('Noviembre');
  });
  it('frescura con una sola redacción', () => {
    expect(frescura('2026-10-05', { referencia: REF })).toBe('Actualizado el 5 oct');
    expect(frescura(null)).toBe('');
  });
});

describe('diasEntre y hoyMadrid', () => {
  it('cuenta días de calendario aunque el día dure 23 o 25 h', () => {
    expect(diasEntre('2026-03-28', '2026-03-30')).toBe(2);
    expect(diasEntre('2026-10-24', '2026-10-26')).toBe(2);
    expect(diasEntre('2026-10-26', '2026-10-24')).toBe(-2);
    expect(diasEntre('2026-10-04T23:30:00Z', '2026-10-05')).toBe(0);
  });
  it('hoy es el día de Madrid aunque el servidor esté en UTC', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-14T22:30:00Z'));
      expect(hoyMadrid()).toBe('2026-07-15');
      expect(diaMadrid(new Date())).toBe('2026-07-15');
      vi.setSystemTime(new Date('2026-07-14T21:59:00Z'));
      expect(hoyMadrid()).toBe('2026-07-14');
    } finally {
      vi.useRealTimers();
    }
  });
});
