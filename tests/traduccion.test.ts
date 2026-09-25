import { describe, expect, it } from 'vitest';
import { titularTorneo } from '../src/lib/utils';

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
