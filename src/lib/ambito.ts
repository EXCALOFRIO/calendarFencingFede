import type { Role, Weapon } from '@/lib/auth/session';

/**
 * Ámbito de arranque: con qué filtros se abre el calendario según quién entra.
 *
 * Esto vive aquí, en una función sin React ni base de datos, porque es una
 * **regla de visibilidad** y las reglas de visibilidad se rompen en silencio:
 * nadie ve un error, simplemente alguien empieza a ver de menos —o de más— y
 * no se entera hasta que se pierde un torneo. Metida dentro de un
 * `useState(...)` no hay forma de probarla; aquí sí (`tests/ambito.test.ts`).
 *
 * Son filtros de ARRANQUE, no permisos. Nadie tiene prohibido ver nada: el
 * botón «Ver todo» abre el calendario entero para cualquiera. Lo único que se
 * decide aquí es qué aparece antes de tocar un control.
 */

export type Genero = 'M' | 'F';

export const ARMAS: Weapon[] = ['FLORETE', 'ESPADA', 'SABLE'];

export const GENEROS: Genero[] = ['M', 'F'];

/**
 * Con quién se mira el calendario cuando la cuenta lleva fichas de tirador
 * (un tirador, o un tutor con dos hijos).
 */
export type TiradorAmbito = {
  weapons: string[];
  gender: 'M' | 'F' | 'MIXTO';
  eligibleCategories: string[];
};

/** Lo mínimo del perfil que hace falta para decidir el ámbito. */
export type PerfilAmbito = {
  role: Role;
  /** Armas de las que se ocupa un seleccionador (`profile_weapon`). */
  weapons: Weapon[];
};

export type Arranque = {
  armas: Weapon[];
  generos: Genero[];
  categorias: string[];
  /**
   * Hay un «lo mío» distinto de «todo», así que el botón para ir y volver
   * tiene sentido. Para la dirección técnica no lo tiene: lo suyo ES todo.
   */
  propio: boolean;
};

/**
 * Categoría en la que arranca un seleccionador: el equipo absoluto.
 *
 * Es lo que pidió el usuario y además es lo que hace un seleccionador
 * nacional el 90 % del tiempo. NO se guarda por perfil, y es una decisión
 * pensada: ver el calendario de M17 no es un permiso ni un cargo, es lo que
 * estás mirando ahora mismo. El calendario no conserva los filtros entre
 * visitas a propósito («recargar devuelve a lo suyo»), así que una columna
 * `categoria_por_defecto` sería un dato que la base recuerda y la pantalla
 * tira: la peor de las dos opciones. El arma sí se guarda, porque el arma es
 * un nombramiento de la federación, no una pantalla.
 */
export const CATEGORIA_DEL_SELECCIONADOR = 'ABS';

/**
 * Orden de las categorías, de la más pequeña a la más grande. Se usa para
 * presentarlas siempre igual, sin depender del orden en que lleguen.
 */
const ORDEN_CATEGORIAS = [
  'M9',
  'M10',
  'M11',
  'M12',
  'M13',
  'M14',
  'M15',
  'M17',
  'M20',
  'M23',
  'ABS',
  'VET',
];

export function ordenarCategorias(codigos: string[]): string[] {
  return [...codigos].sort(
    (a, b) => ORDEN_CATEGORIAS.indexOf(a) - ORDEN_CATEGORIAS.indexOf(b),
  );
}

export function esArma(v: string): v is Weapon {
  return ARMAS.includes(v as Weapon);
}

/**
 * Con qué se abre el calendario.
 *
 * Tres casos, en este orden:
 *
 *  1. **La cuenta lleva un tirador** (tirador o tutor). Manda la ficha: su
 *     arma, su género y las categorías en las que de verdad puede tirar. Es lo
 *     que arregló que a Carlos Llavador, absoluto, le salieran las Copas del
 *     Mundo cadete.
 *  2. **Seleccionador con arma asignada.** Su arma y LOS DOS GÉNEROS —un
 *     seleccionador de florete lleva el masculino y el femenino, no uno—, y
 *     absoluto de entrada.
 *  3. **Todo lo demás**: dirección técnica, un club, un seleccionador al que
 *     nadie ha asignado arma todavía. Se abre entero. Antes este caso caía en
 *     un `['FLORETE']` escrito a mano, así que la dirección técnica entraba
 *     viendo solo florete y sin ningún botón para salir de ahí.
 */
export function arranqueDelCalendario(
  perfil: PerfilAmbito,
  tirador: TiradorAmbito | null,
  categoriasDisponibles: string[],
): Arranque {
  const todo: Arranque = {
    armas: [...ARMAS],
    generos: [...GENEROS],
    categorias: ordenarCategorias(categoriasDisponibles),
    propio: false,
  };

  if (tirador) {
    const armas = tirador.weapons.filter(esArma);
    const categorias = tirador.eligibleCategories.filter((c) =>
      categoriasDisponibles.includes(c),
    );
    return {
      armas: armas.length > 0 ? armas : todo.armas,
      generos:
        tirador.gender === 'M' || tirador.gender === 'F'
          ? [tirador.gender]
          : [...GENEROS],
      categorias:
        categorias.length > 0 ? ordenarCategorias(categorias) : todo.categorias,
      propio: true,
    };
  }

  if (perfil.role === 'coach') {
    const armas = perfil.weapons.filter(esArma);
    // Sin arma asignada no se adivina ninguna: se abre todo y en `/tiradores`
    // ya se le dice que pida la suya a la dirección técnica.
    if (armas.length === 0) return todo;

    return {
      armas,
      generos: [...GENEROS],
      // Si esta temporada no hay ninguna prueba absoluta, filtrar por absoluto
      // dejaría el calendario en blanco, que no responde a ninguna pregunta.
      categorias: categoriasDisponibles.includes(CATEGORIA_DEL_SELECCIONADOR)
        ? [CATEGORIA_DEL_SELECCIONADOR]
        : todo.categorias,
      propio: true,
    };
  }

  return todo;
}

/**
 * Armas con las que arranca la pantalla de tiradores.
 *
 * Misma regla que el calendario y por el mismo motivo, pero aquí no hay
 * ficha con la que comparar: o eres seleccionador y son tus armas, o lo tuyo
 * son todas. La dirección técnica ve a la federación entera, que es su
 * trabajo.
 */
export function armasDeArranque(perfil: PerfilAmbito): Weapon[] {
  if (perfil.role !== 'coach') return [...ARMAS];
  const armas = perfil.weapons.filter(esArma);
  return armas.length > 0 ? armas : [...ARMAS];
}
