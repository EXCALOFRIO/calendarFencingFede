import { describe, expect, it } from 'vitest';
import {
  ARMAS,
  CATEGORIA_DEL_SELECCIONADOR,
  armasDeArranque,
  arranqueDelCalendario,
  ordenarCategorias,
  type PerfilAmbito,
  type TiradorAmbito,
} from '@/lib/ambito';

/**
 * Qué ve cada uno al entrar.
 *
 * Esto es una regla de VISIBILIDAD, y esas se rompen sin que salte ningún
 * error: nadie ve una pantalla roja, simplemente el seleccionador de espada
 * empieza a mirar el calendario de florete y no se entera hasta que se le
 * pasa un plazo. De ahí que cada caso esté escrito como una frase.
 *
 * Fichero aparte de `dominio.test.ts` a propósito: ahí hay trabajo en curso.
 */

/** Las categorías que trae de verdad el calendario de la temporada. */
const DISPONIBLES = ['M13', 'M15', 'M17', 'M20', 'ABS', 'VET'];

const FLORETE: PerfilAmbito = { role: 'coach', weapons: ['FLORETE'] };
const DIRECCION_TECNICA: PerfilAmbito = { role: 'admin', weapons: [] };
const TIRADORA: PerfilAmbito = { role: 'athlete', weapons: [] };

describe('el seleccionador entra en lo suyo', () => {
  it('un seleccionador de florete arranca en florete y en ningún arma más', () => {
    const a = arranqueDelCalendario(FLORETE, null, DISPONIBLES);
    expect(a.armas).toEqual(['FLORETE']);
  });

  it('lleva los DOS géneros de su arma, no uno', () => {
    const a = arranqueDelCalendario(FLORETE, null, DISPONIBLES);
    expect(a.generos).toEqual(['M', 'F']);
  });

  it('arranca en absoluto, que es el equipo del que responde', () => {
    const a = arranqueDelCalendario(FLORETE, null, DISPONIBLES);
    expect(a.categorias).toEqual([CATEGORIA_DEL_SELECCIONADOR]);
  });

  it('quien lleva dos armas arranca con las dos', () => {
    const a = arranqueDelCalendario(
      { role: 'coach', weapons: ['FLORETE', 'ESPADA'] },
      null,
      DISPONIBLES,
    );
    expect(a.armas).toEqual(['FLORETE', 'ESPADA']);
  });

  it('puede quitarse el filtro: «lo mío» y «todo» son distintos', () => {
    expect(arranqueDelCalendario(FLORETE, null, DISPONIBLES).propio).toBe(true);
  });

  /**
   * Si la temporada no publicase ninguna prueba absoluta, filtrar por absoluto
   * dejaría la pantalla en blanco. Un calendario vacío no responde a ninguna
   * pregunta, así que en ese caso se abre entero.
   */
  it('si no hay ninguna prueba absoluta, no filtra por absoluto', () => {
    const a = arranqueDelCalendario(FLORETE, null, ['M17', 'M20']);
    expect(a.categorias).toEqual(['M17', 'M20']);
  });

  it('sin arma asignada no se adivina ninguna: se abre todo', () => {
    const a = arranqueDelCalendario({ role: 'coach', weapons: [] }, null, DISPONIBLES);
    expect(a.armas).toEqual(ARMAS);
    expect(a.categorias).toEqual(DISPONIBLES);
    expect(a.propio).toBe(false);
  });
});

describe('la dirección técnica lo ve todo', () => {
  /**
   * Esto es lo que estaba roto: sin ficha de tirador el calendario caía en un
   * `['FLORETE']` escrito a mano, así que la dirección técnica entraba viendo
   * solo florete y sin ningún botón para salir de ahí. La espada y el sable
   * existían y no había forma de saberlo.
   */
  it('un admin arranca con las tres armas, no solo con florete', () => {
    const a = arranqueDelCalendario(DIRECCION_TECNICA, null, DISPONIBLES);
    expect(a.armas).toEqual(ARMAS);
  });

  it('con los dos géneros y todas las categorías', () => {
    const a = arranqueDelCalendario(DIRECCION_TECNICA, null, DISPONIBLES);
    expect(a.generos).toEqual(['M', 'F']);
    expect(a.categorias).toEqual(DISPONIBLES);
  });

  it('no se le ofrece «solo lo mío», porque lo suyo ya es todo', () => {
    expect(arranqueDelCalendario(DIRECCION_TECNICA, null, DISPONIBLES).propio).toBe(
      false,
    );
  });
});

