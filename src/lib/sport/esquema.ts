/**
 * ¿Está aplicado el esquema deportivo (migraciones 0017 y 0018)?
 *
 * Las migraciones las aplica a mano el propietario, así que el mismo código
 * tiene que servir con y sin ellas. La respuesta sale de una consulta al
 * catálogo (`to_regclass`), que contesta `null` si la tabla falta en vez de
 * lanzar: un error aquí es un fallo real de la base y se propaga, nunca se
 * lee como «esquema ausente». Lo mismo vale para las consultas posteriores:
 * quien llama no las envuelve en un `catch` que las disfrace de legacy.
 *
 * Presente se recuerda para siempre (las tablas no desaparecen); ausente sólo
 * un minuto, para notar la migración sin reiniciar nada.
 */

export type EstadoEsquema = {
  /** `sport_person` + `sport_external_id` (0017). */
  identidad: boolean;
  /** `sport_registration_ref` (0018). */
  referencias: boolean;
};

const AUSENTE_MS = 60_000;

export function crearDetectorEsquema(
  consultar: () => Promise<EstadoEsquema>,
  ahora: () => number = Date.now,
): () => Promise<EstadoEsquema> {
  let completo: EstadoEsquema | null = null;
  let ausenteHasta = 0;
  let ultimo: EstadoEsquema | null = null;
  // Las lecturas que llegan a la vez (un perfil en frío pide el esquema desde
  // cuatro sitios) comparten una sola consulta al catálogo.
  let enCurso: Promise<EstadoEsquema> | null = null;

  return async () => {
    if (completo) return completo;
    if (ultimo && ahora() < ausenteHasta) return ultimo;
    enCurso ??= consultar().then((estado) => {
      if (estado.identidad && estado.referencias) completo = estado;
      ultimo = estado;
      ausenteHasta = ahora() + AUSENTE_MS;
      return estado;
    }).finally(() => {
      enCurso = null;
    });
    return enCurso;
  };
}

/**
 * Detector de una única condición de esquema (p. ej. valores añadidos a un
 * enum por una migración manual). Mismas reglas que `crearDetectorEsquema`:
 * verdadero se recuerda, falso se reintenta pasado un minuto y un error de la
 * base se propaga sin recordarse como «ausente».
 */
export function crearDetectorCondicion(
  consultar: () => Promise<boolean>,
  ahora: () => number = Date.now,
): () => Promise<boolean> {
  let aplicada = false;
  let ausenteHasta = 0;

  return async () => {
    if (aplicada) return true;
    if (ahora() < ausenteHasta) return false;
    aplicada = await consultar();
    if (!aplicada) ausenteHasta = ahora() + AUSENTE_MS;
    return aplicada;
  };
}
