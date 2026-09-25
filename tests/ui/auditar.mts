/**
 * Auditoría de interfaz y accesibilidad con navegador real.
 *
 * Se ejecuta contra el servidor de desarrollo ya levantado:
 *
 *   npx tsx tests/ui/auditar.mts
 *
 * Mide, no opina: desbordamiento horizontal con `scrollWidth`, tamaños con
 * `getBoundingClientRect()`, tamaños de letra y contrastes con los colores
 * ya calculados por el navegador. Deja las capturas en `capturas/`.
 *
 * Se prueba con el perfil de iPhone de Playwright y no con una ventana
 * estrecha porque lo que cambia el resultado no es el ancho sino el puntero
 * táctil (`pointer: coarse`), que es lo que activa los mínimos de 44 px.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, type BrowserContext, type Page } from 'playwright';
import { autenticar, BASE_URL, type RolPrueba } from '../e2e/sesion.js';

type Hallazgo = {
  pagina: string;
  dispositivo: string;
  tipo: string;
  detalle: string;
};

const RUTAS_POR_ROL: Record<RolPrueba, string[]> = {
  admin: [
    '/',
    '/calendario',
    '/convocatorias',
    '/ranking',
    '/documentos',
    '/club',
    '/perfil',
    '/admin',
    '/admin/convocatorias',
    '/admin/inscripciones',
    '/admin/usuarios',
    '/admin/cuarentena',
    '/admin/emparejar',
    '/admin/normativa',
    '/admin/ajustes',
  ],
  coach: ['/', '/calendario', '/convocatorias', '/ranking', '/documentos', '/perfil'],
  club: ['/', '/calendario', '/club', '/ranking', '/perfil'],
  athlete: ['/', '/calendario', '/convocatorias', '/ranking', '/perfil'],
  guardian: ['/', '/calendario', '/perfil'],
};

const DISPOSITIVOS = [
  { nombre: 'iphone', movil: true, config: devices['iPhone 14 Pro'] },
  { nombre: 'escritorio', movil: false, config: { viewport: { width: 1440, height: 900 } } },
] as const;

/** Guion que se inyecta en la página; todo lo que mide vive en el navegador. */
const MEDIDOR = `(async () => {
  // ---- utilidades de color -------------------------------------------------
  /**
   * Convierte cualquier color CSS a sRGB.
   *
   * No vale con una expresión regular sobre \`rgb(...)\`: el tema está escrito
   * en \`oklch()\` y Chrome devuelve \`oklch(...)\` tal cual en
   * \`getComputedStyle\`. Se pinta en un lienzo de 1×1 y se lee el píxel, que
   * es la conversión que hace el propio navegador.
   */
  const __lienzo = document.createElement('canvas');
  __lienzo.width = __lienzo.height = 1;
  const __ctx = __lienzo.getContext('2d', { willReadFrequently: true });
  const __cache = new Map();
  function __pintar(css, base) {
    __ctx.globalCompositeOperation = 'copy';
    __ctx.fillStyle = base;
    __ctx.fillRect(0, 0, 1, 1);
    __ctx.globalCompositeOperation = 'source-over';
    __ctx.fillStyle = css;
    __ctx.fillRect(0, 0, 1, 1);
    return __ctx.getImageData(0, 0, 1, 1).data;
  }
  function aRgb(css) {
    if (!css || css === 'transparent' || css === 'none') return { r: 0, g: 0, b: 0, a: 0 };
    if (__cache.has(css)) return __cache.get(css);
    let out = null;
    try {
      __ctx.fillStyle = '#123456';
      __ctx.fillStyle = css;
      if (__ctx.fillStyle === '#123456' && !/123456/.test(css)) {
        out = null; // fillStyle no aceptó el valor
      } else {
        // Se compone sobre blanco y sobre negro y se despeja: así se evita el
        // redondeo de des-premultiplicar cuando el color lleva transparencia.
        const sobreBlanco = __pintar(css, '#fff');
        const sobreNegro = __pintar(css, '#000');
        const a = 1 - (sobreBlanco[0] - sobreNegro[0]) / 255;
        out =
          a < 0.004
            ? { r: 0, g: 0, b: 0, a: 0 }
            : { r: sobreNegro[0] / a, g: sobreNegro[1] / a, b: sobreNegro[2] / a, a };
      }
    } catch { out = null; }
    __cache.set(css, out);
    return out;
  }
  function mezclar(frente, fondo) {
    const a = frente.a;
    return {
      r: frente.r * a + fondo.r * (1 - a),
      g: frente.g * a + fondo.g * (1 - a),
      b: frente.b * a + fondo.b * (1 - a),
      a: 1,
    };
  }
  function luminancia(c) {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contraste(a, b) {
    const l1 = luminancia(a);
    const l2 = luminancia(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  /** Fondo efectivo: sube por los ancestros hasta encontrar uno opaco. */
  function fondoEfectivo(el) {
    let acumulado = null;
    let nodo = el;
    while (nodo) {
      const bg = aRgb(getComputedStyle(nodo).backgroundColor);
      if (bg && bg.a > 0) {
        acumulado = acumulado === null ? bg : mezclar(acumulado, bg);
        if (acumulado.a >= 0.999) return acumulado;
      }
      nodo = nodo.parentElement;
    }
    const base = { r: 0, g: 0, b: 0, a: 1 };
    return acumulado ? mezclar(acumulado, base) : base;
  }
  function visible(el) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function ruta(el) {
    const partes = [];
    let n = el;
    for (let i = 0; n && i < 4; i++) {
      let p = n.tagName.toLowerCase();
      if (n.id) p += '#' + n.id;
      else if (typeof n.className === 'string' && n.className.trim()) {
        p += '.' + n.className.trim().split(/\\s+/).slice(0, 3).join('.');
      }
      partes.unshift(p);
      n = n.parentElement;
    }
    return partes.join(' > ');
  }
  function texto(el) {
    return (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  }

  const esMovil = matchMedia('(pointer: coarse)').matches;

  // ---- 1. desbordamiento horizontal ---------------------------------------
  const de = document.documentElement;
  const desborde = {
    scrollWidth: de.scrollWidth,
    innerWidth: window.innerWidth,
    clientWidth: de.clientWidth,
    desborda: de.scrollWidth > de.clientWidth + 1,
    culpables: [],
  };
  if (desborde.desborda) {
    const limite = de.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > limite + 1 || r.left < -1) {
        // Sólo interesa el elemento más profundo que ya desborda por sí mismo.
        const hijoCulpable = Array.from(el.children).some((h) => {
          const hr = h.getBoundingClientRect();
          return hr.right > limite + 1 || hr.left < -1;
        });
        if (hijoCulpable) continue;
        desborde.culpables.push({
          sel: ruta(el),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          texto: texto(el),
        });
      }
    }
    desborde.culpables = desborde.culpables.slice(0, 12);
  }

  // ---- 2. controles nativos ------------------------------------------------
  //
  // Se distingue el control nativo que ve y toca una persona del que está
  // oculto: Radix Select emite un <select> de 1×1 con aria-hidden para que el
  // formulario envíe el valor, y el patrón de subida de ficheros esconde el
  // input tras una etiqueta con estilo. Ninguno de los dos abre la rueda de
  // iOS, así que no son el problema que se quiere evitar.
  const nativos = [];
  const SEL_NATIVOS =
    'select, input[type=date], input[type=datetime-local], input[type=range], ' +
    'input[type=color], input[type=time], input[type=month], input[type=week], ' +
    'input[type=file], input[type=checkbox], input[type=radio]';
  for (const el of document.querySelectorAll(SEL_NATIVOS)) {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const oculto =
      el.getAttribute('aria-hidden') === 'true' ||
      el.classList.contains('sr-only') ||
      s.opacity === '0' ||
      s.display === 'none' ||
      s.visibility === 'hidden' ||
      r.width <= 2 ||
      r.height <= 2;
    nativos.push({
      sel: ruta(el),
      tag: el.tagName.toLowerCase(),
      tipo: el.getAttribute('type') || '',
      oculto,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
    });
  }

  // ---- 3. objetivos táctiles ----------------------------------------------
  const tactiles = [];
  if (esMovil) {
    for (const el of document.querySelectorAll('button, a, [role=tab], [role=button], [role=switch], summary')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      // Un enlace dentro de un párrafo de texto corrido no es un objetivo táctil.
      const enLinea = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
      if (enLinea) continue;
      if (r.width < 43.5 || r.height < 43.5) {
        tactiles.push({
          sel: ruta(el),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          texto: texto(el) || el.getAttribute('aria-label') || '(sin texto)',
        });
      }
    }
  }

  // ---- 4. tamaño de letra --------------------------------------------------
  const letraPequena = [];
  const campos = [];
  if (esMovil) {
    const vistos = new Set();
    const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = it.nextNode())) {
      const t = (n.nodeValue || '').trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || !visible(el)) continue;
      if (el.closest('.sr-only, [aria-hidden=true]')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) {
        const clave = ruta(el) + '|' + Math.round(fs * 10);
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        letraPequena.push({ sel: ruta(el), px: Math.round(fs * 100) / 100, texto: t.slice(0, 50) });
      }
    }
    // Sólo los campos donde de verdad se escribe: iOS hace zoom al enfocar un
    // campo de texto con menos de 16 px, pero no al tocar una casilla.
    const SIN_TECLADO = ['checkbox', 'radio', 'file', 'hidden', 'submit', 'button', 'range', 'color', 'image', 'reset'];
    for (const el of document.querySelectorAll('input, textarea, [contenteditable=true]')) {
      if (!visible(el)) continue;
      if (el.classList.contains('sr-only')) continue;
      const tipo = el.getAttribute('type') || el.tagName.toLowerCase();
      if (SIN_TECLADO.includes(tipo)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) {
        campos.push({ sel: ruta(el), px: Math.round(fs * 100) / 100, tipo });
      }
    }
  }

  // ---- 5. contraste --------------------------------------------------------
  const contrastes = [];
  const vistosContraste = new Set();
  const itc = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let m;
  while ((m = itc.nextNode())) {
    const t = (m.nodeValue || '').trim();
    if (!t) continue;
    const el = m.parentElement;
    if (!el || !visible(el)) continue;
    if (el.closest('.sr-only, [aria-hidden=true]')) continue;
    const s = getComputedStyle(el);
    const fg0 = aRgb(s.color);
    if (!fg0) continue;
    const bg = fondoEfectivo(el);
    const fg = fg0.a < 1 ? mezclar(fg0, bg) : fg0;
    const px = parseFloat(s.fontSize);
    const peso = parseInt(s.fontWeight, 10) || 400;
    // "Texto grande" en WCAG: >=24 px, o >=18.66 px en negrita.
    const grande = px >= 24 || (px >= 18.66 && peso >= 700);
    const minimo = grande ? 3 : 4.5;
    const ratio = Math.round(contraste(fg, bg) * 100) / 100;
    if (ratio >= minimo) continue;
    const clave = s.color + '|' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + '|' + px;
    if (vistosContraste.has(clave)) continue;
    vistosContraste.add(clave);
    contrastes.push({
      sel: ruta(el),
      texto: t.slice(0, 40),
      color: 'rgb(' + [fg.r, fg.g, fg.b].map((v) => Math.round(v)).join(' ') + ')',
      fondo: 'rgb(' + [bg.r, bg.g, bg.b].map((v) => Math.round(v)).join(' ') + ')',
      px: Math.round(px * 10) / 10,
      peso,
      ratio,
      minimo,
    });
  }

  // ---- 6. barra inferior: ¿tapa contenido? ---------------------------------
  let barra = null;
  if (esMovil) {
    const nav = document.querySelector('nav.fixed.bottom-0, nav[class*="bottom-0"][class*="fixed"]');
    if (nav) {
      // Se baja del todo y se mira si el último contenido del <main> queda por
      // debajo del borde superior de la barra (es decir, tapado y sin escape).
      // 'instant' es obligatorio: el html lleva scroll-behavior: smooth y sin
      // forzarlo la medida se toma antes de que termine el desplazamiento.
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise((res) => setTimeout(res, 350));
      const r2 = nav.getBoundingClientRect();
      barra = { alto: Math.round(r2.height), top: Math.round(r2.top) };
      const main = document.querySelector('main');
      if (main) {
        const mr = main.getBoundingClientRect();
        barra.finMain = Math.round(mr.bottom);
        barra.tapaContenido = mr.bottom > r2.top + 1;
        barra.holgura = Math.round(r2.top - mr.bottom);
      }
      // El hueco reservado es fijo mientras que la barra crece con el área
      // segura del iPhone; se apunta para poder comprobarlo en el aparato.
      const cont = main && main.parentElement ? getComputedStyle(main.parentElement) : null;
      barra.reservaContenedor = cont ? cont.paddingBottom : null;
      barra.paddingBody = getComputedStyle(document.body).paddingBottom;
      const flotantes = [];
      for (const el of document.querySelectorAll('[class*="fixed"], [class*="sticky"]')) {
        if (el === nav || !visible(el)) continue;
        const er = el.getBoundingClientRect();
        if (er.bottom > r2.top + 1 && er.top < r2.bottom) {
          flotantes.push({ sel: ruta(el), bottom: Math.round(er.bottom), texto: texto(el) });
        }
      }
      barra.solapados = flotantes.slice(0, 6);
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }

  return { desborde, nativos, tactiles, letraPequena, campos, contrastes, barra, esMovil };
})()`;

