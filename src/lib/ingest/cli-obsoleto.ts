/** Los antiguos escritores no tienen un destino explícito ni lease D1. */
export function rechazarEscrituraNoCoordinada(args: readonly string[]): void {
  if (args.includes('--aplicar')) {
    throw new Error(
      'Escritura antigua deshabilitada. Usa backfill o ranking-oficial con --d1-local, esquema D1 verificado y guardia de escritura.',
    );
  }
}
