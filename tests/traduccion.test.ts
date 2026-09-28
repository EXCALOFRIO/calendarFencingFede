import { describe, expect, it } from 'vitest';
import {
  formatDateRangeEs,
  titularDocumento,
  titularTorneo,
} from '../src/lib/utils';

/**
 * La aplicación está en castellano y el calendario no puede tener la mitad
 * de los torneos en inglés. Los casos de aquí son nombres REALES sacados de
 * la tabla `event`, no inventados.
 */
describe('los nombres de la FIE se enseñan en castellano', () => {
  it('traduce el patrón «ciudad + tipo + año»', () => {
    expect(titularTorneo('Samsun World Cup 2026')).toBe('Copa del Mundo de Samsun');
    expect(titularTorneo('Dublin Satellite Tournament 2026')).toBe(
      'Torneo Satélite de Dublín',
    );
    expect(titularTorneo('Cairo Grand Prix 2027')).toBe('Gran Premio del Cairo');
    expect(titularTorneo('Junior World Championships 2027')).toBe(
      'Campeonato del Mundo Júnior',
    );
  });

  it('usa el exónimo español de la ciudad cuando lo hay', () => {
    // La FIE publica Gante en francés.
    expect(titularTorneo('Gand Satellite Tournament 2026')).toBe(
      'Torneo Satélite de Gante',
    );
    expect(titularTorneo('Bogota World Cup 2026')).toBe('Copa del Mundo de Bogotá');
  });

  it('entiende que lo de delante puede ser el arma y no una ciudad', () => {
    // Cuando la FIE todavía no tiene sede, el nombre lleva el arma delante.
    expect(titularTorneo('Sabre World Cup 2027')).toBe('Copa del Mundo de Sable');
    expect(titularTorneo('Epee World Cup 2027')).toBe('Copa del Mundo de Espada');
  });

  it('no toca lo que ya está en castellano', () => {
    expect(titularTorneo('Liga Nacional Oro 1ª Jornada')).toBe(
      'Liga Nacional Oro 1ª Jornada',
    );
    // Lo que viene en mayúsculas sigue pasando por `titular()`.
    expect(titularTorneo('COPA MUNDO CADETE')).toBe('Copa Mundo Cadete');
  });

  it('no inventa una ciudad cuando el nombre es solo el tipo de prueba', () => {
    expect(titularTorneo('World Cup')).toBe('Copa del Mundo');
  });
});

/**
 * La RFEE sube los PDF con el nombre del fichero tal cual. Los casos de aquí
 * son títulos REALES de la tabla `official_document`.
 */
describe('los títulos de las circulares se leen como títulos', () => {
  it('quita los guiones bajos y la extensión', () => {
    expect(
      titularDocumento('Circular_11-26_competiciones_por_equipos_26-27_completa'),
    ).toBe('Circular 11-26 Competiciones por Equipos 26-27 Completa');
    expect(
      titularDocumento('NORMATIVA-PARA-RANKINGS-NACIONALES_26-27_V1.pdf'),
    ).toBe('Normativa para Rankings Nacionales 26-27 V1');
  });

  it('conserva el número de circular y la temporada, que es la referencia', () => {
    // El guion de «11-26» y «26-27» NO es un separador de palabras.
    expect(titularDocumento('Circular_11-26_material')).toContain('11-26');
    expect(titularDocumento('algo_26-27_v1')).toContain('26-27');
  });

  it('respeta las siglas y baja las preposiciones', () => {
    expect(titularDocumento('Circular_07-26_clasificados_cto_españa_m17')).toBe(
      'Circular 07-26 Clasificados CTO España M17',
    );
  });
});

/**
 * El rango de fechas de un torneo.
 *
 * Existe porque **se perdía el día del final** cuando el rango cruzaba de mes:
 * un torneo del 31 de octubre al 1 de noviembre se pintaba «31 oct – nov 2026»,
 * que se lee como si durara un mes entero. Salía en cada tarjeta de la agenda y
 * en el marcador de la cabecera, y sobrevivió porque solo afecta a los torneos
 * que empiezan a final de mes.
 */
describe('el rango de fechas dice siempre los dos días', () => {
  it('cruzando de mes, el día del final NO se pierde', () => {
    expect(formatDateRangeEs('2026-10-31', '2026-11-01')).toBe('31 oct – 1 nov 2026');
  });

  it('dentro del mismo mes, se comparte el mes', () => {
    expect(formatDateRangeEs('2026-10-15', '2026-10-18')).toBe('15–18 oct 2026');
  });

  it('cruzando de año, se dicen los dos años', () => {
    const r = formatDateRangeEs('2026-12-28', '2027-01-03');
    expect(r).toContain('2026');
    expect(r).toContain('2027');
    expect(r).toContain('28');
    expect(r).toContain('3');
  });

  it('un solo día no se escribe como rango', () => {
    expect(formatDateRangeEs('2026-10-15', '2026-10-15')).not.toContain('–');
  });
});
