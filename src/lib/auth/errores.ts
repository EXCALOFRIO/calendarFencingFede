/**
 * Error of the in-process auth API. The message stays generic on purpose (it
 * can reach logs); only the HTTP status tells the caller what kind of failure
 * it was. No dependencies: the access page imports it into a client bundle.
 */
export class ErrorAcceso extends Error {
  constructor(readonly status: number) {
    super('ACCESO_NO_PERMITIDO');
    this.name = 'ErrorAcceso';
  }
}

export function estadoErrorAcceso(error: unknown): number | null {
  return error instanceof ErrorAcceso ? error.status : null;
}
