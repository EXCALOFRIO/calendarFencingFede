import { chromium, devices } from 'playwright';

/**
 * Barrido final: cada papel recorre sus pantallas, en móvil y en escritorio.
 *
 * Lo que se mide de verdad, no «la página carga»:
 *   - código de respuesta,
 *   - desborde horizontal en píxeles,
 *   - **textos cortados**, y cuál se corta,
 *   - errores de JavaScript y de hidratación en la consola,
 *   - que no se haya acabado en la pantalla de acceso.
 *
 * Los textos cortados **cuentan como fallo**. Antes se medían y se imprimían
 * sin más, así que una pantalla con ocho nombres partidos por la mitad salía
 * como «sin problemas»: el usuario ya se quejó de leer «Liga Nacional
 * Iberdrola ...» y no saber cuál era. Un texto que no se puede leer es un
 * fallo, y además se imprime el texto para poder arreglarlo sin adivinar.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ SE EXIGE QUE HAYA TEXTO, Y NO SOLO DESBORDE
 * -------------------------------------------------------------------------
 * La versión anterior contaba `scrollWidth > clientWidth` en cualquier
 * elemento sin hijos, y eso daba **falsos positivos con forma de dato**: en
 * `/admin/inscripciones` salían «8 textos cortados» y las ocho eran la casilla
 * de shadcn. `globals.css` le da área táctil con `[role='checkbox']::after
 * { inset: -13px }`, así que una casilla de 16 px declara 29 px de contenido:
 * 16 + 13 por la derecha. O sea que la medida estaba contando **la mejora de
 * accesibilidad como si fuera un defecto**, y tres pantallas salían marcadas
 * sin tener una sola letra partida.
 *
 * Así que ahora un «texto cortado» tiene que tener texto: se exige un nodo de
 * texto con contenido. Eso descarta de raíz las casillas, los interruptores y
 * los campos de formulario, que desbordan por diseño —el valor de un `input`
 * se desplaza dentro del campo y se puede seleccionar entero— y no son letra
 * ilegible.
 *
 * Se perdona además lo que lleva `truncate` o `line-clamp` a propósito (recorte
 * declarado, con el valor entero accesible al lado) y lo que vive dentro de un
 * contenedor con desplazamiento propio.
 */

const BASE = 'http://localhost:3000';
const CONTRASENA = 'Demo-2026-Esgrima!';

const PAPELES: [string, string, string[]][] = [
  [
    'tiradora',
    'tiradora@demo.local',
    // `/alta` entra con dos papeles a propósito: con esta cuenta, que YA tiene
    // ficha, se barre la pantalla de confirmación; con la de la dirección
    // técnica, que no tiene, se barre el buscador. Son los dos estados que
    // puede enseñar la misma URL.
    ['/', '/estado', '/convocatorias', '/ranking', '/documentos', '/perfil', '/alta'],
  ],
  /*
    Aquí se barría también una cuenta de **tutora** (`madre@demo.local`). Se ha
    ido con el papel: la aplicación es solo para la dirección técnica, los
    seleccionadores y los tiradores —*«no es para madres ni nada»*—, así que ese
    perfil está revocado y su acceso acaba, correctamente, en `/entrar`.

    Lo dejo escrito porque el barrido la delató de la forma más confusa posible:
    **ocho pantallas «con algo», las ocho de esa cuenta**, y parecía un fallo de
    sesión recién introducido. No lo era: era este barrido probando una cuenta a
    la que acabábamos de cerrar la puerta a propósito. Si algún día vuelve el
    papel de tutor, vuelve esta línea.
  */
  ['seleccionador', 'seleccionador.florete@demo.local', ['/', '/tiradores', '/convocatorias']],
  ['espada', 'seleccionador.espada@demo.local', ['/', '/tiradores', '/convocatorias']],
  [
    'admin',
    'direccion.tecnica@demo.local',
    [
      '/',
      '/estado',
      '/convocatorias',
      '/ranking',
      '/tiradores',
      '/admin',
      '/admin/inscripciones',
      '/admin/usuarios',
      '/admin/ajustes',
      '/admin/normativa',
      '/admin/cuarentena',
      '/admin/emparejar',
      '/admin/extraccion',
      '/admin/salud',
      '/documentos',
      '/perfil',
      '/alta',
    ],
  ],
];

type Cookie = ReturnType<typeof aCookie>;

function aCookie(cabecera: string) {
  const par = cabecera.split(';')[0];
  const i = par.indexOf('=');
  return {
    name: par.slice(0, i).trim(),
    value: par.slice(i + 1),
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax' as const,
  };
}

async function sesion(email: string): Promise<Cookie[]> {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: CONTRASENA }),
  });
  const cookies = (r.headers.getSetCookie?.() ?? []).map(aCookie);
  if (cookies.length === 0) {
    throw new Error(`Sin sesión para ${email} (HTTP ${r.status}). Se aborta.`);
  }
  return cookies;
}

type Medida = {
  desborda: number;
  alto: number;
  cortados: string[];
  recortes: string[];
};

/**
 * La medida va como CADENA, no como función.
 *
 * `tsx` compila con esbuild y `keepNames`, que envuelve toda función con
 * nombre en un ayudante `__name` que no existe dentro del navegador: la
 * función se serializa, se inyecta y revienta con «__name is not defined».
 * Con el código en una plantilla no se compila nada y llega tal cual.
 */
