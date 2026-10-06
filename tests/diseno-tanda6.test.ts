import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/calendario/ficha/resultados-accion', () => ({ podiosDelEvento: vi.fn() }));
vi.mock('lucide-react', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('lucide-react');
});
vi.mock('radix-ui', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('radix-ui');
});

const { CuerpoPodios } = await import('@/components/calendario/ficha/resultados-torneo');
const { CLASE_VER_MAS } = await import('@/components/explorar/buscador-social-fila');

const PRUEBA = '22222222-2222-4222-8222-222222222222';
const PERSONA = '33333333-3333-4333-8333-333333333333';

describe('objetivos de 44 px', () => {
  it('cada puesto del podio es una fila de 44 px; con ficha, la fila entera es el enlace', () => {
    const html = renderToStaticMarkup(React.createElement(CuerpoPodios, {
      vista: {
        tipo: 'ok',
        ediciones: [{
          id: '11111111-1111-4111-8111-111111111111', nombre: 'Coupe du Monde', temporada: '2026', fuente: 'fie',
          ciudad: 'Samsun', pais: 'TUR', inicio: null, fin: null, pruebas: 1, armas: ['FLORETE'], formatos: ['INDIVIDUAL'], serie: null,
          pruebasDetalle: [{
            id: PRUEBA, arma: 'FLORETE', genero: 'F', categoria: { codigo: 'M20', raw: null }, formato: 'INDIVIDUAL',
            fecha: null, fuente: 'fie', pruebaCalendarioId: null, resultados: { estado: 'completo', importados: 64 }, enlaces: [],
          }],
        }],
        podios: {
          [PRUEBA]: [
            { puesto: 1, nombre: 'TIE Zhihe', pais: 'CHN', club: 'Pekín', personaId: PERSONA },
            { puesto: 2, nombre: 'KUS Natasza', pais: 'POL', club: null, personaId: null },
          ],
        },
      } as never,
    }));
    const enlace = html.match(new RegExp(`<a [^>]*href="[^"]*${PERSONA}[^"]*"[^>]*>`))?.[0] ?? '';
    expect(enlace).toContain('min-h-11');
    expect(html.slice(html.indexOf(enlace))).toMatch(/^<a [^>]*>((?!<\/a>).)*Zhihe((?!<\/a>).)*Pekín/s);
    expect(html).toMatch(/<span class="flex min-h-11[^"]*">((?!<\/li>).)*Natasza/s);
  });

  it('«Ver más» de Buscar mide 44 px dibujados', () => {
    expect(CLASE_VER_MAS).toMatch(/\bh-11\b/);
    expect(CLASE_VER_MAS).not.toContain('before:');
  });

  it('en el móvil, «Hoy» y los filtros del calendario tienen ancho fijo y la fila no salta al llegar la fuente', () => {
    const vista = readFileSync(new URL('../src/components/calendario/vista.tsx', import.meta.url), 'utf8');
    expect(vista).toContain('className="h-11 px-3 max-sm:w-11 max-sm:px-0"');
    expect(vista).toMatch(/className="h-11 shrink-0 gap-1\.5 px-3 max-sm:max-w-24"/);
    expect(vista).toContain('cifra min-w-0 truncate text-sm leading-none tracking-tight');
  });
});
