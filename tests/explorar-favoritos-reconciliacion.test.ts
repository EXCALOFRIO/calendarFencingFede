import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CambioFavorito } from '@/lib/sport/explorar/favorito-alternar';
import {
  estadoInicial,
  iniciarOperacion,
  reconciliarProp,
  resolverOperacion,
  type EstadoFavorito,
} from '@/lib/sport/explorar/favorito-estado';

/**
 * El control se conserva montado (misma key y mismo personaId) cuando Next
 * navega o refresca con estado de cliente en los search params, así que sólo
 * cambia la prop `inicial`. Se simula aquí el ciclo de render del componente:
 * `reconciliarProp` en cada render y las transiciones de la operación.
 */

const guardado = (favorito: boolean): CambioFavorito =>
  favorito
    ? { favorito: true, resultado: 'guardado', mensaje: 'Guardado en tus favoritos.' }
    : { favorito: false, resultado: 'quitado', mensaje: 'Quitado de tus favoritos.' };
const fallo = (actual: boolean): CambioFavorito => ({ favorito: actual, resultado: 'error', mensaje: 'No se ha podido guardar el cambio.' });

/** Reproduce un render del componente: aplica la reconciliación hasta estabilizar. */
function render(estado: EstadoFavorito, inicial: boolean): EstadoFavorito {
  const siguiente = reconciliarProp(estado, inicial);
  expect(reconciliarProp(siguiente, inicial)).toBe(siguiente);
  return siguiente;
}

describe('reconciliación de la prop inicial con el estado local', () => {
  it('false → true tras releer el servidor actualiza el control sin remontarlo', () => {
    let e = estadoInicial(false);
    expect(e.guardado).toBe(false);
    e = render(e, true);
    expect(e.guardado).toBe(true);
  });

  it('true → false tras releer el servidor deja de mostrar Favorito', () => {
    let e = estadoInicial(true);
    e = render(e, false);
    expect(e.guardado).toBe(false);
  });

  it('sin cambio de prop devuelve el mismo estado (no hay bucle de render)', () => {
    const e = estadoInicial(true);
    expect(reconciliarProp(e, true)).toBe(e);
  });

  it('una prop nueva descarta el aviso de una operación anterior que ya no describe el estado', () => {
    let e = estadoInicial(false);
    e = iniciarOperacion(e);
    e = resolverOperacion(e, guardado(true));
    e = render(e, true);
    expect(e.guardado).toBe(true);
    e = render(e, false);
    expect(e).toMatchObject({ guardado: false, cambio: null });
  });

  it('una prop que sólo confirma lo ya mostrado conserva el aviso de guardado', () => {
    let e = estadoInicial(false);
    e = iniciarOperacion(e);
    e = resolverOperacion(e, guardado(true));
    e = render(e, true);
    expect(e.guardado).toBe(true);
    expect(e.cambio).toMatchObject({ resultado: 'guardado' });
  });

  it('navegación de ida y vuelta (A: true, B: false, A: true) sigue el valor canónico en cada paso', () => {
    let e = estadoInicial(true);
    for (const esperado of [false, true, false, false, true]) {
      e = render(e, esperado);
      expect(e.guardado).toBe(esperado);
    }
  });
});

describe('operación en vuelo', () => {
  it('una prop anterior no pisa el feedback optimista mientras la operación sigue', () => {
    let e = estadoInicial(false);
    e = iniciarOperacion(e);
    e = render(e, false);
    e = render(e, true);
    expect(e.guardado).toBe(false);
    expect(e.enVuelo).toBe(true);
    expect(e.propNueva).toBe(true);
  });

  it('volver al valor ya visto durante la operación anula la prop pendiente', () => {
    let e = iniciarOperacion(estadoInicial(false));
    e = render(e, true);
    e = render(e, false);
    expect(e.propNueva).toBeNull();
  });

  it('guardado correcto: manda lo confirmado por el servidor aunque llegara una prop previa', () => {
    let e = iniciarOperacion(estadoInicial(false));
    e = render(e, true);
    e = resolverOperacion(e, guardado(true));
    expect(e).toMatchObject({ guardado: true, enVuelo: false, propNueva: null, propVista: true });
    expect(render(e, true)).toBe(e);
  });

  it('quitado correcto con la prop vieja aún presente no resucita el favorito', () => {
    let e = iniciarOperacion(estadoInicial(true));
    e = render(e, true);
    e = resolverOperacion(e, quitado());
    e = render(e, true);
    expect(e.guardado).toBe(false);
  });

  it('error sin prop nueva vuelve al estado previo, conserva el mensaje y permite reintentar', () => {
    let e = iniciarOperacion(estadoInicial(false));
    e = resolverOperacion(e, fallo(false));
    expect(e).toMatchObject({ guardado: false, enVuelo: false });
    expect(e.cambio).toMatchObject({ resultado: 'error' });
    e = iniciarOperacion(e);
    expect(e.cambio).toBeNull();
    e = resolverOperacion(e, guardado(true));
    expect(e.guardado).toBe(true);
  });

  it('error con un valor canónico recibido durante la operación adopta ese valor', () => {
    let e = iniciarOperacion(estadoInicial(false));
    e = render(e, true);
    e = resolverOperacion(e, fallo(false));
    expect(e).toMatchObject({ guardado: true, propVista: true, propNueva: null, enVuelo: false });
    expect(e.cambio).toMatchObject({ resultado: 'error' });
    expect(render(e, true)).toBe(e);
  });

  it('tras terminar, una prop posterior vuelve a mandar', () => {
    let e = iniciarOperacion(estadoInicial(false));
    e = resolverOperacion(e, guardado(true));
    e = render(e, true);
    e = render(e, false);
    expect(e.guardado).toBe(false);
  });

  it('iniciar dos veces no reinicia el estado de la operación', () => {
    const e = iniciarOperacion(estadoInicial(false));
    expect(iniciarOperacion(e)).toBe(e);
  });
});

describe('el componente usa la reconciliación', () => {
  const fuente = readFileSync('src/components/explorar/boton-favorito.tsx', 'utf8');

  it('no copia la prop inicial en un useState que sólo se lee al montar', () => {
    expect(fuente).not.toMatch(/useState\(\s*inicial\s*\)/);
    expect(fuente).toContain('reconciliarProp(estado, inicial)');
    expect(fuente).toContain('resolverOperacion');
  });

  it('los avisos siguen sin prometer alertas', () => {
    expect(fuente).toContain('No envía avisos ni notificaciones');
  });
});

function quitado(): CambioFavorito {
  return guardado(false);
}
