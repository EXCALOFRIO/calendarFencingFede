/**
 * Gancho de la matriz de dispositivos: se carga con `--import` en un arnés de
 * capturas sin tocarlo y envuelve `chromium.launch`. La primera vez que el
 * arnés abre una ruta de su servidor que encaja con MATRIZ_PAGINAS, la mide y
 * la captura en todas las variantes de MATRIZ_VARIANTES (contextos nuevos del
 * mismo navegador, con el servidor del arnés vivo) y añade una línea por
 * variante a MATRIZ_SALIDA. Las capturas propias del arnés no se escriben
 * (devuelven un búfer vacío) para no duplicar trabajo.
 *
 * Lo lanza `matriz-dispositivos.mts`; a mano:
 *   $env:MATRIZ_ALIAS='poule'; $env:MATRIZ_PAGINAS='^/prueba-hoja-abierta$'; …
 *   npx tsx --import ./tests/ui/matriz-gancho.mts tests/ui/tanda1.mts
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { nombrePagina, type Variante } from './matriz-config.mts';
import { medirVariante } from './matriz-medir.mts';

const RAIZ = process.cwd();
const ALIAS = process.env.MATRIZ_ALIAS ?? path.basename(process.argv[1] ?? 'arnes', '.mts');
const PAGINAS = new RegExp(process.env.MATRIZ_PAGINAS ?? '.');
const VARIANTES = JSON.parse(process.env.MATRIZ_VARIANTES ?? '[]') as Variante[];
const SALIDA = process.env.MATRIZ_SALIDA ?? path.join(RAIZ, 'capturas', 'matriz', 'medidas', `${ALIAS}.jsonl`);
const CARPETA = process.env.MATRIZ_CARPETA ?? path.join(RAIZ, 'capturas', 'matriz');
const PARALELO = Math.max(1, Number(process.env.MATRIZ_PARALELO ?? 4));
const LISTAR = Boolean(process.env.MATRIZ_LISTAR);
const FORZAR_CLARO = Boolean(process.env.MATRIZ_FORZAR_CLARO);
const NOMBRES = JSON.parse(process.env.MATRIZ_NOMBRES ?? '{}') as Record<string, string>;
mkdirSync(path.dirname(SALIDA), { recursive: true });

const hechas = new Set<string>();

async function correrMatriz(nuevoContexto: Browser['newContext'], url: string) {
  const u = new URL(url);
  const ruta = `${u.pathname}${u.search}`;
  if (hechas.has(ruta)) return;
  hechas.add(ruta);
  if (LISTAR) { console.error(`[matriz] ruta ${ruta} ${PAGINAS.test(ruta) ? 'ENTRA' : '-'}`); return; }
  if (!PAGINAS.test(ruta)) return;
  const pagina = nombrePagina(ALIAS, ruta, NOMBRES);
  // `medirVariante` crea contextos con `newContext`: se le pasa el original para no envolverlos.
  const crudo = { newContext: nuevoContexto } as unknown as Browser;
  const cola = [...VARIANTES];
  const inicio = Date.now();
  await Promise.all(Array.from({ length: PARALELO }, async () => {
    for (let v = cola.shift(); v; v = cola.shift()) {
      const r = await medirVariante(crudo, url, v, { alias: ALIAS, pagina, ruta }, { carpeta: CARPETA, raiz: RAIZ, forzarClaro: FORZAR_CLARO });
      appendFileSync(SALIDA, `${JSON.stringify(r)}\n`);
      if (r.error) console.error(`[matriz] ${pagina} @${v.clave}: ${r.error}`);
    }
  }));
  console.error(`[matriz] ${pagina}: ${VARIANTES.length} variantes en ${Math.round((Date.now() - inicio) / 1000)} s`);
}

function envolverPagina(pagina: Page, nuevoContexto: Browser['newContext']): Page {
  const ir = pagina.goto.bind(pagina);
  pagina.goto = (async (url: string, opciones?: Parameters<Page['goto']>[1]) => {
    const respuesta = await ir(url, opciones);
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
      try {
        await correrMatriz(nuevoContexto, url);
      } catch (e) {
        console.error('[matriz]', (e as Error).message);
      }
    }
    return respuesta;
  }) as Page['goto'];
  pagina.screenshot = (async () => Buffer.alloc(0)) as Page['screenshot'];
  return pagina;
}

// tsx puede evaluar este módulo dos veces (cargador ESM y CJS): se envuelve una sola.
const marca = Symbol.for('matriz-gancho');
const registro = chromium as unknown as Record<symbol, boolean>;
if (!registro[marca]) {
  registro[marca] = true;
  const lanzar = chromium.launch.bind(chromium);
  chromium.launch = (async (...args: Parameters<typeof chromium.launch>) => {
    const navegador: Browser = await lanzar(...args);
    const nuevaPagina = navegador.newPage.bind(navegador);
    const nuevoContexto = navegador.newContext.bind(navegador);
    navegador.newPage = async (o) => envolverPagina(await nuevaPagina(o), nuevoContexto);
    navegador.newContext = async (o) => {
      const contexto: BrowserContext = await nuevoContexto(o);
      const nueva = contexto.newPage.bind(contexto);
      contexto.newPage = async () => envolverPagina(await nueva(), nuevoContexto);
      return contexto;
    };
    return navegador;
  }) as typeof chromium.launch;
}
