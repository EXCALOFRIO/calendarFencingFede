/**
 * Contraste real de los tokens del tema, medido en el navegador.
 *
 *   npm run contraste                         # tabla de los tokens actuales
 *   BARRIDO=1 npm run contraste               # además, barrido de luminosidad
 *   RUTA=/ranking npm run contraste           # en otra pantalla
 *
 * Por qué en el navegador y no a mano: el tema está escrito en `oklch()` y
 * `getComputedStyle` devuelve `oklch(...)` tal cual, así que una expresión
 * regular sobre `rgb(...)` no lee nada (y dice, en silencio, que todo está
 * bien). Aquí el color se pinta en un lienzo de 1×1 y se lee el píxel: la
 * conversión la hace el propio Chrome, que es la que ve el usuario.
 *
 * Por qué se leen los tokens y no números escritos aquí: si mañana alguien
 * sube `--fondo-luz` del 5 % al 20 %, esto tiene que enterarse. Las únicas
 * constantes de este fichero son las de la norma.
 *
 * WCAG 2.1 AA: 4,5:1 para texto normal y 3:1 para texto grande
 * (>= 24 px, o >= 18,66 px en negrita) y para elementos gráficos.
 *
 * Sale con código 1 si algo de texto o de relleno se queda por debajo de AA.
 */
import { chromium } from 'playwright';
import { autenticar, BASE_URL } from '../e2e/sesion.js';

