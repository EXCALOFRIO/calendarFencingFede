import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PouleDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { UUID_A, UUID_B } from './helpers/explorar';

vi.mock('@/app/(app)/explorar/favoritos-acciones', () => ({
  guardarFavoritoAccion: vi.fn(),
  quitarFavoritoAccion: vi.fn(),
}));

const { MatrizPoule } = await import('@/components/explorar/prueba/hoja-poule');
const { nombreCompacto } = await import('@/lib/sport/nombre-visible');
const { PoulesDePrueba } = await import('@/components/explorar/asaltos-prueba');
const { BotonSeguirCompacto } = await import('@/components/explorar/buscador-social-seguir');
const { FilaPerfil } = await import('@/components/explorar/buscador-social-fila');
const { ListaClasificacion, repiteNombre } = await import('@/components/explorar/prueba/clasificacion');

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

const v = (tantos: number) => ({ tantos, victoria: true });
const d = (tantos: number) => ({ tantos, victoria: false });
const poule: PouleDePrueba = {
  ronda: 'P1',
  etiqueta: 'Poule 1',
  filas: [
    { clave: 'a', personaId: UUID_A, nombre: 'ZABALA GUTIERREZ Juan', pais: 'ESP', celdas: [null, v(5), d(2)], victorias: 1, asaltos: 2, tocados: 7, recibidos: 8 },
    { clave: 'b', personaId: UUID_B, nombre: 'DE LA FUENTE RUIZ Bea', pais: 'FRA', celdas: [d(3), null, v(5)], victorias: 1, asaltos: 2, tocados: 8, recibidos: 7 },
    { clave: 'c', personaId: null, nombre: 'DIAZ Carla', pais: 'ITA', celdas: [v(5), d(1), null], victorias: 1, asaltos: 2, tocados: 6, recibidos: 7 },
  ],
};

describe('hoja de la poule: nombres compactos y totales fijos', () => {
  it('primer apellido con sus partículas e inicial del nombre', () => {
    expect(nombreCompacto('ZABALA GUTIERREZ Juan')).toBe('Zabala J.');
    expect(nombreCompacto('DE LA FUENTE RUIZ Bea')).toBe('De la Fuente B.');
    expect(nombreCompacto('ANGULO SAN MARTIN Alejandro')).toBe('Angulo A.');
    expect(nombreCompacto('SAN MARTIN Alejandro')).toBe('San Martin A.');
    // Sin separar apellidos y nombre no se sabe cuál es el apellido.
    expect(nombreCompacto('Juan Zabala')).toBe('Juan Zabala');
  });

  it('los cinco totales van fijos a la derecha, apilados por su ancho', () => {
    const marcado = html(React.createElement(MatrizPoule, { poule, enlace: (id: string) => `/explorar/${id}`, filtro: { consulta: '' } }));
    const derechas = [...marcado.matchAll(/<th scope="col" class="[^"]*sticky[^"]*" style="right:(\d+)(?:px)?"><abbr[^>]*>(\w+)<\/abbr>/g)].map((m) => [m[2], Number(m[1])]);
    expect(derechas).toEqual([['V', 94], ['TD', 72], ['TR', 50], ['Ind', 24], ['Pto', 0]]);
    // Cada fila repite los cinco fijos.
    expect(marcado.match(/<td class="[^"]*sticky[^"]*"/g)).toHaveLength(15);
    // Ancho mínimo: nombre de 96 px + 3 casillas de 26 + 114 de totales.
    expect(marcado).toContain('min-width:288px');
  });

  it('el nombre es un enlace de 44 px con el nombre compacto y el completo para el lector', () => {
    const marcado = html(React.createElement(MatrizPoule, { poule, enlace: (id: string) => `/explorar/${id}`, filtro: { consulta: '' } }));
    // Sin aria-label que tape el apellido visible (WCAG 2.5.3): el nombre entero va en sr-only.
    expect(marcado).toMatch(/<a [^>]*class="flex min-h-\[44px\][^"]*"/);
    expect(marcado).not.toContain('aria-label="Ficha de');
    expect(marcado).toContain('<span class="sr-only">: Juan Zabala Gutierrez</span>');
    expect(marcado).toContain('>Zabala J.<');
    expect(marcado).toContain('>De la Fuente B.<');
    // Quien no tiene ficha conserva el nombre completo para el lector.
    expect(marcado).toContain('<span class="sr-only">: Carla Diaz</span>');
  });
});

