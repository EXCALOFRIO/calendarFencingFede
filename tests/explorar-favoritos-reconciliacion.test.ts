import { readFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CambioFavorito } from '@/lib/sport/explorar/favorito-alternar';
import {
  estadoInicial,
  iniciarOperacion,
  reconciliarProp,
  resolverOperacion,
  type EstadoFavorito,
  type LecturaFavorito,
} from '@/lib/sport/explorar/favorito-estado';
import { cargarEstadoFavorito } from '@/lib/sport/explorar/favoritos-pantalla';
import { UUID_A, crearContexto, personaSimple } from './helpers/explorar';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/explorar/x',
}));
vi.mock('@/app/(app)/explorar/favoritos-acciones', () => ({
  guardarFavoritoAccion: vi.fn(),
  quitarFavoritoAccion: vi.fn(),
}));

const { ControlFavoritoFicha } = await import('@/components/explorar/favoritos');

/**
 * El control se conserva montado (misma key y mismo personaId) cuando Next
 * navega o refresca con estado de cliente en los search params, así que sólo
 * cambian sus props. Cada lectura sale del lector real (`cargarEstadoFavorito`)
 * y de la fila padre real (`ControlFavoritoFicha`), que decide qué recibe el
 * control; después se simula el ciclo de render del componente:
 * `reconciliarProp` en cada render y las transiciones de la operación.
 */

type PropsControl = { inicial: boolean; lectura: LecturaFavorito };

/** Una lectura nueva del servidor: el objeto es una instancia nueva aunque el valor se repita. */
async function leerServidor(favorito: boolean): Promise<PropsControl> {
  const { ctx } = crearContexto({
    respuestas: [...personaSimple(UUID_A), ...(favorito ? [{ cuando: /FROM sport_favorite/, filas: [{ n: 1 }] }] : [])],
  });
  const estado = await cargarEstadoFavorito(ctx, UUID_A);
  const elemento = ControlFavoritoFicha({ estado, nombre: 'Lucía García', reintentar: '/x' }) as ReactElement<
    PropsControl & { personaId: string }
  >;
  const { inicial, lectura } = elemento.props;
  return { inicial, lectura };
}

const guardado = (favorito: boolean): CambioFavorito =>
  favorito
    ? { favorito: true, resultado: 'guardado', mensaje: 'Guardado en tus favoritos.' }
    : { favorito: false, resultado: 'quitado', mensaje: 'Quitado de tus favoritos.' };
const fallo = (actual: boolean): CambioFavorito => ({ favorito: actual, resultado: 'error', mensaje: 'No se ha podido guardar el cambio.' });
const quitado = () => guardado(false);

/** Reproduce un render del componente: aplica la reconciliación hasta estabilizar. */
function render(estado: EstadoFavorito, { inicial, lectura }: PropsControl): EstadoFavorito {
  const siguiente = reconciliarProp(estado, inicial, lectura);
  expect(reconciliarProp(siguiente, inicial, lectura)).toBe(siguiente);
  return siguiente;
}

function montar(props: PropsControl): EstadoFavorito {
  return estadoInicial(props.inicial, props.lectura);
}

describe('el padre entrega la lectura al control', () => {
  it('cada lectura del servidor llega con una identidad nueva, también con el mismo booleano', async () => {
    const a = await leerServidor(false);
    const b = await leerServidor(false);
    expect(a.inicial).toBe(false);
    expect(b.inicial).toBe(false);
    expect(b.lectura).not.toBe(a.lectura);
    expect(a.lectura).toMatchObject({ tipo: 'ok', favorito: false, personaId: UUID_A });
  });

  it('el control de la ficha recibe el objeto de estado leído, no un booleano suelto', () => {
    const fuente = readFileSync('src/components/explorar/favoritos.tsx', 'utf8');
    expect(fuente).toContain('inicial={estado.favorito} lectura={estado}');
    expect(fuente).toContain('lectura={d}');
  });
});

