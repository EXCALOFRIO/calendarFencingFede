import { inflateRawSync } from 'node:zlib';

/**
 * Lector mínimo de .xlsx (zip + XML) para las clasificaciones que algunas
 * federaciones publican en Excel. Sólo lee valores de celda (texto compartido,
 * texto en línea y números) de cada hoja; ni estilos ni fórmulas.
 */

/** Entradas de un zip; con `filtro`, sólo se descomprimen las que lo cumplen. */
export function entradasZip(buf: Buffer, filtro?: (nombre: string) => boolean): Map<string, Buffer> {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('xlsx_sin_directorio_zip');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = new Map<string, Buffer>();
  for (let n = 0; n < total; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx_directorio_corrupto');
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre);
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(inicio, inicio + comprimido);
    const quiere = !filtro || filtro(nombre);
    if (quiere && metodo === 0) salida.set(nombre, Buffer.from(datos));
    else if (quiere && metodo === 8) salida.set(nombre, inflateRawSync(datos));
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return salida;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function desescaparXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTIDADES[e] ?? m;
  });
}

function textoDe(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => desescaparXml(m[1])).join('');
}

function columna(ref: string): number {
  const letras = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export type HojaXlsx = { nombre: string; filas: string[][] };

export function leerXlsx(bytes: Buffer): HojaXlsx[] {
  const zip = entradasZip(bytes);
  const compartidas = [...(zip.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]));
  const libro = zip.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = zip.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const destino = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    /Id="([^"]+)"/.exec(m[0])?.[1] ?? '', /Target="([^"]+)"/.exec(m[0])?.[1] ?? '',
  ]));
  const hojas: HojaXlsx[] = [];
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = desescaparXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
    const objetivo = (destino.get(rid) ?? '').replace(/^\/?xl\//, '').replace(/^\//, '');
    const xml = zip.get(`xl/${objetivo}`)?.toString('utf8');
    if (!xml) continue;
    const filas: string[][] = [];
    for (const f of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const fila: string[] = [];
      for (const c of f[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const atributos = c[1];
        const cuerpo = c[2] ?? '';
        const ref = /r="([A-Z]+\d+)"/.exec(atributos)?.[1];
        const tipo = /t="(\w+)"/.exec(atributos)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
        let valor = '';
        if (tipo === 's' && v !== undefined) valor = compartidas[Number(v)] ?? '';
        else if (tipo === 'inlineStr') valor = textoDe(cuerpo);
        else if (v !== undefined) valor = desescaparXml(v);
        const i = ref ? columna(ref) : fila.length;
        while (fila.length < i) fila.push('');
        fila[i] = valor.trim();
      }
      filas.push(fila);
    }
    hojas.push({ nombre, filas });
  }
  return hojas;
}
