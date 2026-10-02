import type { CambioFavorito } from './favorito-alternar';

/**
 * Estado local del control Guardar/Quitar y su reconciliación con la lectura
 * canónica que el servidor entrega junto a `inicial`.
 *
 * Next conserva la instancia del control (misma `key`, mismo `personaId`) al
 * navegar o refrescar, así que `inicial` puede cambiar sin remontarlo. Pero un
 * booleano no basta para saber si hubo una lectura nueva: guardar (true, sin
 * que la prop se entere), quitar en otra pestaña y cambiar de modalidad aquí
 * devuelve `false`, igual que la prop que se vio al montar, y compararlo con
 * ella ignoraría la lectura. Por eso se compara la identidad de la lectura: el
 * objeto de estado que construye el lector en cada render de servidor llega al
 * cliente como instancia nueva, aunque su valor sea igual al anterior.
 *
 * Una lectura nueva se adopta salvo mientras hay una operación en vuelo, cuyo
 * feedback optimista no debe pisarse con una lectura anterior a ella. Esa
 * lectura se recuerda en `pendiente` y se consume al terminar la operación.
 *
 * Todas las funciones devuelven el mismo objeto si nada cambia, para poder
 * usarlas durante el render sin provocar bucles.
 */
export type LecturaFavorito = object;

export type EstadoFavorito = {
  guardado: boolean;
  /** Última lectura ya tenida en cuenta (adoptada o consumida por una operación). */
  lecturaVista: LecturaFavorito;
  /** Última lectura recibida mientras había una operación en vuelo. */
  pendiente: { valor: boolean; lectura: LecturaFavorito } | null;
  enVuelo: boolean;
  cambio: CambioFavorito | null;
};

export function estadoInicial(inicial: boolean, lectura: LecturaFavorito): EstadoFavorito {
  return { guardado: inicial, lecturaVista: lectura, pendiente: null, enVuelo: false, cambio: null };
}

export function reconciliarProp(estado: EstadoFavorito, inicial: boolean, lectura: LecturaFavorito): EstadoFavorito {
  if (lectura === estado.lecturaVista) return estado;
  if (estado.enVuelo) {
    return estado.pendiente?.lectura === lectura ? estado : { ...estado, pendiente: { valor: inicial, lectura } };
  }
  // Si la lectura sólo confirma lo que ya se muestra, el aviso de la operación sigue vigente.
  return {
    guardado: inicial,
    lecturaVista: lectura,
    pendiente: null,
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
 * tanto llegó una lectura canónica, esa es la vigente. El mensaje de error se
 * conserva para que se pueda reintentar. En ambos casos la lectura recibida en
 * vuelo queda consumida.
 */
export function resolverOperacion(estado: EstadoFavorito, cambio: CambioFavorito): EstadoFavorito {
  const lecturaVista = estado.pendiente?.lectura ?? estado.lecturaVista;
  const guardado = cambio.resultado === 'error' ? (estado.pendiente?.valor ?? cambio.favorito) : cambio.favorito;
  return { guardado, lecturaVista, pendiente: null, enVuelo: false, cambio };
}