const GUION = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const lz = document.createElement('canvas');
  lz.width = lz.height = 1;
  const ctx = lz.getContext('2d', { willReadFrequently: true });

  function aRgb(css) {
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
    const n = ctx.getImageData(0, 0, 1, 1).data;
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
    const b = ctx.getImageData(0, 0, 1, 1).data;
    const a = 1 - (b[0] - n[0]) / 255;
    if (a < 0.004) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: n[0] / a, g: n[1] / a, b: n[2] / a, a };
  }
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const mezclar = (f, b, a) => ({ r: f.r*a + b.r*(1-a), g: f.g*a + b.g*(1-a), b: f.b*a + b.b*(1-a), a: 1 });
  /** Apila una capa semitransparente sobre un fondo, con su propio alfa. */
  const encima = (capa, base) => mezclar(capa, base, capa.a);
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const tok = (n) => aRgb(cs.getPropertyValue(n).trim());
  /** El porcentaje de un token tipo \`--fondo-tinte-banda: 26%\`. */
  const pct = (n) => (parseFloat(cs.getPropertyValue(n)) || 0) / 100;

  const fondos = {
    background: tok('--background'),
    card: tok('--card'),
    secondary: tok('--secondary'),
    popover: tok('--popover'),
  };
  const blanco = tok('--foreground');
  const apagado = tok('--muted-foreground');

  const TEXTOS = ['--foreground', '--muted-foreground', '--primary', '--primary-text',
    '--gold', '--destructive', '--ok', '--warn', '--danger', '--off',
    '--org-rfee', '--org-fie', '--org-efc', '--org-aut',
    '--secondary-foreground', '--accent-foreground'];

  const tabla = [];
  for (const n of TEXTOS) {
    const c = tok(n);
    const fila = { token: n, hex: hex(c), vacio: c.a === 0 };
    for (const [nf, f] of Object.entries(fondos)) fila['sobre_' + nf] = ratio(c, f);
    tabla.push(fila);
  }

  // Pastillas (Badge): texto del token sobre un fondo del mismo token al 15 %
  // compuesto sobre la tarjeta, que es como están definidas en primitives.tsx.
  const pastillas = [];
  for (const [n, nTexto] of [['--primary', '--primary-text'], ['--gold', '--gold'],
       ['--ok', '--ok'], ['--warn', '--warn'], ['--danger', '--danger']]) {
    const c = tok(n);
    const t = tok(nTexto);
    for (const [nf, f] of [['card', fondos.card], ['background', fondos.background]]) {
      const relleno = mezclar(c, f, 0.15);
      pastillas.push({ token: n, texto: nTexto, sobre: nf, hexRelleno: hex(relleno),
        ratioTexto: ratio(t, relleno), ratioRellenoVsFondo: ratio(relleno, f) });
    }
  }

  // Texto sobre fondos sólidos (botones).
  const solidos = [
    { nombre: 'primary-foreground sobre primary (botón principal)', r: ratio(tok('--primary-foreground'), tok('--primary')) },
    { nombre: 'gold-foreground sobre gold (convocatoria)', r: ratio(tok('--gold-foreground'), tok('--gold')) },
    // El botón destructivo en oscuro es \`dark:bg-destructive/60\`, no el sólido.
    { nombre: 'blanco sobre destructive/60 en card (el real)', r: ratio({ r: 255, g: 255, b: 255, a: 1 }, mezclar(tok('--destructive'), fondos.card, 0.6)) },
    { nombre: 'blanco sobre destructive sólido (no se usa en oscuro)', r: ratio({ r: 255, g: 255, b: 255, a: 1 }, tok('--destructive')), informativo: true },
    { nombre: 'secondary-foreground sobre secondary', r: ratio(tok('--secondary-foreground'), tok('--secondary')) },
    { nombre: 'foreground sobre accent', r: ratio(blanco, tok('--accent')) },
    { nombre: 'primary como superficie frente al fondo (gráfico, 3:1)', r: ratio(tok('--primary'), fondos.background), min: 3 },
  ];

  /**
   * Organismos: la barra pequeña del calendario.
   *
   * Es el uso que el usuario vio mal —«los colores parecen estados
   * desactivados, no categorías»— así que se mide en ese uso concreto: el
   * texto de identidad sobre su superficie, y la superficie frente al fondo,
   * que es lo que decide si la barra se ve como un objeto o como una mancha.
   */
  const organismos = [];
  /** Distancia perceptual en OKLab: por debajo de 0,10 no se separan. */
  const aLab = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const [R, G, B] = [f(c.r), f(c.g), f(c.b)];
    const l = Math.cbrt(0.4122214708*R + 0.5363325363*G + 0.0514459929*B);
    const m = Math.cbrt(0.2119034982*R + 0.6806995451*G + 0.1073969566*B);
    const s = Math.cbrt(0.0883024619*R + 0.2817188376*G + 0.6299787005*B);
    return [0.2104542553*l + 0.793617785*m - 0.0040720468*s,
      1.9779984951*l - 2.428592205*m + 0.4505937099*s,
      0.0259040371*l + 0.7827717662*m - 0.808675766*s];
  };
  const dE = (a, b) => {
    const A = aLab(a), B = aLab(b);
    return Math.round(Math.hypot(A[0]-B[0], A[1]-B[1], A[2]-B[2]) * 1000) / 1000;
  };
  for (const n of ['rfee', 'fie', 'efc', 'aut']) {
    const id = tok('--org-' + n);
    const sup = tok('--org-' + n + '-relleno');
    organismos.push({
      org: n.toUpperCase(), hexId: hex(id), hexSup: hex(sup), sup,
      identidadSobreSup: ratio(id, sup),
      blancoSobreSup: ratio(blanco, sup),
      supVsFondo: ratio(sup, fondos.background),
      supVsCard: ratio(sup, fondos.card),
      idVsFondo: ratio(id, fondos.background),
      pastilla15: ratio(id, mezclar(id, fondos.card, 0.15)),
    });
  }
  const distancias = [];
  for (let i = 0; i < organismos.length; i += 1)
    for (let j = i + 1; j < organismos.length; j += 1)
      distancias.push({
        par: organismos[i].org + '-' + organismos[j].org,
        d: dE(organismos[i].sup, organismos[j].sup),
      });
  for (const o of organismos) delete o.sup;

  /**
   * La textura del fondo.
   *
   * El punto más claro posible del lienzo: la banda diagonal (\`--fondo-luz\`)
   * más la retícula más el grano, todas apiladas en el mismo píxel. Es el
   * peor caso para el texto que va encima, y es el número que hay que mirar
   * antes de decir que una textura no tapa nada.
   *
   * La retícula y el grano son SVG en \`data:\`, así que su alfa no está en un
   * token: se lee del propio \`background-image\` con una expresión regular.
   * Si el patrón cambia, el número cambia.
   */
  const capas = cs.getPropertyValue('background-image');
  // El \`(?<!stroke-)\` no es adorno: sin él, buscar \`opacity='…'\` encontraba
  // primero el \`stroke-opacity\` de la retícula y el grano salía con el alfa
  // de las cruces.
  const alfaSvg = (marca) => {
    const m = capas.match(new RegExp('(?<!stroke-)' + marca + "='?\\\\.([0-9]+)'?"));
    return m ? Number('0.' + m[1]) : 0;
  };
  const luz = tok('--fondo-luz');
  const luzSuave = tok('--fondo-luz-suave');
  const aReticula = alfaSvg('stroke-opacity');
  const aGrano = alfaSvg('opacity');
  const blancoPuro = { r: 255, g: 255, b: 255, a: 1 };

  const pilaSobre = (base) => {
    let c = encima(luz, base);
    c = mezclar(blancoPuro, c, aReticula);
    c = mezclar(blancoPuro, c, aGrano);
    return c;
  };
  const texturas = [];
  for (const [nf, f] of [['background', fondos.background], ['card', fondos.card]]) {
    const claro = pilaSobre(f);
    texturas.push({
      sobre: nf, hex: hex(claro),
      capaVsBase: ratio(claro, f),
      blancoEncima: ratio(blanco, claro),
      apagadoEncima: ratio(apagado, claro),
    });
  }

  /**
   * Los tintes de \`.fondo-cabecera\`.
   *
   * Se aplica la clase de verdad a un elemento suelto y se leen sus
   * variables, en vez de fiarse de lo que dice el comentario del CSS. El
   * peor caso es la banda y el velo apilados en el mismo sitio, y el texto
   * que peor lo pasa encima es el apagado, no el blanco.
   */
  const tintes = [];
  // La probeta se pinta fuera de pantalla, no con \`display: none\`: Chrome
  // devuelve \`backdrop-filter: none\` en un elemento que no se renderiza, y
  // entonces el guion decía que el acrílico no tiene desenfoque.
  const probeta = document.createElement('div');
  probeta.style.cssText = 'position:fixed;top:-9999px;left:0;width:10px;height:10px';
  document.body.appendChild(probeta);
  for (const n of ['marca', 'rfee', 'fie', 'efc', 'aut', 'oro']) {
    probeta.className = 'fondo-cabecera tinte-' + n;
    const cs2 = getComputedStyle(probeta);
    const color = aRgb(cs2.getPropertyValue('--fondo-tinte').trim());
    const aBanda = (parseFloat(cs2.getPropertyValue('--fondo-tinte-banda')) || 0) / 100;
    const aVelo = (parseFloat(cs2.getPropertyValue('--fondo-tinte-velo')) || 0) / 100;
    const total = 1 - (1 - aBanda) * (1 - aVelo);
    // El apagado se lee de la clase, no de \`:root\`: cada tinte sube el suyo
    // justamente porque el de la raíz no aguanta encima de una cabecera.
    const apagadoAqui = aRgb(cs2.getPropertyValue('--muted-foreground').trim());
    for (const [nf, f] of [['card', fondos.card], ['background', fondos.background]]) {
      let s = mezclar(color, f, total);
      s = pilaSobre(s);
      tintes.push({ tinte: n, sobre: nf, alfa: Math.round(total * 100), hex: hex(s),
        blancoEncima: ratio(blanco, s), apagadoEncima: ratio(apagadoAqui, s),
        apagadoRaizEncima: ratio(apagado, s) });
    }
  }

  /**
   * El acrílico.
   *
   * El fondo efectivo de un panel acrílico depende de la foto que hay
   * detrás, que no se sabe. Así que se acota por los dos extremos: una foto
   * blanca (el peor caso, aclara la lámina) y una negra. Lo que tiene que
   * aguantar AA es el caso claro.
   */
  probeta.className = 'acrilico';
  const csA = getComputedStyle(probeta);
  const tinteAcrilico = aRgb(csA.backgroundColor);
  const apagadoAcrilico = aRgb(csA.getPropertyValue('--muted-foreground').trim());
  const acrilico = [];
  for (const [nf, foto] of [
    ['foto blanca', { r: 255, g: 255, b: 255, a: 1 }],
    ['foto media', { r: 128, g: 128, b: 128, a: 1 }],
    ['foto negra', { r: 0, g: 0, b: 0, a: 1 }],
    ['fondo plano', fondos.background],
  ]) {
    let s = encima(tinteAcrilico, foto);
    s = mezclar(blancoPuro, s, aGrano);
    acrilico.push({ sobre: nf, hex: hex(s), alfa: Math.round(tinteAcrilico.a * 100),
      blancoEncima: ratio(blanco, s), apagadoEncima: ratio(apagadoAcrilico, s),
      apagadoRaizEncima: ratio(apagado, s), rojoTextoEncima: ratio(tok('--primary-text'), s),
      desenfoque: csA.backdropFilter });
  }
  probeta.remove();

  // Bordes y separadores: 3:1 frente al fondo adyacente (WCAG 1.4.11).
  const bordes = [
    { nombre: '--border sobre card', r: ratio(encima(tok('--border'), fondos.card), fondos.card) },
    { nombre: '--input sobre background', r: ratio(encima(tok('--input'), fondos.background), fondos.background) },
    { nombre: '--filete sobre card', r: ratio(encima(tok('--filete'), fondos.card), fondos.card) },
    { nombre: '--ring sobre background', r: ratio(tok('--ring'), fondos.background) },
  ];

  /**
   * EL CONTROL MARCADO.
   *
   * Se mide en su uso real, que son tres cosas a la vez: el rótulo rojo
   * encima de la superficie teñida, el contorno contra lo que tenga al lado
   * —que es lo que de verdad hace visible el marcado— y la distancia al
   * relleno de la acción principal, porque si esa distancia se cierra vuelve
   * el fallo que el usuario cazó en la fila de filtros: la misma señal para
   * «esto está puesto» y para «esto hace algo».
   */
  const marcado = tok('--marcado');
  const rojoTexto = tok('--primary-text');
  const controlMarcado = {
    hex: hex(marcado),
    rojoSobreMarcado: ratio(rojoTexto, marcado),
    blancoSobreMarcado: ratio(blanco, marcado),
    apagadoSobreMarcado: ratio(apagado, marcado),
    bordeVsLienzo: ratio(rojoTexto, fondos.background),
    bordeVsCard: ratio(rojoTexto, fondos.card),
    bordeVsPopover: ratio(rojoTexto, fondos.popover),
    bordeVsMarcado: ratio(rojoTexto, marcado),
    // Lo que sustituye: el borde de un control sin marcar.
    bordeSinMarcarVsLienzo: ratio(encima(tok('--input'), fondos.background), fondos.background),
    // Superficie marcada contra la del control sin marcar, en sus tres sitios.
    marcadoVsLienzo: dE(marcado, fondos.background),
    marcadoVsSecondary: dE(marcado, fondos.secondary),
    marcadoVsAccent: dE(marcado, tok('--accent')),
    marcadoVsPopover: dE(marcado, fondos.popover),
    // Y la que no se puede cerrar nunca.
    marcadoVsPrimary: dE(marcado, tok('--primary')),
  };

  // Aviso de datos rancios de la cabecera: warn al 10 % sobre el fondo.
  const w = tok('--warn');
  const avisoRancio = ratio(w, mezclar(w, fondos.background, 0.1));

  const salida = {
    fondos: Object.fromEntries(Object.entries(fondos).map(([k, v]) => [k, hex(v)])),
    alfas: { luz: Math.round(luz.a * 1000) / 10, luzSuave: Math.round(luzSuave.a * 1000) / 10,
      reticula: aReticula * 100, grano: aGrano * 100 },
    tabla, pastillas, solidos, organismos, distancias, texturas, tintes, acrilico,
    bordes, avisoRancio, controlMarcado,
  };

  if (${process.env.BARRIDO ? 'true' : 'false'}) {
    const barrido = {};
    for (const [nombre, base] of [['rojoBandera', [0.208, 25.8]], ['danger', [0.22, 22]], ['ok', [0.17, 152]], ['warn', [0.15, 78]], ['gold', [0.148, 84]], ['azulFie', [0.145, 252]], ['cianEfc', [0.115, 205]], ['gris', [0.01, 265]]]) {
      barrido[nombre] = [];
      for (let L = 0.28; L <= 0.9; L += 0.03) {
        const l = Math.round(L * 100) / 100;
        const c = aRgb('oklch(' + l + ' ' + base[0] + ' ' + base[1] + ')');
        barrido[nombre].push({
          L: l, hex: hex(c),
          textoSobreCard: ratio(c, fondos.card),
          textoSobreFondo: ratio(c, fondos.background),
          pastilla15SobreCard: ratio(c, mezclar(c, fondos.card, 0.15)),
          blancoEncima: ratio(blanco, c),
          supVsFondo: ratio(c, fondos.background),
        });
      }
    }
    salida.barrido = barrido;
  }

  return salida;
})()`;

/**
 * Dónde se mide, y por qué ya no hace falta sesión.
 *
 * Los tokens viven en `:root` y la hoja de estilos es la misma en todas las
 * pantallas, así que para medir el tema vale cualquiera; se usa `/entrar`,
 * que es la única que no pide sesión. Antes esto entraba como administrador,
 * y eso metía una consulta a Neon en el camino de una medida que es puro
 * CSS: el día que la base tarda, el guion no dice «no he podido medir», dice
 * un error de Drizzle de cuarenta líneas. Con `SESION=1` se puede seguir
 * midiendo una pantalla de dentro.
 *
 * Y se espera a que la hoja esté aplicada, que no es lo mismo que que la
 * página haya cargado. Esto costó una tarde: con
 * `waitUntil: 'domcontentloaded'` Turbopack todavía no ha metido el CSS, así
 * que `getPropertyValue('--background')` devuelve cadena vacía, el lienzo de
 * 1×1 no pinta nada y **el guion informaba de 1:1 en todo**. La versión
 * anterior tenía escrito en un comentario que «en /entrar el :root sólo trae
 * --gold»: era mentira, era esta carrera. Un guion de validación que falla
 * en silencio es peor que no tenerlo, así que ahora espera y, si no llega,
 * revienta.
 */
const RUTA = process.env.RUTA ?? (process.env.SESION ? '/' : '/entrar');
const browser = await chromium.launch();
const context = await browser.newContext({ locale: 'es-ES' });
if (process.env.SESION) await autenticar(context, 'admin', 'admin');
const page = await context.newPage();
await page.goto(`${BASE_URL}${RUTA}`, { waitUntil: 'networkidle', timeout: 90_000 });
await page
  .waitForFunction(
    () =>
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim() !== '',
    null,
    { timeout: 30_000 },
  )
  .catch(() => {
    throw new Error(
      `En ${RUTA} el tema no llegó a aplicarse (--background sale vacío). ` +
        'Sin tokens no hay nada que medir: se aborta en vez de decir que todo falla.',
    );
  });
const r = (await page.evaluate(GUION)) as any;
await browser.close();

/**
 * La rama degenerada: si no se pudo medir, no se da resultado.
 *
 * Si los tokens no resuelven, todo sale negro y todas las razones valen 1:
 * salen setenta «fallos» que no son fallos, son una medición que no ocurrió.
 * Confundir «no he podido medir» con «has fallado» es peor que no medir, así
 * que aquí se sale con código 2 y sin tabla.
 */
if (r.fondos.background === '#000000' && r.fondos.card === '#000000') {
  console.error(
    `NO SE PUDO MEDIR en ${RUTA}: los tokens de \`:root\` no resuelven (todo sale\n` +
      'negro y toda razón sale 1). No es que el tema falle, es que no se ha leído.\n' +
      'Comprueba que `npm run dev` está levantado y prueba con RUTA=… o SESION=1.',
  );
  process.exit(2);
}