describe('la ficha del tirador manda sobre el papel', () => {
  const carlos: TiradorAmbito = {
    weapons: ['FLORETE'],
    gender: 'M',
    // Un absoluto de 34 años: absoluto y veteranos, nunca M17.
    eligibleCategories: ['ABS', 'VET'],
  };

  it('un tirador ve su arma, su género y sus categorías', () => {
    const a = arranqueDelCalendario(TIRADORA, carlos, DISPONIBLES);
    expect(a.armas).toEqual(['FLORETE']);
    expect(a.generos).toEqual(['M']);
    expect(a.categorias).toEqual(['ABS', 'VET']);
    expect(a.propio).toBe(true);
  });

  it('a un absoluto no le salen las Copas del Mundo cadete', () => {
    const a = arranqueDelCalendario(TIRADORA, carlos, DISPONIBLES);
    expect(a.categorias).not.toContain('M17');
  });

  /**
   * Un seleccionador que además tiene ficha propia —fue tirador, o lo sigue
   * siendo de veteranos— se mira el calendario como tirador cuando hay ficha
   * delante. Es lo que espera: el selector de tirador está puesto en él.
   */
  it('con ficha delante manda la ficha, aunque la cuenta sea de seleccionador', () => {
    const a = arranqueDelCalendario(FLORETE, { ...carlos, weapons: ['SABLE'] }, DISPONIBLES);
    expect(a.armas).toEqual(['SABLE']);
  });

  it('una ficha mixta o sin género no elige uno por defecto: los dos', () => {
    const a = arranqueDelCalendario(
      TIRADORA,
      { weapons: ['ESPADA'], gender: 'MIXTO', eligibleCategories: ['ABS'] },
      DISPONIBLES,
    );
    expect(a.generos).toEqual(['M', 'F']);
  });

  it('una ficha sin arma no deja el calendario vacío: se abre entero', () => {
    const a = arranqueDelCalendario(
      TIRADORA,
      { weapons: [], gender: 'F', eligibleCategories: [] },
      DISPONIBLES,
    );
    expect(a.armas).toEqual(ARMAS);
    expect(a.categorias).toEqual(DISPONIBLES);
  });

  it('descarta categorías que este año no se compiten', () => {
    const a = arranqueDelCalendario(
      TIRADORA,
      { weapons: ['SABLE'], gender: 'F', eligibleCategories: ['M17', 'M9'] },
      DISPONIBLES,
    );
    expect(a.categorias).toEqual(['M17']);
  });

  it('descarta armas que no existen en el dominio', () => {
    const a = arranqueDelCalendario(
      TIRADORA,
      { weapons: ['FLORETE', 'BASTON'], gender: 'F', eligibleCategories: ['ABS'] },
      DISPONIBLES,
    );
    expect(a.armas).toEqual(['FLORETE']);
  });
});

describe('armas de arranque en la pantalla de tiradores', () => {
  it('el seleccionador ve los suyos', () => {
    expect(armasDeArranque(FLORETE)).toEqual(['FLORETE']);
  });

  it('quien lleva dos armas ve los de sus dos armas', () => {
    expect(armasDeArranque({ role: 'coach', weapons: ['ESPADA', 'SABLE'] })).toEqual([
      'ESPADA',
      'SABLE',
    ]);
  });

  it('la dirección técnica ve a la federación entera', () => {
    expect(armasDeArranque(DIRECCION_TECNICA)).toEqual(ARMAS);
  });

  it('un seleccionador sin arma ve todas, no ninguna', () => {
    expect(armasDeArranque({ role: 'coach', weapons: [] })).toEqual(ARMAS);
  });
});

describe('orden de las categorías', () => {
  it('va de la más pequeña a la más grande, no en orden alfabético', () => {
    expect(ordenarCategorias(['ABS', 'M13', 'VET', 'M20'])).toEqual([
      'M13',
      'M20',
      'ABS',
      'VET',
    ]);
  });

  it('no modifica el array que recibe', () => {
    const entrada = ['ABS', 'M13'];
    ordenarCategorias(entrada);
    expect(entrada).toEqual(['ABS', 'M13']);
  });
});
