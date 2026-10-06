/**
 * Piezas puras de los datos nacionales de perfil: fechas y clubes de Skermo,
 * PDF y Engarde, y lectura de la clasificación de una prueba de Skermo
 * (`/ranking/public/RFEE/competition/<id>`), que es la única pantalla que une
 * licencia RFEE, nombre con acentos, club y fecha de nacimiento.
 */
import * as cheerio from 'cheerio';

export function fechaSkermo(texto: string | null | undefined): string | null {
  const m = (texto ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function anioDeFecha(iso: string | null | undefined): number | null {
  const m = (iso ?? '').match(/^(\d{4})-\d{2}-\d{2}$/);
  if (!m) return null;
  const a = Number(m[1]);
  return a >= 1920 && a <= 2030 ? a : null;
}

/** «CCC-M (ESP)» → «CCC-M»; «UTB - Z» → «UTB-Z»; vacío → null. */
export function normalizarClub(club: string | null | undefined): string | null {
  const limpio = (club ?? '')
    .replace(/\s*\([A-Z]{3}\)\s*$/, '')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio === '' ? null : limpio;
}

/** Un código interno de club (sin minúsculas ni espacios), no un nombre legible. */
export function esCodigoClub(valor: string): boolean {
  return !/\s/.test(valor.trim()) && valor === valor.toUpperCase();
}

export type FilaClub = { club: string | null; fuente: string; fecha: string | null };
export type ClubElegido = { codigo: string | null; nombre: string | null; fuente: string; fecha: string | null };

const PRIORIDAD_FUENTE: Record<string, number> = { skermo_rfee: 0, ranking_rfee: 0, engarde: 1, fie: 2, rfee_pdf: 3 };

/**
 * El club del resultado más reciente. A igual fecha manda la fuente que no
 * trunca (Skermo > Engarde > FIE > PDF). Los PDF cortan el código («FED-»,
 * «CCC-»): se completa con el código entero más reciente de la misma persona
 * que empiece igual; si no hay ninguno, se pasa al siguiente resultado.
 */
export function elegirClub(filas: readonly FilaClub[]): ClubElegido | null {
  const limpias = filas
    .map((f) => ({ ...f, club: normalizarClub(f.club) }))
    .filter((f): f is FilaClub & { club: string } => f.club !== null)
    .sort((a, b) =>
      String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')) ||
      (PRIORIDAD_FUENTE[a.fuente] ?? 9) - (PRIORIDAD_FUENTE[b.fuente] ?? 9));
  const codigos = limpias.map((f) => f.club);
  const truncado = (c: string) => c.endsWith('-') || codigos.some((o) => o.length > c.length && o.startsWith(c));
  for (const f of limpias) {
    let club = f.club;
    if (truncado(club)) {
      const entero = limpias.find((o) => o.club.length > club.length && o.club.startsWith(club) && !o.club.endsWith('-'));
      if (!entero) continue;
      club = entero.club;
    }
    const codigo = esCodigoClub(club);
    return { codigo: codigo ? club : null, nombre: codigo ? null : club, fuente: f.fuente, fecha: f.fecha };
  }
  return null;
}

export type FilaClasificacionSkermo = {
  licencia: string;
  nombre: string;
  apellidos: string;
  club: string | null;
  fechaNacimiento: string | null;
};

/** Filas de la clasificación de una prueba de Skermo, por la etiqueta de cada columna. */
export function leerClasificacionSkermo(html: string): FilaClasificacionSkermo[] {
  const $ = cheerio.load(html);
  const tabla = $('table').filter((_, t) => /Licencia/i.test($(t).find('th').text())).first();
  if (tabla.length === 0) return [];
  const etiquetas = tabla.find('thead th, tr:first-child th').toArray()
    .map((th) => $(th).text().replace(/\s+/g, ' ').trim().toLowerCase());
  const col = (re: RegExp) => etiquetas.findIndex((e) => re.test(e));
  const iLic = col(/licencia/);
  const iNom = col(/^nombre/);
  const iApe = col(/apellidos/);
  const iClub = col(/^club/);
  const iFecha = col(/nacimiento/);
  if (iLic < 0 || iNom < 0 || iApe < 0) return [];
  const salida: FilaClasificacionSkermo[] = [];
  tabla.find('tbody tr').each((_, tr) => {
    // Celdas sólo de móvil fuera, igual que en skermo-results.ts.
    const celdas = $(tr).find('td').toArray().filter((td) => {
      const c = $(td).attr('class') ?? '';
      return !(c.includes('hidden-lg') && c.includes('hidden-md'));
    });
    const leer = (i: number) => {
      if (i < 0 || !celdas[i]) return '';
      const td = $(celdas[i]).clone();
      td.find('.hidden-lg.hidden-md').remove();
      return td.text().replace(/\s+/g, ' ').trim();
    };
    const licencia = leer(iLic).toUpperCase();
    if (!/^[A-Z]{2,4}\d{4,6}$/.test(licencia)) return;
    salida.push({
      licencia,
      nombre: leer(iNom),
      apellidos: leer(iApe),
      club: normalizarClub(leer(iClub)),
      fechaNacimiento: fechaSkermo(leer(iFecha)),
    });
  });
  return salida;
}

/**
 * Fecha de nacimiento de una persona a partir de varias publicaciones. Gana la
 * fecha con al menos dos tercios del apoyo; si los años discrepan sin mayoría
 * clara, no se afirma nada.
 */
export function consensoFecha(fechas: readonly { fecha: string; fuente: string }[]):
  { fecha: string | null; anio: number | null; fuente: string | null; conflicto: boolean } {
  const vacia = { fecha: null, anio: null, fuente: null, conflicto: false };
  if (fechas.length === 0) return vacia;
  const porFecha = new Map<string, { n: number; fuentes: Set<string> }>();
  for (const f of fechas) {
    const e = porFecha.get(f.fecha) ?? { n: 0, fuentes: new Set<string>() };
    e.n += 1;
    e.fuentes.add(f.fuente);
    porFecha.set(f.fecha, e);
  }
  const orden = [...porFecha.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  const [mejor, datos] = orden[0];
  if (datos.n * 3 >= fechas.length * 2) {
    return { fecha: mejor, anio: anioDeFecha(mejor), fuente: [...datos.fuentes].sort().join('+'), conflicto: orden.length > 1 };
  }
  // Sin mayoría de fecha, puede haberla de año (un día mal tecleado).
  const porAnio = new Map<number, number>();
  for (const f of fechas) {
    const a = anioDeFecha(f.fecha);
    if (a !== null) porAnio.set(a, (porAnio.get(a) ?? 0) + 1);
  }
  const [anio, n] = [...porAnio.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (anio !== null && n * 3 >= fechas.length * 2) {
    return { fecha: null, anio, fuente: [...new Set(fechas.map((f) => f.fuente))].sort().join('+'), conflicto: true };
  }
  return { ...vacia, conflicto: true };
}
