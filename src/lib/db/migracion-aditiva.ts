import { createHash } from 'node:crypto';

/**
 * Preflight y plan de una aplicación manual y acotada de migraciones aditivas.
 * Reproduce exactamente lo que Drizzle registra en `drizzle.__drizzle_migrations`
 * (sha256 del archivo completo y `when` del journal) para poder comparar el
 * ledger real sin invocar el migrador general, que aplicaría cualquier pendiente.
 * No toca la base: recibe lo leído y devuelve un veredicto.
 */

export interface EntradaJournal {
  tag: string;
  when: number;
}

export interface MigracionLocal {
  tag: string;
  when: number;
  hash: string;
  sentencias: string[];
}

export interface FilaLedger {
  hash: string;
  created_at: number;
}

export interface EstadoLeido {
  ledger: FilaLedger[];
  tablasSport: string[];
  tablasPrevias: string[];
  /** Valores de cada enum existente, en su orden de ordenación. */
  enums: Record<string, string[]>;
}

export type Veredicto = { ok: true; pendientes: MigracionLocal[] } | { ok: false; motivos: string[] };

export const TABLAS_PREVIAS_REQUERIDAS = [
  'athlete',
  'event',
  'event_competition',
  'user_profile',
  'competition_registration',
] as const;

export const ENUMS_PREVIOS_REQUERIDOS = ['weapon', 'gender', 'category_code', 'competition_format'] as const;
export const ENUMS_DEPORTIVOS = ['sport_coverage_status', 'sport_link_status'] as const;

export const TABLAS_DEPORTIVAS_ESPERADAS = [
  'sport_bout',
  'sport_competition',
  'sport_edition',
  'sport_external_id',
  'sport_favorite',
  'sport_import_coverage',
  'sport_link_candidate',
  'sport_person',
  'sport_person_alias',
  'sport_ranking_entry',
  'sport_ranking_publication',
  'sport_registration_ref',
  'sport_result',
] as const;

export function cargarMigracionesLocales(
  journal: { entries: EntradaJournal[] },
  leerSql: (tag: string) => string,
): MigracionLocal[] {
  return journal.entries.map((e) => {
    // El índice de git guarda LF y el ledger se calculó sobre ese contenido; con
    // core.autocrlf el árbol de trabajo puede traer CRLF y cambiaría el hash.
    const texto = leerSql(e.tag).replace(/\r\n/g, '\n');
    return {
      tag: e.tag,
      when: e.when,
      hash: createHash('sha256').update(texto).digest('hex'),
      sentencias: texto
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    };
  });
}

export function evaluarPreflight(
  locales: MigracionLocal[],
  estado: EstadoLeido,
  etiquetasPendientes: string[],
): Veredicto {
  const motivos: string[] = [];
  const n = etiquetasPendientes.length;
  const cola = locales.slice(locales.length - n);
  const previas = locales.slice(0, locales.length - n);

  if (n === 0 || cola.map((m) => m.tag).join('|') !== etiquetasPendientes.join('|')) {
    motivos.push('las pendientes esperadas no son la cola ordenada del journal');
  }
  for (let i = 1; i < locales.length; i++) {
    if (locales[i].when <= locales[i - 1].when) motivos.push(`journal no creciente en ${locales[i].tag}`);
  }

  const ledger = [...estado.ledger].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  if (ledger.length !== previas.length) {
    motivos.push(`ledger tiene ${ledger.length} filas y se esperaban ${previas.length}`);
  } else {
    previas.forEach((m, i) => {
      if (ledger[i].hash !== m.hash) motivos.push(`hash del ledger distinto en ${m.tag}`);
      if (Number(ledger[i].created_at) !== m.when) motivos.push(`created_at del ledger distinto en ${m.tag}`);
    });
  }
  for (const m of cola) {
    if (estado.ledger.some((f) => f.hash === m.hash || Number(f.created_at) === m.when)) {
      motivos.push(`${m.tag} ya figura en el ledger`);
    }
  }

  if (estado.tablasSport.length > 0) motivos.push(`ya existen tablas sport: ${estado.tablasSport.length}`);
  for (const t of TABLAS_PREVIAS_REQUERIDAS) {
    if (!estado.tablasPrevias.includes(t)) motivos.push(`falta la tabla previa ${t}`);
  }
  for (const e of ENUMS_PREVIOS_REQUERIDOS) {
    if (!estado.enums[e]) motivos.push(`falta el enum previo ${e}`);
  }
  for (const e of ENUMS_DEPORTIVOS) {
    if (estado.enums[e]) motivos.push(`el enum ${e} ya existe`);
  }
  const categorias = estado.enums.category_code ?? [];
  for (const v of ['M10', 'M12']) {
    if (categorias.includes(v)) motivos.push(`category_code ya contiene ${v}`);
  }
  for (const v of ['M9', 'M11', 'M13']) {
    if (!categorias.includes(v)) motivos.push(`category_code no contiene ${v}, ancla de 0019`);
  }

  return motivos.length > 0 ? { ok: false, motivos } : { ok: true, pendientes: cola };
}