const MEDIDA = `(() => {
  const recortadoAProposito = (e) => {
    if (/truncate|sr-only|line-clamp/.test(e.className.toString())) return true;
    const s = getComputedStyle(e);
    // 'text-overflow: ellipsis' y '-webkit-line-clamp' desde CSS valen igual
    // que la clase de utilidad: el recorte está declarado.
    if (s.textOverflow === 'ellipsis') return true;
    if (s.webkitLineClamp && s.webkitLineClamp !== 'none') return true;
    return false;
  };
  const perdonado = (e) => {
    for (let n = e.parentElement; n; n = n.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
      if (recortadoAProposito(n)) return true;
    }
    return false;
  };
  const cortados = [...document.querySelectorAll('*')]
    .filter(
      (e) =>
        e.children.length === 0 &&
        // Tiene que haber TEXTO para que haya texto cortado. Sin esto se
        // contaban casillas y campos, que desbordan por diseño.
        (e.textContent || '').trim().length > 0 &&
        e.scrollWidth > e.clientWidth + 1 &&
        !/auto|scroll/.test(getComputedStyle(e).overflowX) &&
        !recortadoAProposito(e) &&
        !perdonado(e),
    )
    .map((e) => {
      const t = (e.textContent || '').replace(/\\s+/g, ' ').trim();
      const cls = e.className.toString().split(/\\s+/).filter(Boolean).slice(0, 4).join('.');
      return '<' + e.tagName.toLowerCase() + (cls ? '.' + cls : '') + '> «' +
        t.slice(0, 40) + (t.length > 40 ? '…' : '') + '» ' +
        e.clientWidth + '/' + e.scrollWidth + 'px';
    });

  /**
   * Recortes declarados que se comen el rótulo.
   *
   * Un 'truncate' es legítimo, pero no cuando esconde la mitad: la queja
   * original del usuario era leer 'Liga Nacional Iberdrola ...' y no saber
   * cuál de las cinco jornadas era. Así que se mide aparte cuánto se pierde y
   * se avisa por encima del 40 %. No hace fallar el barrido —un recorte con
   * elipsis es una decisión, no un error—, pero sale en la salida para poder
   * juzgarlo con el número delante.
   */
  const recortes = [...document.querySelectorAll('*')]
    .filter(
      (e) =>
        e.children.length === 0 &&
        (e.textContent || '').trim().length > 0 &&
        recortadoAProposito(e) &&
        // 'sr-only' está fuera de pantalla a propósito: mide 1 px de ancho
        // porque no se ve, no porque se corte.
        !/sr-only/.test(e.className.toString()) &&
        e.clientWidth > 8 &&
        e.scrollWidth > e.clientWidth * 1.65,
    )
    .map((e) => {
      const t = (e.textContent || '').replace(/\\s+/g, ' ').trim();
      const perdido = Math.round((1 - e.clientWidth / e.scrollWidth) * 100);
      return '«' + t.slice(0, 44) + (t.length > 44 ? '…' : '') + '» -' + perdido + '%';
    });

  return {
    desborda: document.documentElement.scrollWidth - window.innerWidth,
    alto: document.documentElement.scrollHeight,
    cortados,
    recortes,
  };
})()`;

const navegador = await chromium.launch();
let problemas = 0;

for (const [papel, email, rutas] of PAPELES) {
  // Una sola entrada por papel: Neon Auth responde 429 si se pide sesión en
  // cada pantalla.
  const cookies = await sesion(email);

  for (const [pantalla, cfg] of [
    ['móvil', devices['iPhone 14 Pro']],
    ['escritorio', { viewport: { width: 1440, height: 900 } }],
  ] as const) {
    const ctx = await navegador.newContext({ ...cfg, locale: 'es-ES' });
    await ctx.addCookies(cookies);
    const p = await ctx.newPage();

    for (const ruta of rutas) {
      const errores: string[] = [];
      const onError = (e: Error) => errores.push(e.message);
      const onConsole = (m: { type(): string; text(): string }) => {
        if (m.type() === 'error') errores.push(m.text());
      };
      p.on('pageerror', onError);
      p.on('console', onConsole);

      const res = await p.goto(`${BASE}${ruta}`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      await p.waitForTimeout(350);

      const m = await p.evaluate<Medida>(MEDIDA);

      const enEntrar = new URL(p.url()).pathname.startsWith('/entrar');
      const estado = res?.status() ?? 0;
      const mal =
        enEntrar ||
        m.desborda > 0 ||
        estado >= 400 ||
        errores.length > 0 ||
        m.cortados.length > 0;
      if (mal) problemas += 1;

      console.log(
        `${mal ? '✗' : '·'} ${papel.padEnd(14)} ${pantalla.padEnd(11)} ` +
          `${ruta.padEnd(24)} ${estado} desborde ${String(m.desborda).padStart(3)}px ` +
          `alto ${String(m.alto).padStart(5)}px ` +
          `cortados ${String(m.cortados.length).padStart(2)} ` +
          `recortes ${String(m.recortes.length).padStart(2)}` +
          (enEntrar ? '  ⚠ ACABÓ EN /entrar' : '') +
          (m.cortados.length
            ? `\n${[...new Set(m.cortados)]
                .slice(0, 8)
                .map((t) => `    ✂ ${t}`)
                .join('\n')}`
            : '') +
          (m.recortes.length
            ? `\n${[...new Set(m.recortes)]
                .slice(0, 5)
                .map((t) => `    … ${t}`)
                .join('\n')}`
            : '') +
          (errores.length
            ? `\n    ${[...new Set(errores)].slice(0, 2).join(' | ').slice(0, 220)}`
            : ''),
      );

      p.off('pageerror', onError);
      p.off('console', onConsole);
    }

    await ctx.close();
  }
}

await navegador.close();
console.log(problemas === 0 ? '\nSin problemas.' : `\n${problemas} pantallas con algo.`);
if (problemas > 0) process.exitCode = 1;