describe('reconciliación de la lectura canónica con el estado local', () => {
  it('false → true tras releer el servidor actualiza el control sin remontarlo', async () => {
    let e = montar(await leerServidor(false));
    expect(e.guardado).toBe(false);
    e = render(e, await leerServidor(true));
    expect(e.guardado).toBe(true);
  });

  it('true → false tras releer el servidor deja de mostrar Favorito', async () => {
    let e = montar(await leerServidor(true));
    e = render(e, await leerServidor(false));
    expect(e.guardado).toBe(false);
  });

  it('la misma lectura devuelve el mismo estado (no hay bucle de render)', async () => {
    const p = await leerServidor(true);
    const e = montar(p);
    expect(reconciliarProp(e, p.inicial, p.lectura)).toBe(e);
  });

  it('una lectura nueva descarta el aviso de una operación anterior que ya no describe el estado', async () => {
    let e = montar(await leerServidor(false));
    e = iniciarOperacion(e);
    e = resolverOperacion(e, guardado(true));
    e = render(e, await leerServidor(true));
    expect(e.guardado).toBe(true);
    e = render(e, await leerServidor(false));
    expect(e).toMatchObject({ guardado: false, cambio: null });
  });

  it('una lectura que sólo confirma lo ya mostrado conserva el aviso de guardado', async () => {
    let e = montar(await leerServidor(false));
    e = iniciarOperacion(e);
    e = resolverOperacion(e, guardado(true));
    e = render(e, await leerServidor(true));
    expect(e.guardado).toBe(true);
    expect(e.cambio).toMatchObject({ resultado: 'guardado' });
  });

  it('navegación de ida y vuelta (A: true, B: false, A: true) sigue el valor canónico en cada paso', async () => {
    let e = montar(await leerServidor(true));
    for (const esperado of [false, true, false, false, true]) {
      e = render(e, await leerServidor(esperado));
      expect(e.guardado).toBe(esperado);
    }
  });
});

describe('residual: guardar sin lectura intermedia y quitar en otra pestaña', () => {
  async function guardarEnPestanaA() {
    const montada = await leerServidor(false);
    let e = montar(montada);
    e = iniciarOperacion(e);
    e = resolverOperacion(e, guardado(true));
    // Ninguna lectura llegó durante el guardado: la prop de A sigue siendo la del montaje.
    expect(render(e, montada)).toBe(e);
    return e;
  }

  it('false → guardar true → otra pestaña quita → cambio de formato en A devuelve false y se reconoce', async () => {
    let e = await guardarEnPestanaA();
    expect(e.guardado).toBe(true);
    e = render(e, await leerServidor(false));
    expect(e.guardado).toBe(false);
    expect(e.cambio).toBeNull();
    expect(e.enVuelo).toBe(false);
  });

  it('tras reconocerla se puede volver a guardar y la siguiente lectura true también manda', async () => {
    let e = await guardarEnPestanaA();
    e = render(e, await leerServidor(false));
    e = iniciarOperacion(e);
    e = resolverOperacion(e, guardado(true));
    expect(e.guardado).toBe(true);
    e = render(e, await leerServidor(true));
    expect(e).toMatchObject({ guardado: true, cambio: expect.objectContaining({ resultado: 'guardado' }) });
  });

  it('la lectura false igual a la del montaje no se ignora por ser el mismo booleano', async () => {
    const montada = await leerServidor(false);
    const nueva = await leerServidor(false);
    expect(nueva.inicial).toBe(montada.inicial);
    let e = montar(montada);
    e = resolverOperacion(iniciarOperacion(e), guardado(true));
    expect(reconciliarProp(e, nueva.inicial, nueva.lectura)).toMatchObject({ guardado: false, enVuelo: false });
  });
});

