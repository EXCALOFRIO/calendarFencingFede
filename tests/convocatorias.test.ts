import { describe, expect, it } from 'vitest';
import {
  convocatoriaVisible,
  ocultasPorArma,
} from '@/app/(app)/convocatorias/filtro';
import { armasDeArranque } from '@/lib/ambito';
import type { Weapon } from '@/lib/auth/session';

/**
 * El filtro de arma de «Selección».
 *
 * Tiene pruebas por el mismo motivo que `arranqueDelCalendario`: es una regla
 * de visibilidad, y esas se rompen en silencio. El fallo que arregla estuvo
 * meses en la pantalla —el seleccionador de florete veía «Selección Sub-23 de
 * espada femenina»— sin que ningún error saltara en ninguna parte.
 *
 * Aquí se prueba **la composición de las dos mitades**: el arranque, que es de
 * `src/lib/ambito.ts` y no se reescribe, y la decisión de enseñar o no, que es
 * de `filtro.ts`.
 */

const FLORETE: Weapon[] = ['FLORETE'];
const ESPADA: Weapon[] = ['ESPADA'];
const SABLE: Weapon[] = ['SABLE'];
const TODAS: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];

describe('convocatoriaVisible', () => {
  it('el seleccionador de florete NO ve la de espada', () => {
    // Es exactamente el fallo que se arregla, con los datos de la pantalla
    // real: «Selección Sub-23 de espada femenina» con el filtro en florete.
    expect(convocatoriaVisible(ESPADA, FLORETE)).toBe(false);
    expect(convocatoriaVisible(SABLE, FLORETE)).toBe(false);
  });

  it('el seleccionador de florete ve la de florete', () => {
    expect(convocatoriaVisible(FLORETE, FLORETE)).toBe(true);
  });

  it('una convocatoria con varias armas entra si toca alguna', () => {
    // Un campeonato de España se convoca con las tres armas en el mismo
    // documento: al seleccionador de florete le interesa entero.
    expect(convocatoriaVisible(TODAS, FLORETE)).toBe(true);
    expect(convocatoriaVisible(['ESPADA', 'FLORETE'], FLORETE)).toBe(true);
    expect(convocatoriaVisible(['ESPADA', 'SABLE'], FLORETE)).toBe(false);
  });

  it('con las tres marcadas se ve todo: es lo que ve la dirección técnica', () => {
    expect(convocatoriaVisible(ESPADA, TODAS)).toBe(true);
    expect(convocatoriaVisible(SABLE, TODAS)).toBe(true);
    expect(convocatoriaVisible([], TODAS)).toBe(true);
  });

  it('sin ninguna marcada tampoco se filtra', () => {
    // Desmarcar las tres es «quiero verlo todo», no «no quiero ver nada»:
    // dejar la pantalla en blanco no contesta ninguna pregunta.
    expect(convocatoriaVisible(ESPADA, [])).toBe(true);
  });

  it('una convocatoria sin prueba asignada no se esconde nunca', () => {
    // `call_up_athlete.event_competition_id` es opcional, así que un borrador
    // recién creado no tiene arma todavía. Esconderlo sería el mismo fallo al
    // revés: el seleccionador dejaría de ver su propio borrador.
    expect(convocatoriaVisible([], FLORETE)).toBe(true);
    expect(convocatoriaVisible([], ESPADA)).toBe(true);
  });
});

describe('ocultasPorArma', () => {
  const lista = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const armas: Record<string, Weapon[]> = {
    a: ESPADA,
    b: ESPADA,
    c: FLORETE,
  };

  it('cuenta las que el filtro deja fuera, para poder decirlo', () => {
    expect(ocultasPorArma(lista, armas, FLORETE)).toBe(2);
    expect(ocultasPorArma(lista, armas, ESPADA)).toBe(1);
  });

  it('sin filtro no oculta ninguna', () => {
    expect(ocultasPorArma(lista, armas, TODAS)).toBe(0);
  });

  it('una convocatoria sin armas conocidas no cuenta como oculta', () => {
    expect(ocultasPorArma([{ id: 'x' }], {}, FLORETE)).toBe(0);
  });
});

describe('el arranque y el filtro, juntos', () => {
  it('el seleccionador de florete arranca viendo solo florete', () => {
    const arranque = armasDeArranque({ role: 'coach', weapons: FLORETE });
    expect(arranque).toEqual(FLORETE);
    expect(convocatoriaVisible(ESPADA, arranque)).toBe(false);
    expect(convocatoriaVisible(FLORETE, arranque)).toBe(true);
  });

  it('la dirección técnica arranca viéndolo todo', () => {
    const arranque = armasDeArranque({ role: 'admin', weapons: [] });
    expect(arranque).toEqual(TODAS);
    expect(convocatoriaVisible(ESPADA, arranque)).toBe(true);
    expect(convocatoriaVisible(SABLE, arranque)).toBe(true);
  });

  it('un seleccionador sin arma asignada ve todo, no nada', () => {
    const arranque = armasDeArranque({ role: 'coach', weapons: [] });
    expect(arranque).toEqual(TODAS);
    expect(convocatoriaVisible(ESPADA, arranque)).toBe(true);
  });

  it('un seleccionador de dos armas ve las dos y no la tercera', () => {
    const arranque = armasDeArranque({
      role: 'coach',
      weapons: ['FLORETE', 'SABLE'],
    });
    expect(convocatoriaVisible(FLORETE, arranque)).toBe(true);
    expect(convocatoriaVisible(SABLE, arranque)).toBe(true);
    expect(convocatoriaVisible(ESPADA, arranque)).toBe(false);
  });
});
