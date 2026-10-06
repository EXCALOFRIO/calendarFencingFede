import { describe, expect, it } from 'vitest';
import { categoriaVisible, medallaDe, nombrePrueba, ordenCategoriaVisible } from '@/lib/sport/explorar/presentacion';

describe('presentación de Explorar', () => {
  it('una sola etiqueta por categoría', () => {
    expect(categoriaVisible('ABS')).toBe('Absoluto');
    expect(categoriaVisible('M20')).toBe('M20');
    expect(categoriaVisible('VET')).toBe('Veteranos');
    expect(categoriaVisible(null)).toBe('Sin categoría');
    expect(ordenCategoriaVisible('ABS')).toBeLessThan(ordenCategoriaVisible('M20'));
  });

  it('normaliza los literales que llegan sin código', () => {
    expect(categoriaVisible('S')).toBe('Absoluto');
    expect(categoriaVisible('SENIOR')).toBe('Absoluto');
    expect(categoriaVisible('senior')).toBe('Absoluto');
    expect(categoriaVisible('J')).toBe('M20');
    expect(categoriaVisible('JUNIOR')).toBe('M20');
    expect(categoriaVisible('C')).toBe('M17');
    expect(categoriaVisible('V')).toBe('Veteranos');
    expect(ordenCategoriaVisible('S')).toBe(ordenCategoriaVisible('ABS'));
    expect(categoriaVisible('OTRA')).toBe('OTRA');
  });

  it('medallas sólo en el podio', () => {
    expect(medallaDe(1)).toBe('oro');
    expect(medallaDe(2)).toBe('plata');
    expect(medallaDe(3)).toBe('bronce');
    expect(medallaDe(4)).toBeNull();
    expect(medallaDe(null)).toBeNull();
  });

  it('quita «par équipes» de las pruebas individuales FIE y traduce', () => {
    expect(nombrePrueba({ nombre: 'Coupe du Monde par équipes', formato: 'INDIVIDUAL', fuente: 'fie' })).toBe('Copa del Mundo');
    expect(nombrePrueba({ nombre: 'Coupe du Monde par équipes', formato: 'EQUIPOS', fuente: 'fie' })).toBe(
      'Copa del Mundo por equipos',
    );
    expect(nombrePrueba({ nombre: 'Tournoi satellite', formato: 'INDIVIDUAL', fuente: 'fie' })).toBe('Torneo Satélite');
    expect(nombrePrueba({ nombre: "Championnats d'Europe Cadets", formato: 'INDIVIDUAL', fuente: 'fie' })).toBe(
      'Campeonato de Europa Cadete',
    );
    expect(nombrePrueba({ nombre: 'Сhampionnats de la Méditerranée', formato: 'INDIVIDUAL', fuente: 'fie' })).toBe(
      'Campeonato del Mediterráneo',
    );
  });

  it('titula los nombres nacionales en mayúsculas', () => {
    expect(nombrePrueba({ nombre: 'COPA MUNDO JÚNIOR', formato: 'INDIVIDUAL', fuente: 'rfee_pdf' })).toBe('Copa Mundo Júnior');
    expect(nombrePrueba({ nombre: 'TNR ABS (3/3)', formato: 'INDIVIDUAL', fuente: 'skermo_rfee' })).toBe('TNR ABS (3/3)');
  });
});
