import { describe, expect, it } from 'vitest';
import { normalizarLicencia, sinAcentos } from '@/lib/altas/texto';

/**
 * Las dos piezas puras del alta desde el ranking.
 *
 * Parecen triviales y son las que deciden si alguien se encuentra o no. La
 * fuente publica «HÉCTOR RIVAS JIMÉNEZ» con acentos y quien teclea su propio
 * apellido en un móvil muchas veces no los pone; y la licencia la escribe cada
 * uno como le sale, en minúsculas o con un espacio en medio. Si estas dos
 * funciones fallan, la pantalla dice «no apareces» a alguien que sí está, o
 * rebota una licencia correcta.
 *
 * El resto de la lógica —crear la ficha, emparejar el ranking, los cuatro
 * rebotes— se ejercita contra la base de datos real en `tests/ui/alta.mts`,
 * porque son consultas y no funciones puras: comprobarlas con dobles sería
 * comprobar los dobles.
 */

describe('sinAcentos', () => {
  it('quita los acentos de los apellidos que publica la fuente', () => {
    expect(sinAcentos('HÉCTOR RIVAS JIMÉNEZ')).toBe('hector rivas jimenez');
    expect(sinAcentos('MARIA MARIÑO BLANCO')).toBe('maria marino blanco');
    expect(sinAcentos('Abril Rodés Torà')).toBe('abril rodes tora');
  });

  it('no toca lo que no lleva acento', () => {
    expect(sinAcentos('CARLOS LLAVADOR FERNANDEZ')).toBe(
      'carlos llavador fernandez',
    );
  });

  it('recorta los espacios de los bordes, que sobran al pegar un nombre', () => {
    expect(sinAcentos('  Llavador  ')).toBe('llavador');
  });
});

describe('normalizarLicencia', () => {
  it('compara en mayúsculas, que es como la publica la RFEE', () => {
    expect(normalizarLicencia('clf01835')).toBe('CLF01835');
  });

  it('se come los espacios, que es el error más común al copiar del carné', () => {
    expect(normalizarLicencia(' CLF 01835 ')).toBe('CLF01835');
  });

  it('deja igual la que ya está bien escrita', () => {
    expect(normalizarLicencia('AML00995')).toBe('AML00995');
  });

  /**
   * Lo que NO hace: quitar guiones ni ceros de más. «DEMO-0001» y «DEMO0001»
   * son licencias distintas, y adivinar equivalencias es la forma de que dos
   * fichas se peleen por la misma clave única.
   */
  it('no inventa equivalencias entre licencias parecidas', () => {
    expect(normalizarLicencia('DEMO-0001')).not.toBe(
      normalizarLicencia('DEMO0001'),
    );
  });
});
