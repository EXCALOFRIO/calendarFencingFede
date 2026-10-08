import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PouleDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { UUID_A, UUID_B } from './helpers/explorar';

vi.mock('@/app/(app)/explorar/favoritos-acciones', () => ({
  guardarFavoritoAccion: vi.fn(),
  quitarFavoritoAccion: vi.fn(),
}));

const {
  ANCHO_TARJETA_360,
  CASILLA_MIN,
  NOMBRE_MIN,
  anchoSinNombre,
  casillaEstrecha,
  columnasPoule,
  conLetra,
  nombreEstrecho,
} = await import('@/components/explorar/prueba/medidas-poule');
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

describe('poule en su sitio: nombres compactos y matriz que cabe en 360 px', () => {
  it('primer apellido con sus partículas e inicial del nombre', () => {
    expect(nombreCompacto('ZABALA GUTIERREZ Juan')).toBe('Zabala J.');
    expect(nombreCompacto('DE LA FUENTE RUIZ Bea')).toBe('De la Fuente B.');
    expect(nombreCompacto('ANGULO SAN MARTIN Alejandro')).toBe('Angulo A.');
    expect(nombreCompacto('SAN MARTIN Alejandro')).toBe('San Martin A.');
    // Sin separar apellidos y nombre no se sabe cuál es el apellido.
    expect(nombreCompacto('Juan Zabala')).toBe('Juan Zabala');
  });

  it('a 360 px la matriz cabe sin desplazar: casillas de 22 a 30 px de 5 a 9 tiradores y el nombre no baja de 66', () => {
    const casillas = [5, 6, 7, 8, 9].map((n) => Math.floor(casillaEstrecha(n)));
    expect(casillas).toEqual([30, 30, 28, 25, 22]);
    for (const n of [5, 6, 7, 8, 9]) {
      expect(casillaEstrecha(n)).toBeGreaterThanOrEqual(22);
      expect(nombreEstrecho(n)).toBeGreaterThanOrEqual(NOMBRE_MIN);
      expect(anchoSinNombre(n) + NOMBRE_MIN).toBeLessThanOrEqual(ANCHO_TARJETA_360 + 0.001);
      expect(conLetra(n)).toBe(true);
    }
    // Poules raras: la casilla encoge (sin letra) y se recorta el nombre, nunca la tarjeta.
    for (const n of [10, 11, 12, 14]) {
      expect(anchoSinNombre(n)).toBeLessThan(ANCHO_TARJETA_360);
      expect(casillaEstrecha(n)).toBeGreaterThanOrEqual(CASILLA_MIN);
    }
    expect(conLetra(11)).toBe(false);
    // En 320 px las casillas se reparten el ancho real (cqw) con el mismo tope.
    expect(columnasPoule(7, true).asaltos).toContain('repeat(7, clamp(14px, calc((100cqw - 126px) / 7), 30px))');
    expect(columnasPoule(7, false).amplia).toBe(columnasPoule(7, false).resumen);
  });

  it('el nombre es un enlace de 44 px con el nombre compacto y el completo para el lector', () => {
    const marcado = html(React.createElement(PoulesDePrueba, { poules: [poule], enlace: (id: string) => `/explorar/${id}`, filtro: { consulta: '' }, caraInicial: 'asaltos' }));
    // Sin aria-label que tape el apellido visible (WCAG 2.5.3): el nombre entero va en sr-only.
    expect(marcado).toMatch(/<a [^>]*class="[^"]*flex min-h-\[44px\][^"]*"/);
    expect(marcado).not.toContain('aria-label="Ficha de');
    // Con los asaltos, «V5» / «D3» en cada casilla y la propia en gris.
    expect(marcado).toMatch(/<span aria-hidden="true">D<\/span>2/);
    expect(marcado.match(/bg-muted/g)).toHaveLength(3);
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
    expect(marcado).toMatch(/<li class="grid [^"]*min-h-\[44px\] items-center/);
    expect(marcado).not.toContain('min-h-10');
    // Ni botón «Hoja» ni área táctil que tape la tarjeta.
    expect(marcado).not.toContain('Hoja');
    expect(marcado).not.toContain('after:inset-0');
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
