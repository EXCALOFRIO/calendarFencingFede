import type { ResultadoFavorito } from './favoritos';

/**
 * Guardar/Quitar un favorito desde el control de la interfaz.
 *
 * Decide el estado final y el texto a mostrar a partir de lo que respondan las
 * acciones de servidor; el componente sólo lo pinta. Un fallo (respuesta no
 * `ok` o excepción, que en producción llega como un error genérico también
 * cuando la sesión ha caducado) devuelve el estado previo: nunca se deja
 * «Favorito» en pantalla si no se guardó.
 *
 * Los textos no prometen avisos ni dicen que no los haya: quien sigue a un
 * adulto puede recibirlos (notificaciones «Siguiendo»), a un posible menor no,
 * y aquí no se sabe cuál es.
 */

export type AccionFavorito = (entrada: unknown) => Promise<ResultadoFavorito>;

export type CambioFavorito = {
  favorito: boolean;
  resultado: 'guardado' | 'quitado' | 'error';
  mensaje: string;
};

export const MENSAJE_GUARDADO = 'Guardado en tus favoritos.';
export const MENSAJE_QUITADO = 'Quitado de tus favoritos.';
const MENSAJE_ERROR =
  'No se ha podido guardar el cambio y todo sigue como estaba. Comprueba la conexión, o vuelve a entrar si tu sesión ha caducado, e inténtalo de nuevo.';
const MENSAJE_NO_DISPONIBLE = 'Favoritos aún no está activo en esta instalación, así que no se ha cambiado nada.';
const MENSAJE_LIMITE =
  'Ya tienes 500 favoritos, que es el máximo. Quita alguno para guardar a esta persona.';
const MENSAJE_NO_ENCONTRADA = 'Esta persona ya no está en el índice deportivo, así que no se ha cambiado nada.';

export async function alternarFavorito(
  personaId: string,
  actual: boolean,
  acciones: { guardar: AccionFavorito; quitar: AccionFavorito },
): Promise<CambioFavorito> {
  const fallo = (mensaje: string): CambioFavorito => ({ favorito: actual, resultado: 'error', mensaje });
  try {
    const r = await (actual ? acciones.quitar : acciones.guardar)({ personaId });
    if (r.estado === 'ok') {
      return r.favorito
        ? { favorito: true, resultado: 'guardado', mensaje: MENSAJE_GUARDADO }
        : { favorito: false, resultado: 'quitado', mensaje: MENSAJE_QUITADO };
    }
    if (r.estado === 'no_disponible') return fallo(MENSAJE_NO_DISPONIBLE);
    if (r.estado === 'no_encontrada') return fallo(MENSAJE_NO_ENCONTRADA);
    if (r.estado === 'limite_alcanzado') return fallo(MENSAJE_LIMITE);
    return fallo(MENSAJE_ERROR);
  } catch {
    return fallo(MENSAJE_ERROR);
  }
}
