import { describe, expect, it } from 'vitest';
import { esSubpantalla, rutaMadre } from '@/components/boton-atras';

describe('botón atrás de la cabecera', () => {
  it('sólo aparece en subpantallas', () => {
    expect(esSubpantalla('/')).toBe(false);
    expect(esSubpantalla('/explorar')).toBe(false);
    expect(esSubpantalla('/explorar/abc')).toBe(true);
    expect(esSubpantalla('/explorar/abc/cara-a-cara')).toBe(true);
  });

  it('sube a la ruta madre', () => {
    expect(rutaMadre('/explorar/abc')).toBe('/explorar');
    expect(rutaMadre('/explorar/ediciones/xyz')).toBe('/explorar/ediciones');
    expect(rutaMadre('/explorar')).toBe('/');
  });
});
