import { describe, expect, it } from 'vitest';
import {
  conBarraDePlazos,
  diasEntre,
  estadoDeListaOficial,
} from '@/app/(app)/estado/oficial';

/**
 * Las reglas de «Mi estado» que no se pueden mirar en una captura.
 *
 * La de la lista oficial es una **regla de visibilidad**, y esas se rompen en
 * silencio: nadie ve un error, simplemente alguien lee «no estás» cuando sí
 * está y se entera al llegar al pabellón. Por eso está en una función pura y
 * por eso tiene pruebas, igual que `arranqueDelCalendario` en `ambito.ts`.
 */

describe('estadoDeListaOficial', () => {
  it('empareja: manda la lista oficial, aunque te inscribiera otro', () => {
    // Es el caso literal que pidió el usuario: «igual le ha inscrito otra
    // persona». Si la fila está emparejada, está dentro y no hace falta nada más.
    expect(estadoDeListaOficial({ emparejado: true, publicados: 134 })).toBe(
      'dentro',
    );
  });

  it('emparejado manda incluso si el recuento viene a cero', () => {
    // No debería pasar —si estás emparejado hay al menos una fila— pero si el
    // recuento fallara no se puede degradar a «sin confirmar» a quien ya consta.
    expect(estadoDeListaOficial({ emparejado: false, publicados: 0 })).not.toBe(
      'dentro',
    );
    expect(estadoDeListaOficial({ emparejado: true, publicados: 0 })).toBe(
      'dentro',
    );
  });

  it('lista publicada y sin emparejar NO es «no estás»', () => {
    // Hoy ninguna fila de lista oficial trae licencia, así que este es el caso
    // normal. La pantalla dice «sin confirmar» y da el enlace; decir «no estás»
    // a quien sí figura con su nombre es cómo se pierde un torneo.
    expect(estadoDeListaOficial({ emparejado: false, publicados: 134 })).toBe(
      'sin_emparejar',
    );
    expect(estadoDeListaOficial({ emparejado: false, publicados: 1 })).toBe(
      'sin_emparejar',
    );
  });

  it('sin lista publicada se distingue de la lista publicada', () => {
    expect(estadoDeListaOficial({ emparejado: false, publicados: 0 })).toBe(
      'sin_publicar',
    );
  });
});

describe('diasEntre', () => {
  it('cuenta días naturales', () => {
    expect(diasEntre('2026-09-27', '2026-10-03')).toBe(6);
    expect(diasEntre('2026-09-27', '2026-09-27')).toBe(0);
  });

  it('no se descuadra al cruzar el cambio de hora de Madrid', () => {
    // El último domingo de octubre el día local dura 25 horas. Contando en
    // local, «26 días» se convertía en 25,96 y `Math.round` aún salvaba el
    // caso, pero con dos cambios de hora ya no. En UTC no hay nada que salvar.
    expect(diasEntre('2026-10-24', '2026-10-26')).toBe(2);
    expect(diasEntre('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('da negativo si la fecha ya pasó', () => {
    expect(diasEntre('2026-10-03', '2026-09-27')).toBe(-6);
  });
});

describe('conBarraDePlazos', () => {
  it('la barra sale en la fila destacada cuando el plazo aprieta', () => {
    expect(conBarraDePlazos({ state: 'rojo' }, true)).toBe(true);
    expect(conBarraDePlazos({ state: 'ambar' }, true)).toBe(true);
  });

  it('nunca se repite en las demás filas', () => {
    // Es la regla que baja la pantalla de 3.502 px: cinco barras eran cinco
    // veces el mismo aviso de fechas estimadas.
    expect(conBarraDePlazos({ state: 'rojo' }, false)).toBe(false);
    expect(conBarraDePlazos({ state: 'ambar' }, false)).toBe(false);
  });

  it('con el plazo lejos basta la cifra y la fecha de cierre', () => {
    expect(conBarraDePlazos({ state: 'verde' }, true)).toBe(false);
  });

  it('cerrado o sin datos no tiene tramos que dibujar', () => {
    expect(conBarraDePlazos({ state: 'cerrado' }, true)).toBe(false);
    expect(conBarraDePlazos({ state: 'sin_datos' }, true)).toBe(false);
  });
});