describe('lista de la poule en móvil', () => {
  it('el enlace del nombre llena su hueco con 44 px de alto sin engordar la fila', () => {
    const marcado = html(React.createElement(PoulesDePrueba, { poules: [poule], enlace: (id: string) => `/explorar/${id}`, filtro: { consulta: '' } }));
    expect(marcado).toMatch(/<a [^>]*class="[^"]*flex min-h-\[44px\] flex-1 items-center[^"]*"[^>]*><span class="min-w-0 truncate">Zabala J\.<\/span><span class="sr-only">: Juan Zabala Gutierrez<\/span><\/a>/);
    expect(marcado).toContain('grid min-h-[44px] items-center');
    expect(marcado).not.toContain('min-h-10');
    // En la tabla ancha el toque cubre la casilla del nombre.
    expect(marcado).toContain("after:absolute after:inset-0 after:content-[&#x27;&#x27;]");
  });
});

describe('Buscar en 320 px', () => {
  const lectura = { id: UUID_A };

  it('«Seguir» lleva etiqueta y por debajo de 360 px es un icono de 44 × 44', () => {
    const marcado = html(React.createElement(BotonSeguirCompacto, { personaId: UUID_A, nombre: 'Juan Zabala', inicial: false, lectura }));
    expect(marcado).toContain('aria-label="Seguir a Juan Zabala"');
    expect(marcado).toContain('max-[359px]:size-[44px]');
    expect(marcado).toContain('<span class="max-[359px]:sr-only">Seguir</span>');
    expect(marcado).toMatch(/<svg[^>]*class="lucide lucide-user-plus[^"]*min-\[360px\]:hidden"/);
  });

  it('siguiendo, la etiqueta dice cómo dejar de seguir y queda la marca', () => {
    const marcado = html(React.createElement(BotonSeguirCompacto, { personaId: UUID_A, nombre: 'Juan Zabala', inicial: true, lectura }));
    expect(marcado).toContain('aria-label="Siguiendo: toca para dejar de seguir a Juan Zabala"');
    expect(marcado).toMatch(/<svg[^>]*class="lucide lucide-check[^"]*min-\[360px\]:size-\[14px\]"/);
  });

  it('la fila enseña la bandera sin repetir el código del país', () => {
    const marcado = html(React.createElement('ul', null, React.createElement(FilaPerfil, {
      p: { id: UUID_A, nombre: 'ZABALA Juan', pais: 'ESP', armas: ['ESPADA'], resultados: 3 },
    })));
    expect(marcado).toContain('src="/banderas/es.png"');
    expect(marcado).not.toMatch(/<abbr[^>]*>ESP<\/abbr>/);
    // El lector oye el país, no el código.
    expect(marcado).toContain('<span class="sr-only">España</span>');
  });
});

describe('clasificación de equipos con nombre en código', () => {
  it('el subtítulo no se repite si es el mismo nombre', () => {
    expect(repiteNombre('Vce-Va', 'VCE-VA')).toBe(true);
    expect(repiteNombre('Coe M', 'COE-M')).toBe(true);
    expect(repiteNombre('España', 'ESPANA')).toBe(true);
    expect(repiteNombre('Ana García', 'Club Esgrima Madrid')).toBe(false);
    expect(repiteNombre('Vce-Va', null)).toBe(false);
  });

  it('no pinta el club: el equipo ya se llama por su nombre', () => {
    const marcado = html(React.createElement(ListaClasificacion, {
      filas: [
        { id: 'e1', puesto: 2, puestoPublicado: null, nombre: 'VCE-VA', pais: 'ESP', club: 'VCE-VA', personaId: null },
        { id: 'e2', puesto: 5, puestoPublicado: null, nombre: 'GARCIA Ana', pais: 'ESP', club: 'Club Madrid', personaId: null },
      ],
    }));
    expect(marcado.match(/VCE-VA|Vce-Va/g)).toHaveLength(1);
    expect(marcado).not.toContain('Club Madrid');
  });
});