/** Cuenta de fallos que importan: texto y rellenos. Los bordes van aparte. */
let fallos = 0;
const ok = (v: number, min: number) => {
  if (v >= min) return 'AA';
  fallos += 1;
  return 'FALLA';
};
const suave = (v: number, min: number) => (v >= min ? 'AA' : 'FALLA');

console.log('Fondos:', r.fondos);
console.log(
  'Capas de la textura (opacidad %):',
  `luz ${r.alfas.luz}  luz-suave ${r.alfas.luzSuave}  retícula ${r.alfas.reticula}  grano ${r.alfas.grano}\n`,
);

console.log('— Texto sobre fondo (AA normal 4,5 / AA grande 3,0) —');
console.log(
  ['token'.padEnd(24), 'hex'.padEnd(9), 'bg'.padEnd(7), 'card'.padEnd(7), 'secondary'.padEnd(10), 'veredicto(card)'].join(''),
);
for (const f of r.tabla) {
  if (f.vacio) {
    console.log(`${f.token.padEnd(24)} ¡NO EXISTE ESE TOKEN!`);
    fallos += 1;
    continue;
  }
  // `--primary` es un relleno, no un texto: como texto se usa `--primary-text`.
  const soloGrande = f.token === '--primary';
  console.log(
    [
      f.token.padEnd(24),
      f.hex.padEnd(9),
      String(f.sobre_background).padEnd(7),
      String(f.sobre_card).padEnd(7),
      String(f.sobre_secondary).padEnd(10),
      soloGrande
        ? `${suave(f.sobre_card, 3)} grande · es relleno, como texto va --primary-text`
        : `${ok(f.sobre_card, 4.5)} normal / ${suave(f.sobre_card, 3)} grande`,
    ].join(''),
  );
}