async function auditarPagina(page: Page, ruta: string, dispositivo: string) {
  const errores: string[] = [];
  const avisos: string[] = [];

  const onError = (e: Error) => errores.push(`pageerror: ${e.message.split('\n')[0]}`);
  const onConsole = (msg: { type(): string; text(): string }) => {
    const t = msg.type();
    if (t === 'error') errores.push(`console.error: ${msg.text().slice(0, 300)}`);
    else if (t === 'warning') avisos.push(`console.warn: ${msg.text().slice(0, 300)}`);
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);

  let estado = 0;
  try {
    const res = await page.goto(`${BASE_URL}${ruta}`, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });
    estado = res?.status() ?? 0;
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(700);
  } catch (e) {
    errores.push(`navegación: ${(e as Error).message.split('\n')[0]}`);
  }

  const medida = await page.evaluate(MEDIDOR).catch((e) => {
    errores.push(`medidor: ${(e as Error).message.split('\n')[0]}`);
    return null;
  });

  const slug = ruta.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'inicio';
  await page
    .screenshot({ path: `capturas/${dispositivo}-${slug}.png`, fullPage: true })
    .catch(() => {});

  page.off('pageerror', onError);
  page.off('console', onConsole);

  return { ruta, estado, errores, avisos, medida };
}

