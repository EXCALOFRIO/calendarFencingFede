import { describe, expect, it } from 'vitest';
import {
  bastanteParaBuscar,
  distanciaEdicion,
  fonetico,
  nombreCasa,
  palabrasNombre,
  parecidoNombre,
} from '@/lib/nombres';

/**
 * Encontrarse por el nombre en las listas oficiales.
 *
 * Estas pruebas deciden si alguien de la selección puede entrar a ver su
 * calendario o si la pantalla le dice «no apareces» estando publicado. Por eso
 * **todos los nombres de aquí son nombres reales leídos de la base el
 * 28/09/2026**, no inventados: la consulta fue `select distinct
 * source_athlete_name from official_ranking_entry` (809 tiradores) y su
 * equivalente en `fie_fencer` (344) y `fie_clasificacion` con país ESP (417).
 *
 * Y la mitad de las pruebas son de lo que NO tiene que casar, que es la parte
 * que importa: la regla del proyecto es que la máquina no empareja por nombre,
 * así que esto solo puede PROPONER. Si propusiera de más —dos homónimos
 * mezclados, media federación con dos letras—, la persona que confirma no
 * podría confirmar nada con sentido.
 */

/** Tal y como los publica cada fuente, con sus mayúsculas y sus acentos. */
const RFEE = [
  'CARLOS LLAVADOR FERNANDEZ',
  'ABRIL RODÉS TORÀ',
  'HÉCTOR RIVAS JIMÉNEZ',
  'MARIA MARIÑO BLANCO',
  'JAVIER MORENO DIAZ',
  'JAVIER MORENO ANDRES',
  'JAVIER ALONSO ESCOBAR',
  'JAVIER ALONSO PRIETO',
  'PAULA GARCIA BLANCO',
  'PAULA GARCIA GONZALEZ-ESTEFANI',
  'MANUEL DE LA CAL ALMENDARIZ',
  'MANUEL DE LAS HERAS MORENO',
  'ADRIÁ GARCÍA PALOMARES',
  'ABEL MOLINA CARRATALA',
  'LUCIA MARTIN PORTUGUES BARBERO',
  'ADRIAN ALEXANDER YAÑEZ CABEZA',
];

/** La FIE escribe los apellidos primero. Es la misma gente al revés. */
const FIE = [
  'LLAVADOR Carlos',
  'CASAUS PIELAGO Jorge',
  'RIVAS JIMENEZ Hector',
  'MARTIN-PORTUGUES Lucia',
  'LETE MUNOZ-REPISO Mateo',
  'MORENO ANDRES Javier',
  'VILANOVA PARRENO Jose Manuel',
];

/** A quiénes propone la búsqueda, de una lista de nombres publicados. */
function encaja(escrito: string, lista: string[]): string[] {
  return lista
    .map((n) => ({ n, p: parecidoNombre(escrito, n) }))
    .filter((x) => x.p !== null)
    .sort((a, b) => b.p!.puntos - a.p!.puntos)
    .map((x) => x.n);
}

