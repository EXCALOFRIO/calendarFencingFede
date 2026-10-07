/**
 * Auditoría de accesibilidad (WCAG 2.2 AA) de las pantallas principales: lanza
 * los arneses sin servidor con `a11y-gancho.mts` enganchado (axe-core y sondas
 * propias en cada ruta) y escribe `capturas/a11y/informe.md` e `informe.json`.
 *
 *   npm install axe-core --prefix $env:TEMP\a11y-axe      # una vez, fuera del repo
 *   $env:PERF_DB="$env:USERPROFILE\calendario-datos\calendario-trabajo\nuevo11.sqlite"
 *   npx tsx tests/ui/a11y-auditoria.mts                     # todos los arneses
 *   npx tsx tests/ui/a11y-auditoria.mts --solo=ranking,poule
 *   npx tsx tests/ui/a11y-auditoria.mts --informe           # sólo rehace el informe
 *
 * A11Y_VARIANTES=movil,escritorio,zoom200,texto200,quieto elige variantes;
 * A11Y_TIEMPO (s) corta cada arnés. La copia SQLite se abre en sólo lectura.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const RAIZ = process.cwd();
const CARPETA = path.join(RAIZ, 'capturas', 'a11y');
const MEDIDAS = path.join(CARPETA, 'medidas');
const REGISTROS = path.join(CARPETA, 'registros');
const PERF_DB = process.env.PERF_DB ?? path.join(homedir(), 'calendario-datos', 'calendario-trabajo', 'nuevo11.sqlite');
const TSX = path.join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const TIEMPO = Number(process.env.A11Y_TIEMPO ?? 25 * 60) * 1000;

type Arnes = { alias: string; fichero: string; paginas: RegExp; env?: Record<string, string>; cubre: string };
const hoy = new Date();
const mes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ARNESES: Arnes[] = [
  { alias: 'calendario', fichero: 'calendario-pasado.mts', paginas: /^\/\d{4}-\d{2}-(mes|resultados)$/, env: { MESES: `${mes(hoy)},${mes(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1))}` }, cubre: 'Calendario y hoja de resultados' },
  { alias: 'ficha-evento', fichero: 'ficha-evento-v2.mts', paginas: /^\/[^?]+$/, cubre: 'Ficha de evento' },
  { alias: 'explorar', fichero: 'explorar-app.mts', paginas: /^\/explorar(\/buscar|\/siguiendo|\/ediciones|\?q=alejandro)?$/, cubre: 'Explorar: feed, Buscar, Siguiendo, Competiciones' },
  { alias: 'perfil', fichero: 'perfil-secciones.mts', paginas: /^\/llavador-/, env: { SOLO: 'llavador' }, cubre: 'Perfil y secciones' },
  { alias: 'prueba', fichero: 'prueba-v2.mts', paginas: /^\/copa-(clasificacion|poules|directas)$/, env: { EDICION_PARTES: 'a8f16016-15ed-4f33-b5c6-beb73548a37c' }, cubre: 'Prueba: clasificación, poules, cuadro' },
  { alias: 'poule', fichero: 'tanda1.mts', paginas: /^\/(prueba-hoja-abierta|rivales)$/, cubre: 'Poule a pantalla completa y rivales' },
  { alias: 'cara-a-cara', fichero: 'cara-a-cara-v2.mts', paginas: /^\/zabala-ramirez(-poule)?$/, cubre: 'Cara a cara' },
  { alias: 'ranking', fichero: 'ranking-moderno.mts', paginas: /^\/ranking-(internacional|nacional|europeo|jjoo)$/, env: { LATENCIA: '0' }, cubre: '/ranking internacional, nacional, europeo y olímpico' },
  { alias: 'ranking-perfil', fichero: 'diseno-perfil.mts', paginas: /^\/(ranking-nacional|ranking-internacional)$/, cubre: 'Ranking en el perfil' },
  { alias: 'armazon', fichero: 'ola2a.mts', paginas: /^\/(calendario|explorar|buscar|ranking|tu|notificaciones)$/, cubre: 'Barra, cabeceras y «Tú»' },
  { alias: 'notificaciones', fichero: 'notificaciones.mts', paginas: /^\/(bandeja|bandeja-vacia|ajustes|ajustes-iphone|ajustes-activo)$/, cubre: 'Notificaciones y Ajustes › Notificaciones' },
  { alias: 'hoja', fichero: 'sistema-muestra.mts', paginas: /^\/(\?hoja=1)?$/, cubre: 'Piezas del sistema y HojaInferior abierta (hidratada)' },
];

const argv = process.argv.slice(2);
const solo = (argv.find((a) => a.startsWith('--solo='))?.slice(7) ?? '').split(',').filter(Boolean);
const soloInforme = argv.includes('--informe');
const paralelo = Number(argv.find((a) => a.startsWith('--paralelo='))?.slice(11) ?? 2);
for (const s of solo) if (!ARNESES.some((a) => a.alias === s)) throw new Error(`arnés desconocido: ${s}`);
mkdirSync(MEDIDAS, { recursive: true });
mkdirSync(REGISTROS, { recursive: true });

function matar(pid: number) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(pid, 'SIGKILL');
}

async function correr(a: Arnes) {
  const salida = path.join(MEDIDAS, `${a.alias}.jsonl`);
  writeFileSync(salida, '');
  const flujo = createWriteStream(path.join(REGISTROS, `${a.alias}.log`));
  const inicio = Date.now();
  const hijo = spawn(process.execPath, [TSX, '--import', './tests/ui/a11y-gancho.mts', path.join('tests', 'ui', a.fichero)], {
    cwd: RAIZ,
    env: { ...process.env, PERF_DB, ...a.env, A11Y_ALIAS: a.alias, A11Y_PAGINAS: a.paginas.source, A11Y_SALIDA: salida },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hijo.stdout.on('data', (b: Buffer) => flujo.write(b));
  hijo.stderr.on('data', (b: Buffer) => {
    flujo.write(b);
    for (const l of b.toString().split('\n')) if (l.startsWith('[a11y]')) console.log(`  ${a.alias}: ${l.slice(7).trim()}`);
  });
  let agotado = false;
  const reloj = setTimeout(() => { agotado = true; if (hijo.pid) matar(hijo.pid); }, TIEMPO);
  const codigo = await new Promise<number | null>((ok) => hijo.on('close', ok));
  clearTimeout(reloj);
  flujo.end();
  const estado = { alias: a.alias, fichero: a.fichero, cubre: a.cubre, codigo, agotado, segundos: Math.round((Date.now() - inicio) / 1000), rutas: [...new Set(leer(salida).map((r) => r.ruta))] };
  writeFileSync(path.join(MEDIDAS, `${a.alias}.estado.json`), JSON.stringify(estado, null, 2));
  console.log(`← ${a.alias}: ${estado.rutas.length} rutas, ${estado.segundos} s${agotado ? ' (cortado)' : ''}${codigo ? ` código ${codigo}` : ''}`);
}

type Linea = {
  alias: string; ruta: string; variante: string; error?: string;
  axe?: { violaciones: { id: string; impacto: string; ayuda: string; wcag: string[]; nodos: number; ejemplos: { selector: string; html: string; motivo: string }[] }[] };
  sondas?: Record<string, unknown> & { h1: string[]; saltos: string[]; landmarks: { main: string[]; nav: string[] }; barras: { etiqueta: string; enlaces: string[]; conCurrent: number }[]; tablas: { que: string; th: number; caption: boolean }[]; pseudoTablas: string[]; vivos: string[]; svgSinNombre: string[]; clicablesSinTeclado: string[]; pequenosTotal: number; pequenos: string[]; pestanasSinEstado: string[]; imagenes: { alt: string | null; src: string; oculto: boolean }[]; zoomBloqueado: string };
  tab?: { total: number; invisibles: string[]; tapados: string[]; sinIndicador: string[]; atras: string[]; enDialogo: boolean[] };
  dialogo?: { abiertos: number; cierraConEscape: boolean };
  recortes?: { desborde: number; culpables?: string[]; truncadosTotal: number; truncados: string[]; cortados: string[]; fijosPx: number; alto: number };
  movimiento?: { vivas: { nombre: string; ms: number; iter: number; en: string }[]; infinitas: string[]; scrollSuave: string };
};

function leer(f: string): Linea[] {
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Linea);
}

if (!soloInforme) {
  const elegidos = solo.length > 0 ? ARNESES.filter((a) => solo.includes(a.alias)) : ARNESES;
  const cola = [...elegidos];
  await Promise.all(Array.from({ length: Math.min(paralelo, cola.length) }, async () => {
    for (let a = cola.shift(); a; a = cola.shift()) { console.log(`→ ${a.alias} (${a.fichero})`); await correr(a); }
  }));
}

// ------------------------------------------------------------------ informe
const lineas = readdirSync(MEDIDAS).filter((f) => f.endsWith('.jsonl')).flatMap((f) => leer(path.join(MEDIDAS, f)));
const md: string[] = [`# Auditoría de accesibilidad`, '', `Generado ${new Date().toISOString()}. ${lineas.length} medidas en ${new Set(lineas.map((l) => `${l.alias}${l.ruta}`)).size} rutas.`, ''];

md.push('## Arneses', '', '| Arnés | Fichero | Rutas | s | Código |', '|---|---|---|---|---|');
for (const a of ARNESES) {
  const f = path.join(MEDIDAS, `${a.alias}.estado.json`);
  const e = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as { rutas: string[]; segundos: number; codigo: number | null; agotado: boolean } : null;
  md.push(`| ${a.alias} | ${a.fichero} | ${e ? e.rutas.join(' ') || '(ninguna)' : 'sin ejecutar'} | ${e?.segundos ?? ''} | ${e ? (e.agotado ? 'cortado' : e.codigo) : ''} |`);
}
md.push('');

const peso: Record<string, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };
const reglas = new Map<string, { impacto: string; ayuda: string; wcag: string[]; nodos: number; paginas: Set<string>; ejemplos: string[] }>();
for (const l of lineas) for (const v of l.axe?.violaciones ?? []) {
  const r = reglas.get(v.id) ?? { impacto: v.impacto, ayuda: v.ayuda, wcag: v.wcag, nodos: 0, paginas: new Set(), ejemplos: [] };
  r.nodos += v.nodos;
  r.paginas.add(`${l.alias}${l.ruta}@${l.variante}`);
  for (const e of v.ejemplos) if (r.ejemplos.length < 6 && !r.ejemplos.some((x) => x.startsWith(e.selector))) r.ejemplos.push(`${e.selector} — ${e.html.replace(/\s+/g, ' ')}`);
  reglas.set(v.id, r);
}
md.push('## axe-core por regla', '', '| Regla | Impacto | WCAG | Nodos | Páginas | Ayuda |', '|---|---|---|---|---|---|');
const orden = [...reglas].sort((a, b) => (peso[b[1].impacto] ?? 0) - (peso[a[1].impacto] ?? 0) || b[1].paginas.size - a[1].paginas.size);
for (const [id, r] of orden) md.push(`| ${id} | ${r.impacto} | ${r.wcag.join(' ')} | ${r.nodos} | ${r.paginas.size} | ${r.ayuda} |`);
md.push('');
for (const [id, r] of orden) {
  md.push(`### ${id}`, '', `Páginas: ${[...r.paginas].join(', ')}`, '');
  for (const e of r.ejemplos) md.push(`- \`${e.slice(0, 300).replace(/`/g, "'")}\``);
  md.push('');
}

md.push('## Por pantalla', '');
for (const ruta of [...new Set(lineas.map((l) => `${l.alias}${l.ruta}`))]) {
  const de = lineas.filter((l) => `${l.alias}${l.ruta}` === ruta);
  md.push(`### ${ruta}`, '');
  for (const l of de) {
    if (l.error) { md.push(`- **${l.variante}**: error ${l.error}`); continue; }
    const s = l.sondas;
    const partes: string[] = [];
    if (l.axe) partes.push(`axe ${l.axe.violaciones.map((v) => `${v.id}(${v.nodos})`).join(', ') || 'limpio'}`);
    if (s) {
      partes.push(`h1 ${s.h1.length} ${JSON.stringify(s.h1)}`, `main ${s.landmarks.main.length}`, `nav ${JSON.stringify(s.landmarks.nav)}`);
      if (s.saltos.length) partes.push(`saltos de encabezado: ${s.saltos.join(' ; ')}`);
      for (const b of s.barras) partes.push(`barra «${b.etiqueta}»: ${b.enlaces.join(' | ')}`);
      partes.push(`tablas ${s.tablas.map((t) => `${t.que.slice(0, 40)} th=${t.th} nombre=${t.caption}`).join(' ; ') || 0}`);
      if (s.pseudoTablas.length) partes.push(`rejillas sin semántica de tabla: ${s.pseudoTablas.join(' ; ')}`);
      partes.push(`vivas ${s.vivos.length ? s.vivos.join(' ; ') : 0}`);
      if (s.svgSinNombre.length) partes.push(`svg sin nombre ni aria-hidden: ${s.svgSinNombre.slice(0, 5).join(' ; ')}`);
      if (s.clicablesSinTeclado.length) partes.push(`clicables sin teclado: ${s.clicablesSinTeclado.slice(0, 5).join(' ; ')}`);
      if (s.pequenosTotal) partes.push(`objetivos < 24 px: ${s.pequenosTotal} (${s.pequenos.slice(0, 4).join(' ; ')})`);
      if (s.pestanasSinEstado.length) partes.push(`pestañas sin estado: ${s.pestanasSinEstado.join(' ; ')}`);
      const alts = s.imagenes.filter((i) => !i.oculto);
      if (alts.length) partes.push(`img: ${alts.length} (alt vacío ${alts.filter((i) => i.alt === '').length}, sin alt ${alts.filter((i) => i.alt === null).length}; ej. ${[...new Set(alts.map((i) => i.alt))].slice(0, 5).map((a) => JSON.stringify(a)).join(', ')})`);
      if (/user-scalable=no|maximum-scale=1(\.0)?\b/.test(s.zoomBloqueado)) partes.push(`viewport bloquea zoom: ${s.zoomBloqueado}`);
    }
    if (l.tab) {
      partes.push(`Tab ${l.tab.total} paradas`);
      if (l.tab.sinIndicador.length) partes.push(`sin indicador de foco ${l.tab.sinIndicador.length}: ${l.tab.sinIndicador.slice(0, 4).join(' ; ')}`);
      if (l.tab.invisibles.length) partes.push(`foco en invisibles ${l.tab.invisibles.length}: ${l.tab.invisibles.slice(0, 4).join(' ; ')}`);
      if (l.tab.tapados.length) partes.push(`foco tapado ${l.tab.tapados.length}: ${l.tab.tapados.slice(0, 3).join(' ; ')}`);
      if (l.tab.atras.length) partes.push(`saltos atrás ${l.tab.atras.length}: ${l.tab.atras.slice(0, 2).join(' ; ')}`);
      if (l.tab.enDialogo.some(Boolean)) partes.push(`en diálogo ${l.tab.enDialogo.filter(Boolean).length}/${l.tab.enDialogo.length}`);
    }
    if (l.dialogo) partes.push(`diálogo Escape cierra: ${l.dialogo.cierraConEscape}`);
    if (l.recortes) partes.push(`desborde ${l.recortes.desborde}px${l.recortes.culpables?.length ? ` (${l.recortes.culpables.slice(0, 3).join(' ; ')})` : ''}, truncados ${l.recortes.truncadosTotal}, cortados ${l.recortes.cortados.length}${l.recortes.cortados.length ? ` (${l.recortes.cortados.slice(0, 4).join(' ; ')})` : ''}, fijos ${l.recortes.fijosPx}/${l.recortes.alto}px`);
    if (l.movimiento) partes.push(`movimiento con reduce: ${l.movimiento.vivas.length} animaciones vivas${l.movimiento.vivas.length ? ` (${l.movimiento.vivas.slice(0, 4).map((v) => `${v.nombre} ${v.ms}ms×${v.iter} en ${v.en}`).join(' ; ')})` : ''}, infinitas ${l.movimiento.infinitas.length}, scroll ${l.movimiento.scrollSuave}`);
    md.push(`- **${l.variante}**: ${partes.join(' · ')}`);
  }
  md.push('');
}
writeFileSync(path.join(CARPETA, 'informe.md'), md.join('\n'));
writeFileSync(path.join(CARPETA, 'informe.json'), JSON.stringify(lineas, null, 2));
console.log(`Informe: ${path.relative(RAIZ, path.join(CARPETA, 'informe.md'))} (${reglas.size} reglas de axe con fallos)`);