console.log('\n— Pastillas (texto sobre relleno del mismo token al 15 %) —');
for (const p of r.pastillas) {
  console.log(
    `${p.token.padEnd(12)} texto ${p.texto.padEnd(14)} sobre ${p.sobre.padEnd(11)} relleno ${p.hexRelleno}` +
      `  texto ${String(p.ratioTexto).padEnd(6)} ${ok(p.ratioTexto, 4.5)}   relleno/fondo ${p.ratioRellenoVsFondo}`,
  );
}

console.log('\n— Texto sobre relleno sólido —');
for (const s of r.solidos) {
  const min = s.min ?? 4.5;
  console.log(
    `${s.nombre.padEnd(56)} ${String(s.r).padEnd(7)} ${s.informativo ? `${suave(s.r, min)} (informativo)` : ok(s.r, min)}`,
  );
}

console.log('\n— Organismos: la barra sólida del calendario —');
console.log('org   identidad  relleno    blanco/relleno  relleno/fondo  id/fondo  pastilla15  identidad/relleno');
for (const o of r.organismos) {
  console.log(
    `${o.org.padEnd(5)} ${o.hexId.padEnd(10)} ${o.hexSup.padEnd(10)} ` +
      `${String(o.blancoSobreSup).padEnd(6)} ${ok(o.blancoSobreSup, 4.5).padEnd(8)} ` +
      `${String(o.supVsFondo).padEnd(14)} ${String(o.idVsFondo).padEnd(9)} ` +
      `${String(o.pastilla15).padEnd(6)} ${ok(o.pastilla15, 4.5).padEnd(5)} ` +
      `${String(o.identidadSobreSup).padEnd(5)} ${suave(o.identidadSobreSup, 4.5)} (informativo: encima va blanco)`,
  );
}
console.log('  distancia perceptual entre rellenos (OKLab; por debajo de 0,10 no se separan):');
const peorDistancia = Math.min(...r.distancias.map((d: { d: number }) => d.d));
console.log(
  '  ' + r.distancias.map((d: { par: string; d: number }) => `${d.par} ${d.d}`).join('   ') +
    `\n  el par peor es ${peorDistancia} ${peorDistancia >= 0.1 ? '— se separan' : '— NO SE SEPARAN, hay que rehacer la paleta'}`,
);
if (peorDistancia < 0.1) fallos += 1;

