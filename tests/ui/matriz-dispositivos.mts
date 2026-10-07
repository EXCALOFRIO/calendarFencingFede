/**
 * Matriz de dispositivos: lanza los arneses de capturas sin servidor de las
 * páginas principales con `matriz-gancho.mts` enganchado, y cada página se
 * mide y se captura en todos los dispositivos (iPhone SE a escritorio 1920),
 * en tema oscuro y claro (esquema de color del sistema) y con el texto al
 * 130 % en dos móviles. Después junta las medidas, calcula los fallos y
 * escribe el informe con la tabla priorizada y las 20 peores.
 *
 *   npx tsx tests/ui/matriz-dispositivos.mts            # completo: capturas/matriz/
 *   npx tsx tests/ui/matriz-dispositivos.mts --rapido   # iPhone 15 + 1440: capturas/matriz-rapido/
 *
 * Opciones: --solo=perfil,ranking (sólo esos arneses; el informe junta lo
 * último de los demás) · --dispositivos=iphone-se,escritorio · --temas=oscuro
 * · --sin-texto · --paralelo=N (arneses a la vez, 2 por defecto) · --listar
 * (sólo muestra las rutas que abre cada arnés) · --informe (no ejecuta nada,
 * sólo rehace el informe con las medidas que hay). PERF_DB es la copia SQLite
 * (por defecto %USERPROFILE%\calendario-datos\calendario-trabajo\nuevo9.sqlite,
 * que se abre en sólo lectura). MATRIZ_FORZAR_CLARO=1 quita además la clase
 * `dark` en el tema claro. Sale con código 1 si alguna página tiene desborde
 * horizontal o no cargó en un móvil.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  arneses, ETIQUETAS, evaluar, informeMarkdown, parsearArgumentos, parsearMatriz, peores,
  type Arnes, type EstadoArnes, type Registro,
} from './matriz-config.mts';

const RAIZ = process.cwd();
const args = parsearArgumentos(process.argv.slice(2));
const soloInforme = process.argv.includes('--informe');
const variantes = parsearMatriz(args);
const modo = args.rapido ? 'rápido' : 'completo';
const CARPETA = path.join(RAIZ, 'capturas', args.rapido ? 'matriz-rapido' : 'matriz');
const MEDIDAS = path.join(CARPETA, args.listar ? 'listar' : 'medidas');
const REGISTROS = path.join(CARPETA, 'registros');
const TIEMPO_MAX = Number(process.env.MATRIZ_TIEMPO ?? 40 * 60) * 1000;
const PERF_DB = process.env.PERF_DB ?? path.join(homedir(), 'calendario-datos', 'calendario-trabajo', 'nuevo9.sqlite');
const TSX = path.join(RAIZ, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const todos = arneses();
for (const s of args.solo) if (!todos.some((a) => a.alias === s)) throw new Error(`arnés desconocido: ${s} (hay ${todos.map((a) => a.alias).join(', ')})`);
const elegidos = args.solo.length > 0 ? todos.filter((a) => args.solo.includes(a.alias)) : todos;
mkdirSync(MEDIDAS, { recursive: true });
mkdirSync(REGISTROS, { recursive: true });

function leerJsonl(fichero: string): Registro[] {
  if (!existsSync(fichero)) return [];
  return readFileSync(fichero, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Registro);
}

/** Primera línea de error útil del registro de un arnés que no llegó a pintar nada. */
function motivoDe(log: string): string {
  const lineas = log.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const error = lineas.find((l) => /^(\w*Error|error|Error \[|Falta |✘|X \[ERROR\])/.test(l) || /ERR_|Cannot find|is not defined|does not provide/.test(l));
  return (error ?? lineas.at(-1) ?? 'sin salida').slice(0, 300);
}

function matar(pid: number) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(pid, 'SIGKILL');
}

