import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cabeceraDeRuta, esFichaPropia, pestanaDeRuta } from '@/components/navegacion-app';

const PROPIA = '/explorar/11111111-1111-4111-8111-111111111111';
const AJENA = '/explorar/22222222-2222-4222-8222-222222222222';

describe('la ficha propia cuelga de «Tú»', () => {
  it('la ficha propia y sus secciones marcan Tú; la ajena y el cara a cara, Explorar', () => {
    expect(pestanaDeRuta(PROPIA, false, PROPIA)).toBe('tu');
    expect(pestanaDeRuta(`${PROPIA}/rivales`, false, PROPIA)).toBe('tu');
    expect(pestanaDeRuta(`${PROPIA}/`, false, PROPIA)).toBe('tu');
    expect(pestanaDeRuta(`${PROPIA}/cara-a-cara`, false, PROPIA)).toBe('explorar');
    expect(pestanaDeRuta(AJENA, false, PROPIA)).toBe('explorar');
    expect(pestanaDeRuta(PROPIA, false, null)).toBe('explorar');
    expect(esFichaPropia(`${PROPIA}x`, PROPIA)).toBe(false);
  });

  it('el perfil lleva el título en la cabecera de la aplicación y la propia vuelve a Tú', () => {
    expect(cabeceraDeRuta(AJENA, false)).toEqual({ variante: 'subpantalla', titulo: 'Perfil', volverA: '/explorar', encabezado: false });
    expect(cabeceraDeRuta(`${AJENA}/estadisticas`, false)).toMatchObject({ titulo: 'Perfil' });
    expect(cabeceraDeRuta(PROPIA, false, PROPIA)).toEqual({ variante: 'subpantalla', titulo: 'Perfil', volverA: '/explorar/yo', encabezado: false });
    expect(cabeceraDeRuta(`${PROPIA}/cara-a-cara`, false, PROPIA)).toMatchObject({ titulo: 'Cara a cara', volverA: PROPIA });
  });

  it('el <h1> del perfil es el nombre; «Perfil», en la cabecera compacta, es un rótulo', () => {
    const layout = readFileSync('src/app/(app)/explorar/[personaId]/(perfil)/layout.tsx', 'utf8');
    expect(layout).not.toContain('<h1');
    expect(layout).toContain('<MarcaFichaPropia');
    const ficha = readFileSync('src/components/explorar/ficha-deportiva.tsx', 'utf8');
    expect(ficha.match(/<h1 className/g)).toHaveLength(1);
    expect(ficha).toContain('{nombre}</h1>');
    // La barra y la cabecera leen la ficha propia apuntada por el perfil.
    for (const f of ['src/components/nav.tsx', 'src/components/cabecera-app.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('useFichaPropia()');
    }
  });
});