describe('operación en vuelo', () => {
  it('una lectura anterior no pisa el feedback optimista mientras la operación sigue', async () => {
    let e = montar(await leerServidor(false));
    e = iniciarOperacion(e);
    e = render(e, await leerServidor(false));
    const reciente = await leerServidor(true);
    e = render(e, reciente);
    expect(e.guardado).toBe(false);
    expect(e.enVuelo).toBe(true);
    expect(e.pendiente).toEqual({ valor: true, lectura: reciente.lectura });
  });

  it('en vuelo cuenta la última lectura recibida, no la primera', async () => {
    let e = iniciarOperacion(montar(await leerServidor(false)));
    e = render(e, await leerServidor(true));
    const ultima = await leerServidor(false);
    e = render(e, ultima);
    expect(e.pendiente).toEqual({ valor: false, lectura: ultima.lectura });
  });

  it('guardado correcto: manda lo confirmado por el servidor y consume la lectura observada', async () => {
    let e = iniciarOperacion(montar(await leerServidor(false)));
    const observada = await leerServidor(false);
    e = render(e, observada);
    e = resolverOperacion(e, guardado(true));
    expect(e).toMatchObject({ guardado: true, enVuelo: false, pendiente: null, lecturaVista: observada.lectura });
    expect(render(e, observada)).toBe(e);
  });

  it('quitado correcto con la lectura vieja aún presente no resucita el favorito', async () => {
    const montada = await leerServidor(true);
    let e = iniciarOperacion(montar(montada));
    e = render(e, montada);
    e = resolverOperacion(e, quitado());
    e = render(e, montada);
    expect(e.guardado).toBe(false);
  });

  it('error sin lectura nueva vuelve al estado previo, conserva el mensaje y permite reintentar', async () => {
    let e = iniciarOperacion(montar(await leerServidor(false)));
    e = resolverOperacion(e, fallo(false));
    expect(e).toMatchObject({ guardado: false, enVuelo: false });
    expect(e.cambio).toMatchObject({ resultado: 'error' });
    e = iniciarOperacion(e);
    expect(e.cambio).toBeNull();
    e = resolverOperacion(e, guardado(true));
    expect(e.guardado).toBe(true);
  });

  it('error con una lectura canónica recibida durante la operación adopta esa lectura', async () => {
    let e = iniciarOperacion(montar(await leerServidor(false)));
    const canonica = await leerServidor(true);
    e = render(e, canonica);
    e = resolverOperacion(e, fallo(false));
    expect(e).toMatchObject({ guardado: true, lecturaVista: canonica.lectura, pendiente: null, enVuelo: false });
    expect(e.cambio).toMatchObject({ resultado: 'error' });
    expect(render(e, canonica)).toBe(e);
  });

  it('error con una lectura false del mismo valor que lo previo la adopta y no repite lo viejo', async () => {
    let e = resolverOperacion(iniciarOperacion(montar(await leerServidor(false))), guardado(true));
    e = iniciarOperacion(e);
    const canonica = await leerServidor(false);
    e = render(e, canonica);
    e = resolverOperacion(e, fallo(true));
    expect(e).toMatchObject({ guardado: false, lecturaVista: canonica.lectura });
  });

  it('tras terminar, una lectura posterior vuelve a mandar', async () => {
    let e = iniciarOperacion(montar(await leerServidor(false)));
    e = resolverOperacion(e, guardado(true));
    e = render(e, await leerServidor(true));
    e = render(e, await leerServidor(false));
    expect(e.guardado).toBe(false);
  });

  it('iniciar dos veces no reinicia el estado de la operación', async () => {
    const e = iniciarOperacion(montar(await leerServidor(false)));
    expect(iniciarOperacion(e)).toBe(e);
  });
});

describe('el componente usa la reconciliación', () => {
  const fuente = readFileSync('src/components/explorar/boton-favorito.tsx', 'utf8');

  it('no copia la prop inicial en un useState que sólo se lee al montar', () => {
    expect(fuente).not.toMatch(/useState\(\s*inicial\s*\)/);
    expect(fuente).toContain('reconciliarProp(estado, inicial, lectura)');
    expect(fuente).toContain('resolverOperacion');
  });

  it('no remonta al cambiar la lectura: la clave sigue siendo el personaId', () => {
    expect(fuente).not.toMatch(/key=\{[^}]*lectura/);
    expect(readFileSync('src/components/explorar/favoritos.tsx', 'utf8')).toContain('key={estado.personaId}');
  });

  it('los avisos siguen sin prometer alertas', () => {
    expect(fuente).not.toMatch(/te avisaremos|recibirás|activar (las )?alertas/i);
    // La explicación general vive en la lista, no repetida junto a cada estrella.
    expect(readFileSync('src/components/explorar/favoritos.tsx', 'utf8')).toContain('no le avisa ni te avisa');
  });
});
