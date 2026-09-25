import { describe, expect, it } from 'vitest';
import { titularDocumento, titularTorneo } from '../src/lib/utils';

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
