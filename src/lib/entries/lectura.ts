/**
 * «No consultada», «consultada y vacía» y «fallo de lectura» son tres cosas
 * distintas y ninguna se convierte en otra: un fallo no es una lista vacía ni
 * borra lo último que se leyó bien.
 */

export type EstadoLista = 'sin_consultar' | 'vacia' | 'con_datos' | 'error';

export function estadoDeLista(entrada: {
  /** La fuente se llegó a leer (marca de lectura o total publicado). */
  consultada: boolean;
  filas: number;
  fallo?: boolean;
}): EstadoLista {
  if (entrada.fallo) return 'error';
  if (entrada.filas > 0) return 'con_datos';
  return entrada.consultada ? 'vacia' : 'sin_consultar';
}

/** Estado de una petición del cliente, conservando el último dato válido. */
export type Lectura<T> =
  | { tipo: 'sin_consultar' }
  | { tipo: 'ok'; datos: T }
  | { tipo: 'error'; previos: T | null };

export function aplicarLectura<T>(
  actual: Lectura<T>,
  resultado: { ok: true; datos: T } | { ok: false },
): Lectura<T> {
  if (resultado.ok) return { tipo: 'ok', datos: resultado.datos };
  return { tipo: 'error', previos: datosVigentes(actual) };
}

export function datosVigentes<T>(lectura: Lectura<T>): T | null {
  if (lectura.tipo === 'ok') return lectura.datos;
  if (lectura.tipo === 'error') return lectura.previos;
  return null;
}