async function correr(a: Arnes): Promise<EstadoArnes> {
  const salida = path.join(MEDIDAS, `${a.alias}.jsonl`);
  const log = path.join(REGISTROS, `${a.alias}.log`);
  writeFileSync(salida, '');
  const flujo = createWriteStream(log);
  const inicio = Date.now();
  if (!existsSync(PERF_DB)) throw new Error(`no existe PERF_DB: ${PERF_DB}`);
  const hijo = spawn(process.execPath, [TSX, '--import', './tests/ui/matriz-gancho.mts', path.join('tests', 'ui', a.fichero)], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PERF_DB,
      ...a.env,
      MATRIZ_ALIAS: a.alias,
      MATRIZ_PAGINAS: a.paginas.source,
      MATRIZ_VARIANTES: JSON.stringify(variantes),
      MATRIZ_SALIDA: salida,
      MATRIZ_NOMBRES: JSON.stringify(a.nombres ?? {}),
      MATRIZ_CARPETA: CARPETA,
      ...(args.listar ? { MATRIZ_LISTAR: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let texto = '';
  const recoger = (b: Buffer) => { texto += b.toString(); flujo.write(b); };
  hijo.stdout.on('data', recoger);
  hijo.stderr.on('data', (b: Buffer) => {
    recoger(b);
    for (const l of b.toString().split('\n')) if (l.startsWith('[matriz]')) console.log(`  ${a.alias}: ${l.slice(9).trim()}`);
  });
  let agotado = false;
  const reloj = setTimeout(() => { agotado = true; if (hijo.pid) matar(hijo.pid); }, TIEMPO_MAX);
  const codigo = await new Promise<number | null>((ok) => hijo.on('close', ok));
  clearTimeout(reloj);
  flujo.end();
  const paginas = [...new Set(leerJsonl(salida).map((r) => r.pagina))];
  const segundos = Math.round((Date.now() - inicio) / 1000);
  const estado: EstadoArnes = {
    alias: a.alias, fichero: a.fichero, cubre: a.cubre, codigo, segundos, paginas,
    estado: paginas.length === 0 ? 'no-arranco' : agotado ? 'parcial' : 'ok',
  };
  if (agotado) estado.motivo = `cortado a los ${TIEMPO_MAX / 1000} s`;
  else if (paginas.length === 0) estado.motivo = motivoDe(texto);
  else if (codigo !== 0) estado.motivo = `el arnés salió con código ${codigo} (sus propias comprobaciones; ver registros/${a.alias}.log)`;
  writeFileSync(path.join(MEDIDAS, `${a.alias}.estado.json`), JSON.stringify(estado, null, 2));
  return estado;
}

if (!soloInforme) {
  console.log(`Matriz ${modo}: ${elegidos.length} arneses × ${variantes.length} variantes (${variantes.map((v) => v.clave).join(', ')})`);
  const cola = [...elegidos];
  await Promise.all(Array.from({ length: Math.min(args.paralelo, cola.length) }, async () => {
    for (let a = cola.shift(); a; a = cola.shift()) {
      console.log(`→ ${a.alias} (${a.fichero})`);
      const e = await correr(a);
      console.log(`← ${a.alias}: ${e.estado}, ${e.paginas.length} páginas, ${e.segundos} s${e.motivo ? ` — ${e.motivo}` : ''}`);
    }
  }));
  if (args.listar) process.exit(0);
}

// El informe junta lo último de cada arnés, también de los que no se han vuelto a lanzar.
const estados: EstadoArnes[] = todos.map((a) => {
  const f = path.join(MEDIDAS, `${a.alias}.estado.json`);
  return existsSync(f)
    ? JSON.parse(readFileSync(f, 'utf8')) as EstadoArnes
    : { alias: a.alias, fichero: a.fichero, cubre: a.cubre, estado: 'omitido', codigo: null, segundos: 0, paginas: [], motivo: 'no se ha ejecutado' };
});
const registros = readdirSync(MEDIDAS).filter((f) => f.endsWith('.jsonl')).flatMap((f) => leerJsonl(path.join(MEDIDAS, f)));
const filas = evaluar(registros);
const generado = new Date().toISOString();
writeFileSync(path.join(CARPETA, 'informe.json'), JSON.stringify({
  generado, modo, perfDb: path.basename(PERF_DB), variantes, arneses: estados,
  peores: peores(filas).map((f) => ({ pagina: f.pagina, variante: f.variante, puntos: f.puntos, captura: f.captura, fallos: f.fallos })),
  resultados: filas.map(({ medida, ...f }) => ({ ...f, alto: medida?.alto ?? null, fcp: medida?.fcp ?? null, cls: medida?.cls ?? null, truncados: medida?.truncados ?? [] })),
}, null, 2));
writeFileSync(path.join(CARPETA, 'informe.md'), informeMarkdown({ generado, modo, variantes, arneses: estados, filas }));

console.log(`\nPeores 20 (${filas.length} capturas medidas):`);
for (const f of peores(filas)) {
  console.log(`  ${String(f.puntos).padStart(4)}  ${f.pagina.padEnd(40)} ${f.variante.padEnd(28)} ${f.fallos.slice(0, 4).map((x) => `${ETIQUETAS[x.tipo]} ${x.cuenta}`).join(', ')}`);
}
for (const e of estados.filter((x) => x.estado !== 'ok')) console.log(`  ! ${e.alias}: ${e.estado} — ${e.motivo ?? ''}`);
console.log(`\nInforme: ${path.relative(RAIZ, path.join(CARPETA, 'informe.md'))}`);
const graves = filas.filter((f) => f.tactil && f.fallos.some((x) => x.tipo === 'desborde' || x.tipo === 'error'));
if (graves.length > 0 || estados.some((e) => e.estado === 'no-arranco')) process.exitCode = 1;