describe('parecidoNombre: encontrarse aunque no se escriba perfecto', () => {
  it('encuentra a Carlos Llavador escrito bien, del revés y con errata', () => {
    for (const escrito of [
      'Carlos Llavador',
      'CARLOS LLAVADOR',
      'llavador carlos',
      'carlos llavador fernandez',
    ]) {
      expect(encaja(escrito, RFEE), escrito).toContain(
        'CARLOS LLAVADOR FERNANDEZ',
      );
    }
  });

  /**
   * «yavador» es el caso que justifica la parte fonética.
   *
   * Con distancia de edición cruda, «yavador» está a 2 de «llavador» (cambiar
   * la «y» por «l» y añadir otra «l»), que es el mismo margen con el que
   * casarían apellidos que no tienen nada que ver. Con el yeísmo aplicado
   * («ll» → «y») las dos palabras son la misma y el acierto es limpio.
   */
  it('perdona el yeísmo: «carlos yavador» es Carlos Llavador', () => {
    expect(encaja('carlos yavador', RFEE)[0]).toBe('CARLOS LLAVADOR FERNANDEZ');
    expect(encaja('carlos yavador', FIE)[0]).toBe('LLAVADOR Carlos');
  });

  it('acepta la inicial del nombre de pila: «C. Llavador»', () => {
    expect(encaja('C. Llavador', RFEE)).toContain('CARLOS LLAVADOR FERNANDEZ');
  });

  /**
   * El caso que trae el usuario en su petición: las dos fuentes escriben el
   * nombre al revés entre sí, y Jorge Casaus además NO está en el ranking de
   * la RFEE de esta temporada —solo en la FIE—, así que si la búsqueda no
   * mirase las dos listas le diría «no apareces» a un tirador de la selección.
   */
  it('encuentra «jorge casaus» en la FIE, que lo publica «CASAUS PIELAGO Jorge»', () => {
    expect(encaja('jorge casaus', FIE)).toEqual(['CASAUS PIELAGO Jorge']);
    expect(encaja('casaus pielago jorge', FIE)).toEqual(['CASAUS PIELAGO Jorge']);
    expect(encaja('Jorje Casaus', FIE)).toEqual(['CASAUS PIELAGO Jorge']);
    // Y no está en la RFEE: eso no se disimula proponiendo a otro parecido.
    expect(encaja('jorge casaus', RFEE)).toEqual([]);
  });

  it('da igual el acento, se escriba en la fuente o en el campo', () => {
    expect(encaja('abril rodes tora', RFEE)).toEqual(['ABRIL RODÉS TORÀ']);
    expect(encaja('ABRIL RODÉS TORÀ', RFEE)).toEqual(['ABRIL RODÉS TORÀ']);
    expect(encaja('hector rivas', RFEE)).toEqual(['HÉCTOR RIVAS JIMÉNEZ']);
    expect(encaja('maría mariño', RFEE)).toEqual(['MARIA MARIÑO BLANCO']);
  });

  /**
   * El guion: la FIE publica «MARTIN-PORTUGUES Lucia» y «LETE MUNOZ-REPISO
   * Mateo», y la RFEE los mismos apellidos separados por un espacio. Quien
   * escribe su apellido casi nunca pone el guion.
   */
  it('el guion no separa a nadie de su ficha', () => {
    expect(encaja('lucia martin portugues', FIE)).toEqual([
      'MARTIN-PORTUGUES Lucia',
    ]);
    expect(encaja('mateo munoz repiso', FIE)).toEqual([
      'LETE MUNOZ-REPISO Mateo',
    ]);
  });

  it('las partículas ni hacen falta ni estorban', () => {
    expect(encaja('manuel de la cal', RFEE)[0]).toBe(
      'MANUEL DE LA CAL ALMENDARIZ',
    );
    expect(encaja('manuel cal', RFEE)).toEqual(['MANUEL DE LA CAL ALMENDARIZ']);
  });
});

describe('parecidoNombre: lo que NO tiene que casar', () => {
  /**
   * Los homónimos reales de la base. La función NO elige: propone los dos, y
   * quien decide es la persona mirando el arma, el club y el año. Que devuelva
   * dos no es un fallo; que devolviera uno sí lo sería.
   */
  it('con dos homónimos propone los dos y no se queda con uno', () => {
    expect(encaja('javier moreno', RFEE).sort()).toEqual([
      'JAVIER MORENO ANDRES',
      'JAVIER MORENO DIAZ',
    ]);
    expect(encaja('javier alonso', RFEE).sort()).toEqual([
      'JAVIER ALONSO ESCOBAR',
      'JAVIER ALONSO PRIETO',
    ]);
    expect(encaja('paula garcia', RFEE).sort()).toEqual([
      'PAULA GARCIA BLANCO',
      'PAULA GARCIA GONZALEZ-ESTEFANI',
    ]);
  });

  it('en cuanto se escribe el segundo apellido, el homónimo se cae', () => {
    expect(encaja('javier moreno diaz', RFEE)).toEqual(['JAVIER MORENO DIAZ']);
    expect(encaja('javier alonso prieto', RFEE)).toEqual([
      'JAVIER ALONSO PRIETO',
    ]);
  });

  /**
   * Dos letras no devuelven nada, nunca. Sin esto, el buscador es una forma de
   * sacar el censo a tirones, una letra por petición, y en estas listas hay
   * menores de edad.
   */
  it('con una o dos letras no se busca', () => {
    expect(bastanteParaBuscar('a')).toBe(false);
    expect(bastanteParaBuscar('ab')).toBe(false);
    expect(bastanteParaBuscar('a b')).toBe(false);
    expect(bastanteParaBuscar('  ll  ')).toBe(false);
    expect(bastanteParaBuscar('abc')).toBe(true);

    expect(encaja('ab', RFEE)).toEqual([]);
    expect(encaja('ll', RFEE)).toEqual([]);
  });

  /**
   * Tres letras tampoco valen como prefijo. «gar» se traería a todos los
   * García, los Garay y los Garrido de la federación.
   */
  it('tres letras no valen como principio de un apellido', () => {
    expect(encaja('gar', RFEE)).toEqual([]);
    expect(encaja('mor', RFEE)).toEqual([]);
  });

  it('un nombre que no está en las listas no propone a nadie', () => {
    expect(encaja('Fulanito de Tal', RFEE)).toEqual([]);
    expect(encaja('Fulanito de Tal', FIE)).toEqual([]);
    expect(encaja('Zacarias Zuzunaga', RFEE)).toEqual([]);
  });

  /** Apellidos distintos que se escriben parecido no son la misma persona. */
  it('no confunde apellidos que solo se parecen', () => {
    expect(encaja('paula blanco', RFEE)).toEqual(['PAULA GARCIA BLANCO']);
    expect(encaja('abel molina', RFEE)).toEqual(['ABEL MOLINA CARRATALA']);
    // «MARIÑO BLANCO» y «GARCIA BLANCO» comparten el segundo apellido y nada más.
    expect(encaja('maria blanco', RFEE)).toEqual(['MARIA MARIÑO BLANCO']);
  });

  /**
   * «Adrián» y «Adriá» son dos nombres distintos con una letra de diferencia,
   * y en la base hay gente con cada uno. Que se proponga es correcto —quien
   * escribe «adrian» puede ser el «ADRIÁ» que se cansó de corregir a la
   * federación—, pero tiene que quedar por detrás de un acierto exacto.
   */
  it('una errata de una letra propone, pero por detrás de lo exacto', () => {
    const conErrata = parecidoNombre(
      'adrian garcia palomares',
      'ADRIÁ GARCÍA PALOMARES',
    );
    const exacto = parecidoNombre(
      'adria garcia palomares',
      'ADRIÁ GARCÍA PALOMARES',
    );
    expect(conErrata).not.toBeNull();
    expect(exacto!.puntos).toBeGreaterThan(conErrata!.puntos);
  });
});

