import type { CambioFavorito } from './favorito-alternar';

/**
 * Estado local del control Guardar/Quitar y su reconciliación con el valor que
 * el servidor entrega como prop `inicial`.
 *
 * Next conserva la instancia del control (misma `key`, mismo `personaId`) al
 * navegar o refrescar, así que `inicial` puede cambiar sin remontarlo. El
 * estado local no puede quedarse con la copia del primer render: se adopta la
 * nueva prop, salvo mientras hay una operación en vuelo, cuyo feedback
 * optimista no debe pisar una prop anterior a ella. Esa prop se recuerda en
 * `propNueva` y se aplica al terminar la operación.
 *
 * Todas las funciones devuelven el mismo objeto si nada cambia, para poder
 * usarlas durante el render sin provocar bucles.
 */
export type EstadoFavorito = {
  guardado: boolean;
  /** Última prop `inicial` ya tenida en cuenta. */
  propVista: boolean;
  /** Prop distinta recibida mientras había una operación en vuelo. */
  propNueva: boolean | null;
  enVuelo: boolean;
  cambio: CambioFavorito | null;
};

export function estadoInicial(inicial: boolean): EstadoFavorito {
  return { guardado: inicial, propVista: inicial, propNueva: null, enVuelo: false, cambio: null };
}

export function reconciliarProp(estado: EstadoFavorito, inicial: boolean): EstadoFavorito {
  if (estado.enVuelo) {
    const propNueva = inicial === estado.propVista ? null : inicial;
    return propNueva === estado.propNueva ? estado : { ...estado, propNueva };
  }
  if (inicial === estado.propVista) return estado;
  // Si la prop sólo confirma lo que ya se muestra, el aviso de la operación sigue vigente.
  return {
    guardado: inicial,
    propVista: inicial,
    propNueva: null,
    enVuelo: false,
    cambio: inicial === estado.guardado ? estado.cambio : null,
  };
}

export function iniciarOperacion(estado: EstadoFavorito): EstadoFavorito {
  return estado.enVuelo ? estado : { ...estado, enVuelo: true, cambio: null };
}

/**
 * Tras un resultado confirmado manda lo que acaba de decir el servidor. Tras
 * un error, `cambio.favorito` sólo repite lo que se creía antes: si mientras
 * tanto llegó un valor canónico distinto, ese es el vigente. El mensaje de
 * error se conserva para que se pueda reintentar.
 */
export function resolverOperacion(estado: EstadoFavorito, cambio: CambioFavorito): EstadoFavorito {
  const propVista = estado.propNueva ?? estado.propVista;
  const guardado = cambio.resultado === 'error' ? (estado.propNueva ?? cambio.favorito) : cambio.favorito;
  return { guardado, propVista, propNueva: null, enVuelo: false, cambio };
}
