export const ERROR_SOLO_LECTURA = 'VISTA_PREVIA_SOLO_LECTURA';
export const ERROR_VISTA_CADUCADA = 'VISTA_PREVIA_CADUCADA';

/** La guarda se aplica en el servidor, también al invocar una acción sin UI. */
export function exigirEscritura(perfil: { preview?: unknown; qa?: unknown }): void {
  if (perfil.preview || perfil.qa) {
    throw Object.assign(
      new Error('La vista previa es de solo lectura. Sal de ella para guardar cambios.'),
      { digest: ERROR_SOLO_LECTURA },
    );
  }
}

export function vistaPreviaCaducada(): never {
  throw Object.assign(
    new Error('La vista previa ha caducado o ya no está autorizada.'),
    { digest: ERROR_VISTA_CADUCADA },
  );
}
