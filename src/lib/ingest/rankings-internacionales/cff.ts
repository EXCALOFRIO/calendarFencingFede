import type { Arma, Categoria, FilaInternacional, Genero, ListaInternacional } from './tipos';

/**
 * Ranking de fin de temporada de la Canadian Fencing Federation (`fencing.ca`, robots.txt con
 * `Crawl-delay: 10` y sin exclusiones para estos ficheros). La página «Rankings and
 * Classifications» enlaza un Excel (o CSV) por temporada con todas las listas: columnas
 * `Event` («SME», «JWF», «U15MS»...), `Rank`, `CFF Licence`, `Last Name`, `First Name`, club,
 * puntos por prueba y `Total`. Sin id FIE ni nacimiento: vínculo por nombre, país CAN y género.
 * Las listas de veteranos y de menores de 15 años sin categoría propia aquí no se leen.
 */

export const CFF_PAGINA = 'https://fencing.ca/rankings-and-classifications/';
export const CFF_PAUSA_MS = 10_000;

const CATEGORIAS: Record<string, { categoria: Categoria; raw: string }> = {
  S: { categoria: 'ABS', raw: 'Senior' },
  J: { categoria: 'M20', raw: 'Junior' },
  C: { categoria: 'M17', raw: 'Cadet' },
  U15: { categoria: 'M15', raw: 'U15' },
};
const ARMAS: Record<string, Arma> = { E: 'ESPADA', F: 'FLORETE', S: 'SABLE' };
const GENEROS: Record<string, Genero> = { M: 'M', W: 'F' };

export type DocumentoCff = { temporada: string; url: string; archivo: string };

/** Ficheros de ranking de fin de temporada que enlaza la página (Excel o CSV). */
export function documentosCff(html: string): DocumentoCff[] {
  const salida: DocumentoCff[] = [];
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.(?:xlsx|csv))"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const t = /^(20\d\d)-(20\d\d) Season End Rankings$/i.exec(texto);
    if (!t || Number(t[2]) !== Number(t[1]) + 1) continue;
    const url = new URL(m[1].replace(/^http:/, 'https:').replace(/fencing\.ca\/\//, 'fencing.ca/'), CFF_PAGINA).toString();
    if (salida.some((d) => d.temporada === `${t[1]}-${t[2]}`)) continue;
    salida.push({ temporada: `${t[1]}-${t[2]}`, url, archivo: `${t[1]}-${t[2]}${/\.csv$/i.test(url) ? '.csv' : '.xlsx'}` });
  }
  return salida;
}

/** CSV con comillas dobles opcionales. */
export function leerCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i += 1;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i += 1;
      fila.push(campo);
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x !== '')) filas.push(fila);
  return filas;
}

const mayus = (s: string) => s.trim().toUpperCase();
const nombrePropio = (s: string) => s.trim().toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Puntos con dos decimales como mucho (el Excel guarda flotantes sin redondear). */
function puntos(v: string | undefined): string | null {
  const n = Number((v ?? '').trim());
  if ((v ?? '').trim() === '' || !Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100);
}

export function listasCff(doc: Pick<DocumentoCff, 'temporada' | 'url'>, filas: readonly string[][], publicadoEl: string): ListaInternacional[] {
  const cab = (filas[0] ?? []).map((c) => c.trim().toLowerCase());
  const col = (n: string) => cab.indexOf(n);
  const [iEv, iRank, iLic, iApe, iNom, iTot] = [col('event'), col('rank'), col('cff licence'), col('last name'), col('first name'), col('total')];
  if ([iEv, iRank, iApe, iNom].some((i) => i < 0)) return [];
  const porEvento = new Map<string, FilaInternacional[]>();
  const vistos = new Map<string, Set<string>>();
  for (const r of filas.slice(1)) {
    const ev = (r[iEv] ?? '').trim().toUpperCase();
    if (!/^(S|J|C|U15)(M|W)(E|F|S)$/.test(ev)) continue;
    const apellido = mayus(r[iApe] ?? '');
    const nombre = nombrePropio(r[iNom] ?? '');
    if (!apellido) continue;
    const lic = (r[iLic] ?? '').trim();
    let ref = /^[A-Z]\d{2}-\d+$/i.test(lic) ? `cff:${lic.toUpperCase()}` : `cff:${apellido}_${nombre}`.replace(/\s+/g, '_');
    const v = vistos.get(ev) ?? vistos.set(ev, new Set()).get(ev)!;
    const puesto = Number(r[iRank]);
    if (v.has(ref)) ref = `${ref}#${puesto}`;
    v.add(ref);
    (porEvento.get(ev) ?? porEvento.set(ev, []).get(ev)!).push({
      ref, nombre: `${apellido} ${nombre}`.trim(), pais: null, puesto: Number.isInteger(puesto) && puesto > 0 ? puesto : null,
      puntos: iTot >= 0 ? puntos(r[iTot]) : null,
    });
  }
  return [...porEvento].map(([ev, fs]) => {
    const m = /^(S|J|C|U15)(M|W)(E|F|S)$/.exec(ev)!;
    const c = CATEGORIAS[m[1]];
    fs.sort((a, b) => (a.puesto ?? 1e9) - (b.puesto ?? 1e9));
    return {
      fuente: 'cff_ranking' as const, temporada: doc.temporada, arma: ARMAS[m[3]], genero: GENEROS[m[2]], categoria: c.categoria, categoriaRaw: c.raw,
      publicadoEl, baseFecha: 'observed' as const, url: doc.url, total: fs.length, filas: fs,
    };
  });
}