console.log('\n— La textura: el punto más claro del lienzo con todas las capas apiladas —');
for (const t of r.texturas) {
  console.log(
    `sobre ${t.sobre.padEnd(11)} ${t.hex}  capa/base ${String(t.capaVsBase).padEnd(6)}` +
      `  texto blanco ${String(t.blancoEncima).padEnd(7)} ${ok(t.blancoEncima, 4.5)}` +
      `  texto apagado ${String(t.apagadoEncima).padEnd(6)} ${ok(t.apagadoEncima, 4.5)}`,
  );
}

console.log('\n— Tintes de .fondo-cabecera (banda y velo apilados, con la textura encima) —');
for (const t of r.tintes) {
  console.log(
    `tinte-${t.tinte.padEnd(6)} sobre ${t.sobre.padEnd(11)} alfa ${String(t.alfa).padStart(2)}%  ${t.hex}` +
      `  blanco ${String(t.blancoEncima).padEnd(7)} ${ok(t.blancoEncima, 4.5)}` +
      `  apagado ${String(t.apagadoEncima).padEnd(6)} ${ok(t.apagadoEncima, 4.5)}` +
      `  (con el apagado de :root sería ${t.apagadoRaizEncima})`,
  );
}

console.log('\n— Acrílico (.acrilico): el fondo efectivo depende de la foto de detrás —');
console.log(`  desenfoque: ${r.acrilico[0].desenfoque}  ·  tinte: ${r.acrilico[0].alfa} % de --card`);
for (const a of r.acrilico) {
  console.log(
    `sobre ${a.sobre.padEnd(12)} ${a.hex}  blanco ${String(a.blancoEncima).padEnd(7)} ${ok(a.blancoEncima, 4.5)}` +
      `  apagado ${String(a.apagadoEncima).padEnd(6)} ${ok(a.apagadoEncima, 4.5)}` +
      `  (con el de :root ${String(a.apagadoRaizEncima).padEnd(5)})` +
      `  rojo como texto ${String(a.rojoTextoEncima).padEnd(5)} ${suave(a.rojoTextoEncima, 4.5)}`,
  );
}
console.log(
  '  El rojo como texto encima del acrílico no llega a AA sobre una foto clara:\n' +
    '  ahí va de relleno (`bg-primary` con texto blanco), no de letra.',
);

