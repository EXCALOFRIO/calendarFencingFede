import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuscadorSocial, estadoBuscador } from '@/components/explorar/buscador-social';
import { FilaPerfil, PropuestasBuscador, datoCorto } from '@/components/explorar/buscador-social-fila';
import {
  MAX_RECIENTES,
  anadirReciente,
  claveRecientes,
  leerRecientes,
  quitarReciente,
} from '@/lib/sport/explorar/recientes';
import { UUID_A as A, UUID_B as B } from './helpers/explorar';

const persona = (id: string, nombre = 'ZABALA Juan', pais: string | null = 'ESP') => ({ id, nombre, pais });
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

describe('recientes del buscador (localStorage)', () => {
  it('la clave separa cuentas', () => {
    expect(claveRecientes('cuenta-1')).not.toBe(claveRecientes('cuenta-2'));
  });

  it('valida lo leído campo a campo y descarta lo manipulado', () => {
    const texto = JSON.stringify([
      persona(A),
      persona(A.toUpperCase()),
      { id: 'no-es-uuid', nombre: 'X', pais: 'ESP' },
      { id: B, nombre: '', pais: 'ESP' },
      { id: B, nombre: 'Otra', pais: '<script>' },
      'basura',
    ]);
    expect(leerRecientes(texto)).toEqual([persona(A), { id: B, nombre: 'Otra', pais: null }]);
    expect(leerRecientes('{no json')).toEqual([]);
    expect(leerRecientes('{"id":1}')).toEqual([]);
    expect(leerRecientes(null)).toEqual([]);
    expect(leerRecientes('x'.repeat(9000))).toEqual([]);
  });

  it('la última abierta pasa la primera, sin duplicados y como mucho doce', () => {
    let lista = Array.from({ length: MAX_RECIENTES }, (_, i) => persona(uuid(i), `P${i}`));
    lista = anadirReciente(lista, persona(uuid(5), 'P5'));
    expect(lista[0].id).toBe(uuid(5));
    expect(lista).toHaveLength(MAX_RECIENTES);
    lista = anadirReciente(lista, persona(uuid(99), 'Nueva'));
    expect(lista).toHaveLength(MAX_RECIENTES);
    expect(lista.map((p) => p.id)).not.toContain(uuid(11));
    expect(quitarReciente(lista, uuid(99).toUpperCase()).map((p) => p.id)).not.toContain(uuid(99));
  });
});

describe('estado del buscador social', () => {
  it('pide perfiles desde tres letras y no repite la búsqueda que ya pinta la página', () => {
    expect(estadoBuscador('', '')).toEqual({ vivo: null, corto: false });
    expect(estadoBuscador('za', '')).toEqual({ vivo: null, corto: true });
    expect(estadoBuscador('zab', '')).toEqual({ vivo: 'zab', corto: false });
    expect(estadoBuscador('  zabala   juan ', '')).toEqual({ vivo: 'zabala juan', corto: false });
    expect(estadoBuscador('zabala', 'zabala')).toEqual({ vivo: null, corto: false });
    expect(estadoBuscador('zabal', 'zabala')).toEqual({ vivo: 'zabal', corto: false });
  });

  it('dato corto: un arma, si no el número de pruebas, si no las armas', () => {
    expect(datoCorto({ armas: ['ESPADA'], resultados: 103 })).toBe('Espada');
    expect(datoCorto({ armas: ['ESPADA', 'FLORETE'], resultados: 1 })).toBe('1 prueba');
    expect(datoCorto({ resultados: 12500 })).toBe('12.500 pruebas');
    expect(datoCorto({ armas: ['ESPADA', 'SABLE'], resultados: 0 })).toBe('Espada, Sable');
    expect(datoCorto({ resultados: 0 })).toBeNull();
  });
});

describe('vista del buscador social', () => {
  const render = (props: Partial<React.ComponentProps<typeof BuscadorSocial>> = {}) =>
    renderToStaticMarkup(
      React.createElement(BuscadorSocial, {
        valor: '',
        onChange: () => {},
        qUrl: '',
        volverDe: (q: string) => `/explorar?q=${q}`,
        ...props,
      }, React.createElement('p', null, 'CONTENIDO DE LA PÁGINA')),
    );

  it('sin texto enseña el contenido de la página y un campo etiquetado', () => {
    const html = render();
    expect(html).toContain('CONTENIDO DE LA PÁGINA');
    expect(html).toContain('for="explorar-q"');
    expect(html).toContain('placeholder="Buscar tiradores"');
    expect(html).toContain('enterKeyHint="search"');
    expect(html).not.toContain('Ver todos los resultados');
  });

  it('con texto sustituye el contenido por los perfiles y ofrece la búsqueda completa', () => {
    const html = render({ valor: 'zabal', avisoFiltros: true });
    expect(html).not.toContain('CONTENIDO DE LA PÁGINA');
    expect(html).toContain('Ver todos los resultados de «zabal»');
    expect(html).toContain('type="submit"');
    expect(html).toContain('los filtros se aplican al ver todos los resultados');
    expect(html).toContain('aria-label="Borrar búsqueda"');
  });

  it('una fila de perfil separa el enlace y el botón, y lleva lo necesario para recientes', () => {
    const html = renderToStaticMarkup(
      React.createElement('ul', null, React.createElement(FilaPerfil, {
        p: { id: A, nombre: 'ZABALA Juan', pais: 'ESP', armas: ['ESPADA'], resultados: 103, ultimaFecha: '2026-02-01' },
        accion: React.createElement('button', { type: 'button' }, 'Seguir'),
      })),
    );
    expect(html).toContain(`data-persona="${A}"`);
    expect(html).toContain('data-pais="ESP"');
    expect(html).toContain('>Espada<');
    expect(html).not.toContain('competiciones');
    expect(html).toMatch(/<\/a><button/);
  });

  it('las propuestas para seguir son filas con «Seguir»; si fallan se dice sin romper la página', () => {
    const html = renderToStaticMarkup(React.createElement(PropuestasBuscador, {
      propuestas: [{ id: A, nombre: 'ZABALA Juan', pais: 'ESP', motivo: '3º FIE' }],
    }));
    expect(html).toContain('>Sugerencias<');
    expect(html).toContain('3º FIE');
    expect(html).toContain('Seguir');
    expect(renderToStaticMarkup(React.createElement(PropuestasBuscador, { propuestas: null })))
      .toContain('No se han podido leer las sugerencias');
    expect(renderToStaticMarkup(React.createElement(PropuestasBuscador, { propuestas: [] }))).toBe('');
  });
});
