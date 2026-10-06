/**
 * Resumen por consola de `capturas/auditoria/medidas.jsonl` (lo que escribe
 * `auditoria-sonda.mts`): una línea por captura con los recuentos y, debajo,
 * los ejemplos de lo que falla. Los chips se agrupan por texto en todas las
 * capturas para ver si un mismo chip cambia de aspecto entre pantallas.
 *
 *   npx tsx tests/ui/auditoria-resumen.mts [filtro-de-arnés]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Medida = {
  arnes: string; captura: string; ancho: number; alto: number; desborde: number; culpables: string[];
  pequenos: number; pequenosEj: string[]; largos: string[]; repetidos: string[]; palabras: number;
  contraste: string[]; contrasteTotal: number; contrasteDudosos: number; truncados: string[]; scrollX: string[];
  chips: Record<string, string[]>; mundial: string[]; vacios: string[]; cls: number; fcp: number | null; kB: number | null;
};

const filtro = process.argv[2];
const vistas = new Map<string, Medida>();
for (const linea of readFileSync(path.join(process.cwd(), 'capturas', 'auditoria', 'medidas.jsonl'), 'utf8').split('\n')) {
  if (!linea.trim()) continue;
  const m = JSON.parse(linea) as Medida;
  if (filtro && !m.arnes.includes(filtro)) continue;
  vistas.set(`${m.captura}|${m.ancho}`, m);
}

const chips = new Map<string, Map<string, string[]>>();
for (const m of vistas.values()) {
  const movil = m.ancho < 768;
  const n = path.basename(m.captura ?? '?');
  console.log(`\n## ${m.arnes}/${n} @${m.ancho} alto=${m.alto} palabras=${m.palabras} desborde=${m.desborde} pequeños=${movil ? m.pequenos : '-'} contraste=${m.contrasteTotal}(+${m.contrasteDudosos}?) cls=${m.cls} fcp=${m.fcp} kB=${m.kB}`);
  const bloque = (titulo: string, xs: string[]) => { if (xs.length) console.log(`  ${titulo}:\n    ${xs.join('\n    ')}`); };
  bloque('culpables', m.culpables);
  if (movil) bloque('pequeños', m.pequenosEj.slice(0, 6));
  bloque('largos', m.largos);
  bloque('repetidos', m.repetidos);
  bloque('contraste', m.contraste.slice(0, 5));
  bloque('truncados', m.truncados.slice(0, 5));
  bloque('scrollX', m.scrollX);
  bloque('MUNDIAL', m.mundial);
  bloque('vacíos', m.vacios);
  for (const [k, firmas] of Object.entries(m.chips)) {
    if (!chips.has(k)) chips.set(k, new Map());
    for (const f of firmas) {
      const donde = chips.get(k)!;
      if (!donde.has(f)) donde.set(f, []);
      donde.get(f)!.push(`${m.arnes}/${n}`);
    }
  }
}

console.log('\n# Chips por texto (firma: alto, letra, radio, fondo, color, borde)');
for (const [k, firmas] of chips) {
  console.log(`  ${k}: ${firmas.size} variantes`);
  for (const [f, donde] of firmas) console.log(`    ${f}  ← ${[...new Set(donde)].slice(0, 3).join(', ')}${donde.length > 3 ? ` (+${donde.length - 3})` : ''}`);
}