async function main() {
  mkdirSync('capturas', { recursive: true });
  const soloRol = (process.env.ROL as RolPrueba) || null;
  const roles: RolPrueba[] = soloRol
    ? [soloRol]
    : ((process.env.ROLES?.split(',') as RolPrueba[]) ?? [
        'admin',
        'coach',
        'club',
        'athlete',
        'guardian',
      ]);

  const browser = await chromium.launch();
  const informe: Record<string, unknown>[] = [];
  const hallazgos: Hallazgo[] = [];

  for (const rol of roles) {
    for (const disp of DISPOSITIVOS) {
      // En roles distintos de admin sólo hace falta el barrido de errores.
      if (rol !== 'admin' && disp.nombre === 'escritorio') continue;

      const context: BrowserContext = await browser.newContext({
        ...disp.config,
        locale: 'es-ES',
      });
      await autenticar(context, rol, rol);
      const page = await context.newPage();

      for (const ruta of RUTAS_POR_ROL[rol]) {
        const etiquetaDisp = rol === 'admin' ? disp.nombre : `${disp.nombre}-${rol}`;
        const r = await auditarPagina(page, ruta, etiquetaDisp);
        informe.push({ rol, dispositivo: disp.nombre, ...r });

        const pref = `${ruta} [${rol}/${disp.nombre}]`;
        const m = r.medida as any;
        if (r.estado >= 400 || r.estado === 0) {
          hallazgos.push({ pagina: ruta, dispositivo: etiquetaDisp, tipo: 'HTTP', detalle: `estado ${r.estado}` });
        }
        for (const e of r.errores) {
          hallazgos.push({ pagina: ruta, dispositivo: etiquetaDisp, tipo: 'error', detalle: e });
        }
        for (const a of r.avisos) {
          hallazgos.push({ pagina: ruta, dispositivo: etiquetaDisp, tipo: 'aviso', detalle: a });
        }
        if (m?.desborde?.desborda) {
          hallazgos.push({
            pagina: ruta,
            dispositivo: etiquetaDisp,
            tipo: 'desbordamiento',
            detalle: `scrollWidth ${m.desborde.scrollWidth} > clientWidth ${m.desborde.clientWidth}; culpables: ${m.desborde.culpables
              .map((c: any) => `${c.sel} (right ${c.right}, w ${c.width}) «${c.texto}»`)
              .join(' | ')}`,
          });
        }
        for (const n of m?.nativos ?? []) {
          hallazgos.push({
            pagina: ruta,
            dispositivo: etiquetaDisp,
            tipo: n.oculto ? 'control nativo (oculto)' : 'control nativo VISIBLE',
            detalle: `${n.tag}${n.tipo ? `[type=${n.tipo}]` : ''} ${n.w}×${n.h} ${n.sel}`,
          });
        }
        for (const t of m?.tactiles ?? []) {
          hallazgos.push({ pagina: ruta, dispositivo: etiquetaDisp, tipo: 'táctil <44px', detalle: `${t.w}×${t.h} «${t.texto}» ${t.sel}` });
        }
        for (const t of m?.letraPequena ?? []) {
          hallazgos.push({ pagina: ruta, dispositivo: etiquetaDisp, tipo: 'letra <12px', detalle: `${t.px}px «${t.texto}» ${t.sel}` });
        }
        for (const c of m?.campos ?? []) {
          hallazgos.push({ pagina: ruta, dispositivo: etiquetaDisp, tipo: 'campo <16px (zoom iOS)', detalle: `${c.px}px ${c.tipo} ${c.sel}` });
        }
        for (const c of m?.contrastes ?? []) {
          hallazgos.push({
            pagina: ruta,
            dispositivo: etiquetaDisp,
            tipo: 'contraste',
            detalle: `${c.ratio}:1 (min ${c.minimo}) ${c.color} sobre ${c.fondo} ${c.px}px/${c.peso} «${c.texto}» ${c.sel}`,
          });
        }
        if (m?.barra?.tapaContenido) {
          hallazgos.push({
            pagina: ruta,
            dispositivo: etiquetaDisp,
            tipo: 'barra inferior tapa',
            detalle: `holgura ${m.barra.holgura}px (barra ${m.barra.alto}px)`,
          });
        }
        for (const s of m?.barra?.solapados ?? []) {
          hallazgos.push({ pagina: ruta, dispositivo: etiquetaDisp, tipo: 'flotante bajo la barra', detalle: `${s.sel} «${s.texto}»` });
        }

        console.log(
          `${pref} -> ${r.estado}` +
            (m?.desborde?.desborda ? ` DESBORDE(${m.desborde.scrollWidth}/${m.desborde.clientWidth})` : '') +
            (m?.nativos?.length ? ` NATIVOS(${m.nativos.length})` : '') +
            (m?.tactiles?.length ? ` TACTIL(${m.tactiles.length})` : '') +
            (m?.letraPequena?.length ? ` LETRA(${m.letraPequena.length})` : '') +
            (m?.campos?.length ? ` CAMPO(${m.campos.length})` : '') +
            (m?.contrastes?.length ? ` CONTRASTE(${m.contrastes.length})` : '') +
            (r.errores.length ? ` ERR(${r.errores.length})` : '') +
            (r.avisos.length ? ` WARN(${r.avisos.length})` : ''),
        );
      }

      await context.close();
    }
  }

  await browser.close();

  writeFileSync('tests/ui/informe.json', JSON.stringify({ hallazgos, informe }, null, 2));
  console.log(`\n${hallazgos.length} hallazgos -> tests/ui/informe.json`);

  const porTipo = new Map<string, number>();
  for (const h of hallazgos) porTipo.set(h.tipo, (porTipo.get(h.tipo) ?? 0) + 1);
  for (const [t, n] of [...porTipo].sort((a, b) => b[1] - a[1])) console.log(`  ${t}: ${n}`);
}

await main();
