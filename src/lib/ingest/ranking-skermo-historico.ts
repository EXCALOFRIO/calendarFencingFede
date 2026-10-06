import { createHash } from 'node:crypto';
import type { PublicacionRanking } from './sources/ranking-oficial-historico';
import { normalizeLicense } from './sources/skermo-results';

/**
 * Carga del ranking nacional RFEE (Skermo) de temporadas pasadas en
 * `sport_ranking_publication` / `sport_ranking_entry`, preparada como SQL para
 * aplicar en D1 con las guardas deportivas activas.
 *
 * Vínculo con personas: el id de tirador de Skermo es estable entre temporadas
 * (es su ficha en Skermo, no un puesto), y su ficha publica la licencia RFEE.
 * La licencia se busca en `sport_external_id` (`rfee_license`, ya confirmadas
 * por los puestos finales de Skermo) y sólo se adjunta la persona si esa
 * licencia apunta a UNA sola persona canónica y no contradice el año de
 * nacimiento ni el género publicados. Por nombre sólo las filas de PDF, que
 * no publican licencia, y con las condiciones estrictas de `claveNombre`.
 */

export type PersonaLicencia = {
  /** Persona canónica (ya resuelta por `merged_into_person_id`). */
  personId: string;
  birthYear: number | null;
  gender: string | null;
};

export type MotivoSinVinculo =
  | 'sin_licencia'
  | 'licencia_desconocida'
  | 'licencia_ambigua'
  | 'nacimiento_distinto'
  | 'genero_distinto';

export type Vinculo =
  | { personId: string; motivo: null }
  | { personId: null; motivo: MotivoSinVinculo };

export function indicePorLicencia(
  filas: readonly { value: string; personId: string; birthYear: number | null; gender: string | null }[],
): Map<string, PersonaLicencia[]> {
  const indice = new Map<string, PersonaLicencia[]>();
  for (const f of filas) {
    const clave = normalizeLicense(f.value);
    const lista = indice.get(clave) ?? [];
    if (!lista.some((p) => p.personId === f.personId)) {
      lista.push({ personId: f.personId, birthYear: f.birthYear, gender: f.gender });
    }
    indice.set(clave, lista);
  }
  return indice;
}

export function vincular(
  entrada: { licencia: string | null; anioNacimiento: number | null; genero: 'M' | 'F' },
  indice: ReadonlyMap<string, readonly PersonaLicencia[]>,
): Vinculo {
  if (!entrada.licencia) return { personId: null, motivo: 'sin_licencia' };
  const candidatas = indice.get(normalizeLicense(entrada.licencia)) ?? [];
  if (candidatas.length === 0) return { personId: null, motivo: 'licencia_desconocida' };
  if (candidatas.length > 1) return { personId: null, motivo: 'licencia_ambigua' };
  const [p] = candidatas;
  if (p.birthYear !== null && entrada.anioNacimiento !== null && p.birthYear !== entrada.anioNacimiento) {
    return { personId: null, motivo: 'nacimiento_distinto' };
  }
  if (p.gender && p.gender !== 'MIXTO' && p.gender !== entrada.genero) {
    return { personId: null, motivo: 'genero_distinto' };
  }
  return { personId: p.personId, motivo: null };
}

/**
 * Las filas de los PDF (2017-2021) no publican licencia ni id de Skermo. Para
 * ellas, y sólo para ellas, hay un vínculo por nombre ESTRICTO:
 *
 * - el nombre completo normalizado coincide exactamente (mismas palabras, sin
 *   acentos ni mayúsculas; el orden da igual porque el PDF pone los apellidos
 *   delante);
 * - la candidata tiene resultados individuales en esa misma temporada, arma,
 *   género y categoría (el contexto de la lista), y su género no lo contradice;
 * - hay exactamente UNA candidata con ese nombre en ese contexto, y el nombre
 *   aparece una sola vez en la lista.
 *
 * Cualquier otra cosa deja la fila sin persona.
 */
export function claveNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-zñç]+/u)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export type CandidataNombre = {
  /** `temporada|arma|género|categoría` de la prueba en la que tiene resultado. */
  contexto: string;
  nombre: string;
  personId: string;
  genero: string | null;
};

export function contextoLista(p: Pick<PublicacionRanking, 'season' | 'arma' | 'genero' | 'categoria'>): string {
  return `${p.season}|${p.arma}|${p.genero}|${p.categoria}`;
}

export function indicePorNombre(candidatas: readonly CandidataNombre[]): Map<string, Set<string>> {
  const indice = new Map<string, Set<string>>();
  for (const c of candidatas) {
    const generoCompeticion = c.contexto.split('|')[2];
    if (c.genero && c.genero !== 'MIXTO' && c.genero !== generoCompeticion) continue;
    const clave = `${c.contexto}|${claveNombre(c.nombre)}`;
    const personas = indice.get(clave) ?? new Set<string>();
    personas.add(c.personId);
    indice.set(clave, personas);
  }
  return indice;
}

/** Persona de cada nombre de la lista (`null` si no hay vínculo estricto). */
export function vincularPorNombre(
  nombres: readonly string[],
  contexto: string,
  indice: ReadonlyMap<string, ReadonlySet<string>>,
): (string | null)[] {
  const veces = new Map<string, number>();
  for (const n of nombres) veces.set(claveNombre(n), (veces.get(claveNombre(n)) ?? 0) + 1);
  return nombres.map((n) => {
    const clave = claveNombre(n);
    if (!clave.includes(' ') || veces.get(clave) !== 1) return null;
    const personas = indice.get(`${contexto}|${clave}`);
    return personas && personas.size === 1 ? [...personas][0] : null;
  });
}

