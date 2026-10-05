import { describe, expect, it } from 'vitest';
import { mapCategory, mapGender } from '../src/lib/ingest/mappers';
import { generoDelNombre } from '../src/lib/ingest/sources/skermo';

/**
 * LO QUE SE QUEDABA EN CUARENTENA Y AHORA ENTRA
 * ===========================================================================
 *
 * La cuarentena tenía **139 filas pendientes** y todas decían lo mismo: «la
 * categoría de una prueba, valor que no reconocemos». Agrupando los valores
 * crudos salieron seis, y ninguno era un dato malo:
 *
 *   +30 ×96   +40 ×96   +50 ×96   +60 ×96   +70 ×72   M7 ×24
 *
 * Los cinco primeros son **veteranos por tramos de edad**, que es como los
 * escriben las federaciones autonómicas. El sexto es una categoría real que
 * faltaba en el enum. Entre las dos cosas, ligas catalanas y madrileñas
 * enteras estaban fuera del calendario.
 *
 * Y ocho pruebas más caían por el género, porque Skermo **deja el campo
 * vacío** en las mixtas de M9 aunque el nombre del torneo diga «MIXTO».
 *
 * Estas pruebas fijan las dos cosas, y sobre todo fijan los límites: lo que no
 * es una edad no es veteranos, y un nombre que menciona dos géneros no elige
 * ninguno.
 */
describe('los tramos de veteranos de las autonómicas', () => {
  it('«+30», «+40», «+50», «+60» y «+70» son veteranos', () => {
    for (const raw of ['+30', '+40', '+50', '+60', '+70']) {
      expect(mapCategory(raw), raw).toBe('VET');
    }
  });

  it('sigue funcionando la forma que ya se reconocía', () => {
    expect(mapCategory('VET50')).toBe('VET');
    expect(mapCategory('V')).toBe('VET');
    expect(mapCategory('Veteranos')).toBe('VET');
  });

  it('«GV» de la FIE (Grand Veterans por equipos) es veteranos', () => {
    expect(mapCategory('GV')).toBe('VET');
    expect(mapCategory('Grand Veterans')).toBe('VET');
    expect(mapCategory('G')).toBeNull();
    expect(mapCategory('GVX')).toBeNull();
  });

  it('un «+» con un solo dígito NO es una edad', () => {
    // No se traga cualquier cosa que empiece por «+»: si algún día aparece un
    // «+1» que signifique otra cosa, va a cuarentena y se mira.
    expect(mapCategory('+1')).toBeNull();
    expect(mapCategory('+')).toBeNull();
    expect(mapCategory('+30A')).toBeNull();
  });
});

describe('M7, que existe', () => {
  it('se reconoce', () => {
    expect(mapCategory('M7')).toBe('M7');
    expect(mapCategory('m7')).toBe('M7');
  });

  it('y las demás no se mueven', () => {
    expect(mapCategory('M9')).toBe('M9');
    expect(mapCategory('M17')).toBe('M17');
    expect(mapCategory('U14')).toBe('M14');
    expect(mapCategory('M8')).toBeNull();
  });
});

describe('el género, cuando Skermo no lo publica', () => {
  it('se lee del nombre del torneo', () => {
    expect(generoDelNombre('1 FASE M9 SABLE MIXTO')).toBe('MIXTO');
    expect(generoDelNombre('1 FASE M9 FLORETE MIXTO')).toBe('MIXTO');
    expect(generoDelNombre('1 FASE +50 FLORETE FEM')).toBe('F');
    expect(generoDelNombre('1 FASE +50 FLORETE MAS')).toBe('M');
    expect(generoDelNombre('TNR ABS ESPADA MASCULINA')).toBe('M');
  });

  it('si el nombre menciona dos géneros, no elige ninguno', () => {
    // Apuntar a alguien a la prueba del género equivocado no se detecta
    // mirando la pantalla: se detecta en la pista.
    expect(generoDelNombre('OPEN FEMENINO Y MASCULINO')).toBeNull();
    expect(generoDelNombre('MIXTO FEMENINO')).toBeNull();
  });

  it('si el nombre no dice nada, tampoco', () => {
    expect(generoDelNombre('I JORNADA DE RANKING REGIONAL')).toBeNull();
    expect(generoDelNombre('')).toBeNull();
  });

  it('el campo propio manda sobre el nombre', () => {
    // `mapGender` es lo que se consulta primero en el parser; esto solo fija
    // que sigue reconociendo lo que reconocía.
    expect(mapGender('Femenino')).toBe('F');
    expect(mapGender('Mixto')).toBe('MIXTO');
    expect(mapGender(null)).toBeNull();
  });
});
