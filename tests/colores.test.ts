import { describe, expect, it } from 'vitest';
import {
  COLOR_ORGANISMO,
  colorDeCircuito,
  jerarquiaDeCircuito,
  nombreDeCircuito,
  organismoDeCircuito,
} from '@/lib/colores';
import { CIRCUIT_LABEL, CIRCUIT_SHORT, organismoDe } from '@/lib/utils';

/**
 * El mapa de color de organismo y circuito.
 *
 * Esto no comprueba que los colores sean bonitos —eso se mira en la captura y
 * se mide con `npm run contraste`—. Comprueba lo que sí se puede romper sin
 * darse cuenta: que ningún circuito del calendario real se quede sin clases,
 * que no aparezca un `undefined` en un `className`, y que la traducción de
 * circuito a organismo siga diciendo lo mismo que `organismoDe()`, que es la
 * autoridad. El día que alguien añada un circuito nuevo de la FIE a
 * `utils.ts` y se olvide de mirar aquí, esto lo dice.
 */
describe('colores de organismo', () => {
  it('los cuatro organismos tienen todas las clases', () => {
    for (const [org, c] of Object.entries(COLOR_ORGANISMO)) {
      for (const [campo, valor] of Object.entries(c)) {
        expect(valor, `${org}.${campo}`).toBeTruthy();
        expect(valor, `${org}.${campo}`).not.toContain('undefined');
      }
      expect(c.superficie, org).toMatch(/^bg-org-[a-z]+-relleno$/);
      // Encima del relleno sólido va blanco, no la identidad: la identidad
      // de la FIE sobre su relleno se queda en 3,99:1.
      expect(c.textoSobreSuperficie, org).toBe('text-foreground');
    }
  });

  it('todos los circuitos del calendario resuelven a un organismo con color', () => {
    for (const circuito of Object.keys(CIRCUIT_LABEL)) {
      const color = colorDeCircuito(circuito);
      expect(color, circuito).toBeDefined();
      expect(color.superficie, circuito).toBeTruthy();
    }
  });

  it('no duplica la tabla de quién organiza: delega en organismoDe', () => {
    for (const circuito of Object.keys(CIRCUIT_LABEL)) {
      expect(organismoDeCircuito(circuito), circuito).toBe(
        organismoDe('skermo_rfee', 'NACIONAL', circuito),
      );
    }
  });

  it('sin circuito no inventa nada raro', () => {
    expect(organismoDeCircuito(null)).toBe('RFEE');
    expect(organismoDeCircuito(undefined)).toBe('RFEE');
    expect(nombreDeCircuito(null)).toBeNull();
    expect(nombreDeCircuito('NO_EXISTE')).toBeNull();
  });

  it('el nombre del circuito sale de CIRCUIT_SHORT, no de una copia', () => {
    expect(nombreDeCircuito('SEN_WC')).toBe(CIRCUIT_SHORT.SEN_WC);
    expect(nombreDeCircuito('LIGA_ORO')).toBe(CIRCUIT_SHORT.LIGA_ORO);
  });

  it('la jerarquía pone los campeonatos por delante de un trofeo local', () => {
    expect(jerarquiaDeCircuito('CTO_MUNDO')).toBeLessThan(jerarquiaDeCircuito('SEN_WC'));
    expect(jerarquiaDeCircuito('SEN_WC')).toBeLessThan(jerarquiaDeCircuito('TNR'));
    expect(jerarquiaDeCircuito('TNR')).toBeLessThan(jerarquiaDeCircuito('TLM'));
  });

  it('la Copa del Mundo es de la FIE y la Eurofence League de la EFC', () => {
    expect(organismoDeCircuito('SEN_WC')).toBe('FIE');
    expect(organismoDeCircuito('EFC_LEAGUE')).toBe('EFC');
    expect(organismoDeCircuito('LIGA_ORO')).toBe('RFEE');
    expect(colorDeCircuito('SEN_WC').superficie).toBe('bg-org-fie-relleno');
  });
});