/**
 * Bordes: se informan, no se suspenden.
 *
 * Y esto no es indulgencia, es lo que dice la norma. WCAG 1.4.11 pide 3:1
 * para «información visual necesaria para identificar un componente», y
 * `--border` y `--filete` son el filete de luz de `UI.md`: separan bandas,
 * no delimitan controles. `--input` sí bordea campos, pero el campo lleva
 * además relleno propio (`bg-input/30`) y etiqueta visible, así que el borde
 * no es la única señal.
 *
 * Se marcan como esperados porque un guion que grita no lo ejecuta nadie: si
 * salen cuatro fallos permanentes que no se van a arreglar, el día que
 * aparezca un fallo de verdad nadie lo va a ver. El número sigue impreso, y
 * el que quiera subirlos tiene aquí lo que cuesta.
 */
console.log('\n— Bordes y foco (informativo, ver la nota) —');
for (const b of r.bordes) {
  console.log(
    `${b.nombre.padEnd(30)} ${String(b.r).padEnd(7)} ${b.r >= 3 ? '3:1 ✓' : 'por debajo de 3:1, esperado'}`,
  );
}
console.log(
  '  Nota: `--border` y `--filete` son decoración estructural (el filete de luz\n' +
    '  de `UI.md`), no el límite de un control, así que 1.4.11 no les aplica.\n' +
    '  `--input` sí bordea campos, pero el campo además lleva relleno propio y\n' +
    '  etiqueta visible. Para que `--input` llegase a 3:1 haría falta blanco al\n' +
    '  36 %, y eso cambia el aspecto de todos los formularios: es una decisión de\n' +
    '  diseño con el usuario, no un arreglo, y no se toma en este guion.',
);