/** UUID determinista (formato v4) a partir de una clave: re-generar no cambia ids. */
export function uuidDeClave(clave: string): string {
  const h = createHash('sha256').update(clave, 'utf8').digest('hex');
  const variante = '89ab'[Number.parseInt(h[16], 16) & 3];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variante}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function idPublicacion(p: Pick<PublicacionRanking, 'fuente' | 'season' | 'arma' | 'genero' | 'categoriaOriginal' | 'formato' | 'publicadoEl'>): string {
  return uuidDeClave(
    ['sport_ranking_publication', p.fuente, p.season, p.arma, p.genero, p.categoriaOriginal, p.formato, p.publicadoEl].join('|'),
  );
}

function lit(v: string | number | null): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error('entero_esperado');
    return String(v);
  }
  if (/[\0\r\n;]/.test(v)) return `CAST(X'${Buffer.from(v, 'utf8').toString('hex')}' AS TEXT)`;
  return `'${v.replace(/'/g, "''")}'`;
}

export type FilaCarga = {
  sourceRef: string;
  personId: string | null;
  sourceName: string | null;
  position: number | null;
  points: string | null;
};

/** Bytes que cobran los triggers `sport_charge_*` por una fila (1024 + 4 × bytes de sus valores). */
export function cargoFila(valores: readonly (string | number | null)[]): number {
  let bytes = 0;
  for (const v of valores) {
    if (v === null) continue;
    bytes += typeof v === 'number' ? String(v).length : Buffer.byteLength(v, 'utf8');
  }
  return 1024 + 4 * bytes;
}

const FILAS_POR_INSERT = 80;

/**
 * Sentencias de UNA lista: cabecera, entradas y cobertura.
 *
 * - La cabecera sólo entra si no hay ya ninguna publicación de esa lista y
 *   temporada (de cualquier día): si el ingestor incremental ya la guardó, la
 *   carga no crea una segunda.
 * - Las entradas sólo entran si la cabecera es la de esta carga.
 * - La cobertura sólo entra si no existe.
 * Así el fichero se puede volver a aplicar sin duplicar nada.
 */
export function sentenciasPublicacion(
  p: PublicacionRanking,
  filas: readonly FilaCarga[],
  /** `observed`: día de lectura; `source`: fecha de referencia que publica la fuente (PDF). */
  dateBasis: 'observed' | 'source' = 'observed',
): { sentencias: string[]; cargo: number; id: string } {
  const id = idPublicacion(p);
  const mismaLista = `source=${lit(p.fuente)} AND season=${lit(p.season)} AND weapon=${lit(p.arma)} AND gender=${lit(p.genero)} AND category_raw=${lit(p.categoriaOriginal)} AND format=${lit(p.formato)}`;
  const cabecera = [id, p.fuente, p.season, p.arma, p.genero, p.categoria, p.categoriaOriginal, p.formato,
    p.publicadoEl, dateBasis, 1, p.url, p.total] as const;
  const sentencias = [
    `INSERT INTO sport_ranking_publication(id,source,season,weapon,gender,category,category_raw,format,published_on,date_basis,revision,source_url,published_total) ` +
      `SELECT ${cabecera.map(lit).join(',')} WHERE NOT EXISTS (SELECT 1 FROM sport_ranking_publication WHERE ${mismaLista})`,
  ];
  let cargo = cargoFila([...cabecera, Date.now()]);

  for (let i = 0; i < filas.length; i += FILAS_POR_INSERT) {
    const lote = filas.slice(i, i + FILAS_POR_INSERT);
    const valores = lote.map((f) => {
      const entryId = uuidDeClave(`sport_ranking_entry|${id}|${f.sourceRef}`);
      const fila = [entryId, id, f.sourceRef, f.personId, f.sourceName, null, f.position, f.points] as const;
      cargo += cargoFila(fila);
      return `(${fila.map(lit).join(',')})`;
    });
    sentencias.push(
      `INSERT INTO sport_ranking_entry(id,publication_id,source_ref,person_id,source_name,country_code,position,points) ` +
        `SELECT * FROM (VALUES ${valores.join(',')}) WHERE EXISTS (SELECT 1 FROM sport_ranking_publication WHERE id=${lit(id)}) ` +
        `ON CONFLICT(publication_id,source_ref) DO NOTHING`,
    );
  }

  const clave = `${p.arma}|${p.genero}|${p.categoriaOriginal}|${p.formato}`;
  const cobertura = [uuidDeClave(`sport_import_coverage|${p.fuente}|${p.season}|ranking|${clave}`), p.fuente, p.season,
    'ranking', clave, 'completo', p.total, filas.length, 1, p.url] as const;
  cargo += cargoFila([...cobertura, Date.now(), Date.now()]);
  sentencias.push(
    `INSERT INTO sport_import_coverage(id,source,season,fact_kind,competition_key,status,published_total,imported_total,attempts,source_url,last_checked_at) ` +
      `SELECT ${cobertura.map(lit).join(',')},(cast(strftime('%s','now') as integer)*1000) ` +
      `WHERE NOT EXISTS (SELECT 1 FROM sport_import_coverage WHERE source=${lit(p.fuente)} AND season=${lit(p.season)} AND fact_kind='ranking' AND competition_key=${lit(clave)})`,
  );
  return { sentencias, cargo, id };
}
