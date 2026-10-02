/**
 * Almacén de `sport_import_coverage` en memoria con las reglas del upsert real
 * (`escribirCobertura`): clave única (fuente, temporada, tipo, prueba), un intento
 * más por escritura salvo `sinIntento`, cifras y cursor conservados cuando la
 * escritura no los trae. Es una simulación controlada: no es SQL real.
 */
export type FilaAlmacen = {
  source: string;
  season: string;
  factKind: string;
  competitionKey: string;
  competitionId: string | null;
  status: string;
  publishedTotal: number | null;
  importedTotal: number;
  attempts: number;
  cursor: string | null;
  sourceUrl: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
};

export type EscrituraAlmacen = {
  season: string;
  factKind: string;
  competitionKey: string;
  competitionId?: string | null;
  status: string;
  publishedTotal?: number | null;
  importedTotal?: number;
  sourceUrl?: string | null;
  lastError?: string | null;
  cursor?: string | null;
  sinIntento?: boolean;
};

export class AlmacenCobertura {
  readonly filas = new Map<string, FilaAlmacen>();
  escrituras = 0;

  constructor(private readonly ahora: () => Date = () => new Date('2026-12-01T00:00:00Z')) {}

  private clave(source: string, f: Pick<EscrituraAlmacen, 'season' | 'factKind' | 'competitionKey'>): string {
    return [source, f.season, f.factKind, f.competitionKey].join('|');
  }

  escribir(source: string, f: EscrituraAlmacen): void {
    this.escrituras += 1;
    const k = this.clave(source, f);
    const previa = this.filas.get(k);
    const conservar = f.publishedTotal === undefined;
    if (!previa) {
      this.filas.set(k, {
        source,
        season: f.season,
        factKind: f.factKind,
        competitionKey: f.competitionKey,
        competitionId: f.competitionId ?? null,
        status: f.status,
        publishedTotal: f.publishedTotal ?? null,
        importedTotal: f.importedTotal ?? 0,
        attempts: f.sinIntento ? 0 : 1,
        cursor: f.cursor ?? null,
        sourceUrl: f.sourceUrl ?? null,
        lastCheckedAt: f.sinIntento ? null : this.ahora(),
        lastError: f.lastError ?? null,
      });
      return;
    }
    this.filas.set(k, {
      ...previa,
      competitionId: f.competitionId ?? previa.competitionId,
      status: f.status,
      ...(conservar ? {} : { publishedTotal: f.publishedTotal ?? null, importedTotal: f.importedTotal ?? 0 }),
      attempts: f.sinIntento ? previa.attempts : previa.attempts + 1,
      sourceUrl: f.sourceUrl ?? null,
      ...(f.cursor === undefined ? {} : { cursor: f.cursor }),
      lastCheckedAt: f.sinIntento ? previa.lastCheckedAt : this.ahora(),
      lastError: f.lastError ?? null,
    });
  }

  /** Inserta sólo si no existía (descubrimiento: nunca pisa un estado ya leído). */
  insertarSiNoExiste(source: string, f: EscrituraAlmacen): boolean {
    if (this.filas.has(this.clave(source, f))) return false;
    this.escribir(source, { ...f, sinIntento: true });
    return true;
  }

  obtener(source: string, factKind: string, competitionKey: string, season?: string): FilaAlmacen | undefined {
    for (const f of this.filas.values()) {
      if (
        f.source === source &&
        f.factKind === factKind &&
        f.competitionKey === competitionKey &&
        (season === undefined || f.season === season)
      ) {
        return f;
      }
    }
    return undefined;
  }
}