/**
 * El control marcado.
 *
 * Tres medidas y cada una responde a una pregunta distinta:
 *
 *  - ¿se lee el rótulo? El rojo encima del tinte tiene que pasar AA normal.
 *  - ¿se ve el contorno? WCAG 1.4.11 pide 3:1 para el canto de un control, y
 *    aquí sí aplica: el borde **es** la señal de que está marcado, no
 *    decoración. Se imprime al lado el borde de un control sin marcar para
 *    ver el salto.
 *  - ¿se distingue de la acción principal? La distancia OKLab a `--primary`
 *    no puede bajar de 0,15 o vuelve el fallo original: la misma señal para
 *    «puesto» y para «esto hace algo».
 */
const m = r.controlMarcado;
console.log('\n— El control marcado (contorno rojo + superficie teñida + rótulo rojo) —');
console.log(`superficie --marcado                 ${m.hex}`);
console.log(
  `rótulo --primary-text encima         ${String(m.rojoSobreMarcado).padEnd(7)} ${ok(m.rojoSobreMarcado, 4.5)} normal`,
);
console.log(
  `blanco encima (rótulo alternativo)   ${String(m.blancoSobreMarcado).padEnd(7)} ${ok(m.blancoSobreMarcado, 4.5)} normal`,
);
console.log(
  `apagado encima                       ${String(m.apagadoSobreMarcado).padEnd(7)} ${ok(m.apagadoSobreMarcado, 4.5)} normal`,
);
for (const [donde, v] of [
  ['lienzo', m.bordeVsLienzo],
  ['card', m.bordeVsCard],
  ['popover', m.bordeVsPopover],
  ['su propia superficie', m.bordeVsMarcado],
] as [string, number][]) {
  console.log(
    `contorno --primary-text vs ${donde.padEnd(21)} ${String(v).padEnd(7)} ${ok(v, 3)} (1.4.11, 3:1)`,
  );
}
console.log(
  `  para comparar, el borde de un control SIN marcar sobre el lienzo: ${m.bordeSinMarcarVsLienzo}` +
    `  (× ${Math.round((m.bordeVsLienzo / m.bordeSinMarcarVsLienzo) * 10) / 10} de salto)`,
);
console.log(
  '  distancia perceptual de la superficie marcada (OKLab):\n' +
    `    vs lienzo ${m.marcadoVsLienzo}   vs secondary ${m.marcadoVsSecondary}   ` +
    `vs accent ${m.marcadoVsAccent}   vs popover ${m.marcadoVsPopover}`,
);
console.log(
  `    vs --primary (el relleno de la acción) ${m.marcadoVsPrimary} ` +
    `${m.marcadoVsPrimary >= 0.15 ? '— no se confunden' : '— DEMASIADO CERCA, el marcado compite con la acción'}`,
);
if (m.marcadoVsPrimary < 0.15) fallos += 1;

console.log(`\nAviso de datos rancios (warn sobre warn/10 % sobre fondo): ${r.avisoRancio} ${ok(r.avisoRancio, 4.5)}`);

if (r.barrido) {
  console.log('\n— Barrido de luminosidad oklch —');
  for (const [nombre, filas] of Object.entries(r.barrido as Record<string, any[]>)) {
    console.log(`\n  ${nombre}`);
    console.log('   L     hex      card   fondo  pastilla15  blancoEncima  sup/fondo');
    for (const f of filas) {
      console.log(
        `   ${String(f.L).padEnd(6)}${f.hex.padEnd(9)}${String(f.textoSobreCard).padEnd(7)}${String(f.textoSobreFondo).padEnd(7)}${String(f.pastilla15SobreCard).padEnd(12)}${String(f.blancoEncima).padEnd(14)}${f.supVsFondo}`,
      );
    }
  }
}

if (fallos > 0) {
  console.log(`\n${fallos} medidas por debajo de AA.`);
  process.exitCode = 1;
} else {
  console.log('\nSin nada por debajo de AA.');
}