describe('fonetico', () => {
  it('iguala las dos formas de escribir el mismo sonido', () => {
    expect(fonetico('llavador')).toBe(fonetico('yavador'));
    expect(fonetico('Vazquez')).toBe(fonetico('Bazques'));
    expect(fonetico('Quim')).toBe(fonetico('Kim'));
    expect(fonetico('Hernandez')).toBe(fonetico('Ernandez'));
    expect(fonetico('Ferreiro')).toBe(fonetico('Fereiro'));
  });

  /** La «ch» se salva del apaño de la «c»: «Sanchez» no es «Sankes». */
  it('no destroza la ch', () => {
    expect(fonetico('Sanchez')).toBe('sanches');
    expect(fonetico('Chaves')).toBe('chabes');
  });

  it('no iguala apellidos que suenan distinto', () => {
    expect(fonetico('molina')).not.toBe(fonetico('medina'));
    expect(fonetico('garcia')).not.toBe(fonetico('garay'));
  });

  /**
   * La «x» se queda quieta a propósito: en la base hay «XAVIER», «XOEL»,
   * «UXUE», «MANEX» y catorce «ALEX», y la «x» suena distinto en cada uno. Una
   * regla única inventaría emparejados en vez de arreglarlos.
   */
  it('no toca la x, que en español suena de tres maneras', () => {
    expect(fonetico('Alex')).toBe('alex');
    expect(fonetico('Uxue')).toBe('uxue');
    expect(fonetico('Xavier')).not.toBe(fonetico('Javier'));
  });
});

describe('distanciaEdicion', () => {
  it('cuenta las letras que hay que cambiar', () => {
    expect(distanciaEdicion('llavador', 'llavadro')).toBe(2);
    expect(distanciaEdicion('rivas', 'rivas')).toBe(0);
    expect(distanciaEdicion('rivas', 'ribas')).toBe(1);
  });

  /**
   * El corte no es una optimización: es parte de la regla. Da lo mismo si dos
   * apellidos están a cinco o a nueve cambios, así que en cuanto se pasa del
   * corte se deja de contar y se devuelve «más que el corte».
   */
  it('abandona en cuanto se pasa del corte', () => {
    expect(distanciaEdicion('garcia', 'fernandez', 2)).toBe(3);
    expect(distanciaEdicion('garcia', 'fernandez', 1)).toBe(2);
  });
});

describe('palabrasNombre', () => {
  it('parte por espacios, guiones y puntos', () => {
    expect(palabrasNombre('MARTIN-PORTUGUES Lucia')).toEqual([
      'martin',
      'portugues',
      'lucia',
    ]);
    expect(palabrasNombre('C. Llavador')).toEqual(['c', 'llavador']);
    expect(palabrasNombre('  Abril   Rodés  ')).toEqual(['abril', 'rodes']);
  });
});

describe('nombreCasa', () => {
  /**
   * El filtro de las tablas del ranking se queda deliberadamente tonto: ahí se
   * filtra lo que ya está en pantalla mientras se teclea, y perdonar erratas
   * haría parpadear la tabla con filas que nadie ha pedido.
   */
  it('exige que aparezcan todas las palabras, sin importar el orden', () => {
    expect(nombreCasa('CARLOS LLAVADOR FERNANDEZ', 'llavador carlos')).toBe(true);
    expect(nombreCasa('HÉCTOR RIVAS JIMÉNEZ', 'hector jimenez')).toBe(true);
    expect(nombreCasa('CARLOS LLAVADOR FERNANDEZ', 'yavador')).toBe(false);
    expect(nombreCasa('CARLOS LLAVADOR FERNANDEZ', '')).toBe(true);
  });
});
