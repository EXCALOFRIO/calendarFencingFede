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

/**
 * La lectura pertenece a un evento: reabrir el mismo conserva lo leído (un
 * reintento fallido no lo borra) y abrir otro empieza de cero, de modo que
 * nunca se enseñan datos de un torneo en la ficha de otro.
 */
export type LecturaDeEvento<T> = { eventoId: string | null; lectura: Lectura<T> };

export const SIN_EVENTO: LecturaDeEvento<never> = {
  eventoId: null,
  lectura: { tipo: 'sin_consultar' },
};

export function abrirEvento<T>(actual: LecturaDeEvento<T>, eventoId: string): LecturaDeEvento<T> {
  return actual.eventoId === eventoId
    ? actual
    : { eventoId, lectura: { tipo: 'sin_consultar' } };
}

/** Aplica una respuesta sólo si sigue siendo la del evento abierto. */
export function aplicarLecturaDeEvento<T>(
  actual: LecturaDeEvento<T>,
  eventoId: string,
  resultado: { ok: true; datos: T } | { ok: false },
): LecturaDeEvento<T> {
  if (actual.eventoId !== eventoId) return actual;
  return { eventoId, lectura: aplicarLectura(actual.lectura, resultado) };
}

export function lecturaDelEvento<T>(
  actual: LecturaDeEvento<T>,
  eventoId: string | null,
): Lectura<T> {
  return eventoId !== null && actual.eventoId === eventoId
    ? actual.lectura
    : { tipo: 'sin_consultar' };
}

/**
 * Lo que hace la ficha al abrirse: marca el evento, lanza la lectura y aplica
 * la respuesta sólo mientras esa petición siga vigente. Devuelve la función
 * que la invalida (al cerrar o cambiar de evento).
 */
export function iniciarLectura<T>(entrada: {
  eventoId: string;
  cargar: (eventoId: string) => Promise<T>;
  actualizar: (cambio: (actual: LecturaDeEvento<T>) => LecturaDeEvento<T>) => void;
}): () => void {
  const { eventoId, cargar, actualizar } = entrada;
  let vigente = true;
  actualizar((actual) => abrirEvento(actual, eventoId));
  cargar(eventoId)
    .then((datos) => {
      if (vigente) actualizar((a) => aplicarLecturaDeEvento(a, eventoId, { ok: true, datos }));
    })
    .catch(() => {
      if (vigente) actualizar((a) => aplicarLecturaDeEvento(a, eventoId, { ok: false }));
    });
  return () => {
    vigente = false;
  };
}
