import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilaClasificacion } from '@/lib/sport/explorar/edicion-modelo';
import type { AsaltosDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { UUID_A, UUID_B, UUID_C } from './helpers/explorar';

const cargar = vi.fn();
vi.mock('@/lib/sport/explorar/cache-real', () => ({ cargarEdicionCompartida: (...a: unknown[]) => cargar(...a) }));
vi.mock('@/lib/sport/explorar/real', () => ({ contextoReal: () => ({}) }));

const { VistaPrueba } = await import('@/components/explorar/prueba/vista-prueba');
const { TRAMO_CLASIFICACION } = await import('@/components/explorar/prueba/vista-prueba-cliente');
const { datosDeVista, disponiblesDePrueba, tieneVista } = await import('@/lib/sport/explorar/prueba-datos');
const { cargarVistaDePrueba } = await import('@/lib/sport/explorar/prueba-acciones');

const html = (nodo: React.ReactElement) => renderToStaticMarkup(nodo);

const filas = (n: number, persona?: { en: number; id: string }): FilaClasificacion[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    puesto: i + 1,
    puestoPublicado: null,
    nombre: `TIRADOR${i} Nombre`,
    pais: 'ESP',
    club: 'Club que no viaja',
    personaId: persona && persona.en === i ? persona.id : null,
  }));

const asaltos: AsaltosDePrueba = {
  fuente: 'fie',
  truncado: false,
  poules: [{
    ronda: 'P1',
    etiqueta: 'Poule 1',
    filas: [
      { clave: 'P1-0', personaId: UUID_A, nombre: 'ANA Uno', pais: 'ESP', celdas: [null, { tantos: 5, victoria: true }], victorias: 1, asaltos: 1, tocados: 5, recibidos: 2 },
      { clave: 'P1-1', personaId: null, nombre: 'BEA Dos', pais: 'FRA', celdas: [{ tantos: 2, victoria: false }, null], victorias: 0, asaltos: 1, tocados: 2, recibidos: 5 },
    ],
  }],
  cuadro: [{
    ronda: 'A2', etiqueta: 'Final', tamano: 2,
    asaltos: [{ id: 'f', ronda: 'A2', a: { personaId: UUID_A, nombre: 'ANA Uno', pais: 'ESP', tantos: 15 }, b: { personaId: null, nombre: 'BEA Dos', pais: 'FRA', tantos: 9 } }],
  }],
};

const base = { prueba: UUID_B, cursor: '' };

describe('sólo cruza al cliente la vista abierta', () => {
  it('cada vista lleva sus datos y nada más; la clasificación, sin club', () => {
    const clasificacion = filas(3);
    const c = datosDeVista('clasificacion', clasificacion, asaltos);
    expect(Object.keys(c)).toEqual(['clasificacion']);
    expect(c.clasificacion?.[0]).not.toHaveProperty('club');
    expect(Object.keys(datosDeVista('poules', clasificacion, asaltos))).toEqual(['poules']);
    expect(Object.keys(datosDeVista('directas', clasificacion, asaltos))).toEqual(['cuadro']);
    expect(datosDeVista('poules', clasificacion, null)).toEqual({ poules: [] });
    expect(tieneVista({ poules: [] }, 'poules')).toBe(true);
    expect(tieneVista({ poules: [] }, 'directas')).toBe(false);
    expect(disponiblesDePrueba([], asaltos)).toEqual({ clasificacion: false, poules: true, directas: true });
  });

  it('abierta en poules, la página no pinta la clasificación pero ofrece las tres vistas', () => {
    const marcado = html(React.createElement(VistaPrueba, {
      edicionId: UUID_A, base, vista: 'poules', clasificacion: filas(40), asaltos,
    }));
    expect(marcado).toContain('aria-label="Poule 1"');
    expect(marcado).not.toContain('aria-label="Clasificación"');
    expect(marcado).not.toContain('Tirador0');
    expect(marcado.match(/aria-controls="[^"]*-panel"/g)).toHaveLength(3);
  });

  it('la clasificación pinta las cien primeras y «Ver más»; las filas no se maquetan fuera de pantalla', () => {
    const marcado = html(React.createElement(VistaPrueba, {
      edicionId: UUID_A, base, vista: 'clasificacion', clasificacion: filas(250), asaltos: null,
    }));
    expect(marcado.match(/<li id="puesto-/g)).toHaveLength(TRAMO_CLASIFICACION);
    expect(marcado).toMatch(/>Ver más<span class="sr-only"> puestos \(150 más\)<\/span><\/button>/);
    expect(marcado).toContain('[content-visibility:auto]');
    expect(marcado).toContain('[contain-intrinsic-size:auto_44px]');
    expect(marcado).not.toContain('Club que no viaja');
  });

  it('la persona de la dirección se pinta aunque esté más allá del tramo', () => {
    const marcado = html(React.createElement(VistaPrueba, {
      edicionId: UUID_A, base, persona: UUID_C, vista: 'clasificacion',
      clasificacion: filas(250, { en: 179, id: UUID_C }), asaltos: null,
    }));
    expect(marcado.match(/<li id="puesto-/g)).toHaveLength(180);
    expect(marcado).toContain('id="puesto-r179" data-resaltado="true"');
  });
});

describe('cargarVistaDePrueba', () => {
  beforeEach(() => cargar.mockReset());

  it('valida la entrada antes de leer nada', async () => {
    for (const entrada of [
      null,
      'x',
      { edicionId: 'no-es-id', prueba: UUID_B, vista: 'poules' },
      { edicionId: UUID_A, prueba: 'no-es-id', vista: 'poules' },
      { edicionId: UUID_A, prueba: UUID_B, vista: 'tablas' },
      { edicionId: UUID_A, prueba: UUID_B },
    ]) {
      expect(await cargarVistaDePrueba(entrada)).toBeNull();
    }
    expect(cargar).not.toHaveBeenCalled();
  });

  it('sin sesión o sin edición devuelve null; con ella, sólo la vista pedida', async () => {
    cargar.mockResolvedValueOnce({ tipo: 'sin_sesion' });
    expect(await cargarVistaDePrueba({ edicionId: UUID_A, prueba: UUID_B, vista: 'poules' })).toBeNull();
    cargar.mockResolvedValue({ tipo: 'ok', edicion: { clasificacion: { filas: filas(2) }, asaltos } });
    const poules = await cargarVistaDePrueba({ edicionId: UUID_A, prueba: UUID_B, vista: 'poules' });
    expect(poules).toEqual({ poules: asaltos.poules });
    const clasificacion = await cargarVistaDePrueba({ edicionId: UUID_A, prueba: UUID_B, cursor: 'c', vista: 'clasificacion' });
    expect(clasificacion?.clasificacion).toHaveLength(2);
    expect(cargar).toHaveBeenLastCalledWith({}, UUID_A, { prueba: UUID_B, cursor: 'c' });
    cargar.mockResolvedValue({ tipo: 'ok', edicion: { clasificacion: null, asaltos: 'error' } });
    expect(await cargarVistaDePrueba({ edicionId: UUID_A, prueba: UUID_B, vista: 'directas' })).toBeNull();
  });
});
