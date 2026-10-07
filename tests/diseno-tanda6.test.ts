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
    expect(enlace).toContain('min-h-[44px]');
    expect(html.slice(html.indexOf(enlace))).toMatch(/^<a [^>]*>((?!<\/a>).)*Zhihe((?!<\/a>).)*Pekín/s);
    expect(html).toMatch(/<span class="flex min-h-\[44px\][^"]*">((?!<\/li>).)*Natasza/s);
  });

  it('«Ver más» de Buscar es texto de acento con 44 px de toque', () => {
    expect(CLASE_VER_MAS).toMatch(/\bh-\[44px\]/);
    expect(CLASE_VER_MAS).not.toContain('before:');
  });

  it('la cabecera del calendario usa los controles del sistema: 32 px a la vista y 44 de toque', () => {
    const vista = readFileSync(new URL('../src/components/calendario/vista.tsx', import.meta.url), 'utf8');
    // Flechas y lupa como `BotonIcono` md (32 px); «Hoy» como `Boton` sm; los filtros, una fila de chips.
    expect(vista).toMatch(/<BotonIcono\s+etiqueta=\{vista === 'mes' \? 'Mes anterior' : 'Trimestre anterior'\}\s+tamano="md"/);
    expect(vista).toMatch(/<Boton\s+tamano="sm"\s+aria-label="Hoy: ir al mes actual"/);
    expect(vista).toContain('<FilaChips etiqueta="Filtros del calendario">');
    expect(vista).toContain('tipo="menu"');
    // Nada de alturas en rem en la cabecera: con la raíz de 18 px crecían en el móvil.
    expect(vista).not.toMatch(/className="h-11\b/);
  });
});
