import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Banco de pruebas de la marca.
 *
 * Existe por lo mismo que el de los iconos de arma: aquí un 200 no dice nada
 * y a 48 px todo parece bien. La marca se pinta a los tamaños REALES a los
 * que vive —16 px en una pestaña, 28 px en la cabecera, 180 px en la pantalla
 * de inicio del móvil—, sobre el fondo real, sobre superficie, sobre fondo
 * claro y en monocromo por los dos lados.
 *
 *   node tests/ui/marca.mjs             → las tres capturas
 *   node tests/ui/marca.mjs --apple     → además regenera src/app/apple-icon.png
 *
 *   capturas/marca.png              lo que se publica, a todos los tamaños,
 *                                   en la cabecera de verdad y ENTRE PESTAÑAS
 *                                   DE APLICACIONES DE VERDAD, que es la
 *                                   prueba que decide.
 *   capturas/marca-1x.png           lo mismo sin retina. A 16 px el trazo mide
 *                                   1,3 px y en un 1x se puede caer; hay que
 *                                   mirar las dos.
 *   capturas/marca-pestanas.png     la prueba de fuego sola: la tira de
 *                                   pestañas a 1x y ampliada 5 veces sin
 *                                   suavizar. **Es la que decide.**
 *   capturas/marca-descartadas.png  las formas que ya se han probado y por qué
 *                                   no valen. **Mira esto ANTES de dibujar
 *                                   nada nuevo**: son treinta y tres rondas de
 *                                   capturas ya pagadas y lo que está escrito
 *                                   es en qué se convirtió cada idea al
 *                                   renderizarla, que nunca es lo que parecía
 *                                   sobre el papel. El detalle está en la
 *                                   cabecera de `src/components/marca.tsx`.
 *
 * Los trazos se sacan del componente con una expresión regular, no se copian:
 * si no, el banco acaba pintando una marca que ya no es la que se publica, y
 * sobre una imagen falsa es imposible decidir.
 */

const src = readFileSync('src/components/marca.tsx', 'utf8');

/** Saca del componente una constante de trazo, tal cual se publica. */
function trazo(nombre) {
  const i = src.indexOf(`const ${nombre} =`);
  if (i === -1) throw new Error(`No se encuentra ${nombre} en marca.tsx`);
  const j = src.indexOf(';', i);
  return src
    .slice(src.indexOf('=', i) + 1, j)
    .split('+')
    .map((t) => t.trim().replace(/^'|'$/g, ''))
    .join('');
}

const TEJA = trazo('TEJA');
const HOJA = trazo('HOJA');
const CUPULA = trazo('CUPULA');
const CANTO = trazo('CANTO');
const EMPUNADURA = trazo('EMPUNADURA');
const GIRO = trazo('GIRO');
const TRAZO = trazo('TRAZO');

/* Los tokens de `globals.css`, resueltos a hexadecimal. */
const FONDO = '#0e0f13'; // --background
const CARD = '#17191e'; // --card
const ROJO = '#c60c1e'; // --primary
const BLANCO = '#fcfcfc'; // --primary-foreground
const BORDE = 'oklch(1 0 0 / 9%)'; // --border

/**
 * La marca. `campo` y `tinta` se pasan sueltos para poder probar la inversión
 * y el monocromo sin tocar el componente; `recorte` a false la pinta a sangre,
 * que es como va el icono de la aplicación antes de que iOS le ponga su
 * máscara.
 */
const marca = (t, campo = ROJO, tinta = BLANCO, recorte = true) => `
  <svg viewBox="0 0 100 100" width="${t}" height="${t}" style="flex:none;display:block">
    <path d="${recorte ? TEJA : 'M0 0H100V100H0Z'}" fill="${campo}"/>
    <g transform="${GIRO}" fill="none" stroke="${tinta}" stroke-width="${TRAZO}"
       stroke-linejoin="round">
      <g stroke-linecap="round">
        <path d="${HOJA}"/><path d="${CUPULA}"/><path d="${CANTO}"/>
      </g>
      <path d="${EMPUNADURA}" stroke-linecap="butt"/>
    </g>
  </svg>`;

const TAM = [16, 20, 28, 32, 64, 180];

const fila = (rotulo, campo, tinta, fondo) => `
  <tr>
    <th style="text-align:right;font:600 12px Inter,system-ui;white-space:nowrap;padding-right:6px">${rotulo}</th>
    ${TAM.map(
      (t) =>
        `<td style="background:${fondo};padding:10px;vertical-align:middle">${marca(t, campo, tinta)}</td>`,
    ).join('')}
  </tr>`;

/** La cabecera de verdad: 28 px de caja al lado de la palabra. */
const cabecera = `
  <div style="display:flex;align-items:center;gap:10px;height:56px;padding:0 16px;
              border-bottom:1px solid ${BORDE};background:${FONDO};width:420px">
    ${marca(28)}
    <span style="font:600 15px/1 Inter,system-ui;letter-spacing:-.01em;color:#fafafa">Esgrima</span>
    <span style="margin-left:auto;font:400 12px Inter,system-ui;color:#a1a1aa">Calendario</span>
  </div>`;

/* ------------------------------------------------------------------------ */
/* La prueba de fuego: 16 px entre pestañas de aplicaciones de verdad.      */
/*                                                                          */
/* Los favicons se traen en vivo y no se guardan en el repositorio: son     */
/* marcas de terceros. Sin red salen recuadros grises y se dice en la       */
/* propia captura, para que nadie dé por buena una comparación que no se ha */
/* hecho.                                                                   */
/* ------------------------------------------------------------------------ */

const AJENAS = [
  ['mail.google.com', 'Bandeja de entrada (14)'],
  ['drive.google.com', 'Mi unidad'],
  ['fie.org', 'FIE · Tournaments'],
  ['esgrima.es', 'RFEE'],
  ['github.com', 'calendarioFedeEsgrima'],
  ['wikipedia.org', 'Esgrima — Wikipedia'],
  ['youtube.com', 'YouTube'],
];

/**
 * Se piden de uno en uno y con dos orígenes por dominio: el servicio de
 * Google y el `/favicon.ico` del sitio. En paralelo fallaba más de la mitad,
 * y una prueba de pestañas con huecos grises no prueba nada.
 */
async function favicon(dominio) {
  const fuentes = [
    `https://www.google.com/s2/favicons?domain=${dominio}&sz=64`,
    `https://${dominio}/favicon.ico`,
    `https://www.${dominio}/favicon.ico`,
  ];
  for (const url of fuentes) {
    for (let intento = 0; intento < 2; intento++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!r.ok) break;
        const b = Buffer.from(await r.arrayBuffer());
        if (b.byteLength < 64) break;
        return `data:${r.headers.get('content-type') ?? 'image/png'};base64,${b.toString('base64')}`;
      } catch {
        /* Se reintenta, y si no, se pasa al origen siguiente. */
      }
    }
  }
  return null;
}

const iconos = [];
for (const [d] of AJENAS) iconos.push(await favicon(d));
const conRed = iconos.filter(Boolean).length;

/** La nuestra va la cuarta, para que no se distinga por estar en un extremo. */
const pestanas = () => {
  const lista = AJENAS.map(([, t], i) => ({
    icono: iconos[i]
      ? `<img src="${iconos[i]}" width="16" height="16" style="flex:none;display:block">`
      : `<span style="width:16px;height:16px;background:#555;border-radius:3px;flex:none"></span>`,
    titulo: t,
  }));
  lista.splice(3, 0, { icono: marca(16), titulo: 'Calendario · Esgrima' });
  return `
  <div style="display:flex;gap:2px;align-items:flex-end;background:#1f1f23;padding:7px 8px 0;border-radius:9px 9px 0 0">
    ${lista
      .map(
        (p, i) => `
      <div style="display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;
                  width:${i === 3 ? 172 : 152}px;border-radius:8px 8px 0 0;
                  background:${i === 3 ? '#35353b' : '#2a2a2e'};
                  font:400 12px Inter,system-ui;color:#e4e4e7">
        ${p.icono}<span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${p.titulo}</span>
      </div>`,
      )
      .join('')}
  </div>`;
};

const rotulo = (t) =>
  `<p style="font:400 11px Inter,system-ui;opacity:.55;margin:22px 0 8px">${t}</p>`;

writeFileSync(
  'tests/ui/marca.html',
  `<!doctype html><meta charset="utf-8">
  <body style="background:${FONDO};color:#f5f5f6;font:13px Inter,system-ui;padding:26px">
    <table style="border-spacing:10px 8px;border-collapse:separate">
      <tr>
        <th></th>
        ${TAM.map((t) => `<th style="font:400 11px Inter,system-ui;opacity:.55">${t} px</th>`).join('')}
      </tr>
      ${fila('Sobre el fondo', ROJO, BLANCO, FONDO)}
      ${fila('Sobre superficie', ROJO, BLANCO, CARD)}
      ${fila('Sobre fondo claro', ROJO, BLANCO, '#f4f4f5')}
      ${fila('Monocromo claro', BLANCO, FONDO, FONDO)}
      ${fila('Monocromo oscuro', '#18181b', '#f4f4f5', '#f4f4f5')}
    </table>

    <div style="display:flex;gap:34px;margin-top:10px;align-items:flex-start">
      <div>
        ${rotulo('Cabecera, 28 px de caja')}
        ${cabecera}
      </div>
      <div>
        ${rotulo('Icono de la aplicación: 180 px a sangre, y como lo recorta iOS')}
        <div style="display:flex;gap:16px;align-items:flex-end">
          ${marca(180, ROJO, BLANCO, false)}
          <div style="width:180px;height:180px;border-radius:40px;overflow:hidden">
            ${marca(180, ROJO, BLANCO, false)}
          </div>
        </div>
      </div>
    </div>

    ${rotulo(
      `Prueba de fuego: 16 px entre pestañas de verdad (la nuestra es la 4.ª)${
        conRed === AJENAS.length
          ? ''
          : ` — ATENCIÓN: solo ${conRed} de ${AJENAS.length} favicons se han podido traer; los grises son huecos, no iconos`
      }`,
    )}
    ${pestanas()}
  </body>`,
);

/* ------------------------------------------------------------------------ */
/* Las descartadas. Dibujadas, no descritas: es lo único que sirve.         */
/* ------------------------------------------------------------------------ */

const G = (hijos, tinta = BLANCO, w = 8) =>
  `<g fill="none" stroke="${tinta}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${hijos}</g>`;
const campoRojo = `<path d="${TEJA}" fill="${ROJO}"/>`;

/** Perpendicular a una dirección: la guarda de las candidatas antiguas. */
function guardaEn(px, py, dx, dy, largo) {
  const n = Math.hypot(dx, dy);
  const [ux, uy] = [-dy / n, dx / n];
  const h = largo / 2;
  return `<line x1="${(px - ux * h).toFixed(1)}" y1="${(py - uy * h).toFixed(1)}"
                x2="${(px + ux * h).toFixed(1)}" y2="${(py + uy * h).toFixed(1)}"/>`;
}

const armaVieja = (dibujo, s, tx, ty, tinta = BLANCO) => `
  <g fill="none" stroke="${tinta}" stroke-width="${(8 / s).toFixed(3)}"
     stroke-linecap="round" stroke-linejoin="round"
     transform="rotate(45 50 50) translate(${tx} ${ty}) scale(${s})">${dibujo}</g>`;

const FLORETE_ICONO = `
  <line x1="50" y1="13" x2="50" y2="65"/>
  <path d="M 42 66 C 42 63.5 58 63.5 58 66"/>
  <line x1="41" y1="66" x2="59" y2="66"/>
  <line x1="50" y1="67" x2="50" y2="85"/>`;

const ESPADA_ICONO = `
  <line x1="50" y1="12" x2="50" y2="52"/>
  <path d="M 31 65 C 31 41 69 41 69 65"/>
  <ellipse cx="50" cy="67" rx="19" ry="4"/>
  <line x1="50" y1="71" x2="50" y2="87"/>`;

const DESCARTADAS = [
  {
    n: 9,
    en: 'una raya en una caja: no significa nada',
    svg: campoRojo + G('<line x1="22" y1="78" x2="78" y2="22"/>'),
  },
  {
    n: 12,
    en: 'una LETRA en un cuadrado redondeado. La que rechazó el usuario',
    svg:
      campoRojo +
      `<path transform="scale(4.1667)" fill="${BLANCO}"
         d="M5.9 4.4 H14.9 V7.6 H9.4 V10.4 H17.7 L20.9 11.7 L17.7 13 H9.4 V16.4 H14.9 V19.6 H5.9 Z"/>`,
  },
  {
    n: 13,
    en: 'un ASPA: no dice esgrima, dice cerrar',
    svg:
      campoRojo +
      G('<line x1="26" y1="26" x2="74" y2="74"/><line x1="74" y1="26" x2="26" y2="74"/>'),
  },
  {
    n: 14,
    en: 'un VISTO BUENO EN UNA CASILLA',
    svg: G(`<rect x="16" y="24" width="68" height="60" rx="10"/>
            <line x1="16" y1="42" x2="84" y2="42"/>
            <line x1="30" y1="74" x2="70" y2="52"/>
            ${guardaEn(34, 71.8, 40, -22, 22)}`),
  },
  {
    n: 15,
    en: 'el mismo visto bueno, y a 180 px una FIRMA sobre una raya',
    svg:
      campoRojo +
      G(`<line x1="22" y1="28" x2="78" y2="28"/>
         <line x1="26" y1="76" x2="76" y2="42"/>
         ${guardaEn(34, 70.6, 50, -34, 26)}`),
  },
  {
    n: 16,
    en: 'una CESTA CON ASA, o una sartén',
    svg: G(`<rect x="10" y="30" width="62" height="60" rx="10"/>
            <line x1="10" y1="48" x2="72" y2="48"/>
            <line x1="26" y1="80" x2="92" y2="16"/>
            ${guardaEn(32, 74.2, 66, -64, 24)}`),
  },
  {
    n: 17,
    en: 'una COMETA; en pequeño, el rombo de señal de peligro',
    svg: G(`<path d="M50 12 L88 50 L50 88 L12 50 Z"/>
            <line x1="34" y1="66" x2="70" y2="30"/>
            ${guardaEn(40, 60, 36, -36, 22)}`),
  },
  {
    n: 18,
    en: 'una BANDEJA CON TAPA, y a 28 px el hueco parece una grieta',
    svg:
      `<path fill-rule="evenodd" fill="${ROJO}" d="M0 34 H100 V78 A22 22 0 0 1 78 100 H22 A22 22 0 0 1 0 78 Z
         M0 22 A22 22 0 0 1 22 0 H78 A22 22 0 0 1 100 22 V26 H0 Z"/>` +
      armaVieja(FLORETE_ICONO, 1.5, -25, -12),
  },
  {
    n: 19,
    en: 'el icono de REJILLA DE APLICACIONES. Se lee a 16 px y no dice esgrima',
    svg:
      G(`<rect x="12" y="12" width="32" height="32" rx="7"/>
         <rect x="56" y="12" width="32" height="32" rx="7"/>
         <rect x="12" y="56" width="32" height="32" rx="7"/>`) +
      `<rect x="56" y="56" width="32" height="32" rx="7" fill="${BLANCO}"/>`,
  },
  {
    n: 20,
    en: 'un DOBLEZ, y a 32 px suciedad',
    svg:
      campoRojo +
      `<g stroke="${FONDO}" stroke-opacity=".28" stroke-width="3">
         <line x1="50" y1="0" x2="50" y2="100"/><line x1="0" y1="50" x2="100" y2="50"/></g>` +
      armaVieja(FLORETE_ICONO, 1.5, -25, -15),
  },
  {
    n: 21,
    en: 'PUNTOS DE CARGA, los «…» de «escribiendo»',
    svg:
      campoRojo +
      armaVieja(FLORETE_ICONO, 1.5, -25, -15) +
      `<g fill="${BLANCO}">${[20, 36, 52, 68, 84]
        .map((x) => `<circle cx="${x}" cy="92" r="3"/>`)
        .join('')}</g>`,
  },
  {
    n: 22,
    en: 'una ESPADA CON UN CUADRO SUELTO; en pequeño, un icono de enviar',
    svg:
      G(`<line x1="16" y1="84" x2="56" y2="44"/>${guardaEn(24, 76, 40, -40, 24)}`) +
      `<rect x="64" y="14" width="26" height="26" rx="6" fill="${BLANCO}"/>`,
  },
  {
    n: 23,
    en: 'un BOTÓN DE QUITAR (el menos)',
    svg: campoRojo + G('<line x1="22" y1="30" x2="78" y2="30"/>'),
  },
  {
    n: 24,
    en: 'un MORDISCO',
    svg: `<path fill-rule="evenodd" fill="${ROJO}"
            d="${TEJA} M50 -6 L74 30 L26 30 Z"/>`,
  },
  {
    n: 25,
    en: 'un DESCONCHÓN: parece un fallo de pintado',
    svg:
      `<path fill="${ROJO}" d="M0 0 H78 A22 22 0 0 1 100 22 V78 A22 22 0 0 1 78 100 H22 A22 22 0 0 1 0 78 Z"/>` +
      armaVieja(FLORETE_ICONO, 1.5, -25, -15),
  },
  {
    n: 26,
    en: 'una BATERÍA. Inconfundible',
    svg: G(`<rect x="8" y="32" width="84" height="36" rx="8"/>
            <line x1="50" y1="32" x2="50" y2="68"/>
            <line x1="30" y1="40" x2="30" y2="60"/>
            <line x1="70" y1="40" x2="70" y2="60"/>`),
  },
  {
    n: 27,
    en: 'un INTERRUPTOR de dos celdas',
    svg: G(`<rect x="8" y="30" width="84" height="40" rx="10"/>
            <line x1="50" y1="30" x2="50" y2="70"/>`),
  },
  {
    n: 28,
    en: 'una TIRITA',
    svg: `<g transform="rotate(-45 50 50)">${G(`<rect x="2" y="34" width="96" height="32" rx="9"/>
            <line x1="50" y1="34" x2="50" y2="66"/>`)}</g>`,
  },
  {
    n: 29,
    en: 'una CARRETERA',
    svg: G(`<path d="M36 24 H64 L90 82 H10 Z"/><line x1="50" y1="24" x2="50" y2="82"/>`),
  },
  {
    n: 30,
    en: 'un ASPA CAÍDA, y a 16 px un garabato',
    svg: G(`<line x1="8" y1="62" x2="92" y2="62"/>
            <line x1="24" y1="84" x2="84" y2="24"/>
            ${guardaEn(34, 74, 60, -60, 26)}`),
  },
  {
    n: 31,
    en: 'una «Q»: el aro en perspectiva girado 45° se cierra sobre sí mismo',
    svg: campoRojo + armaVieja(ESPADA_ICONO, 1.5, -25, -13),
  },
  {
    n: 32,
    en: 'un BASTÓN, o un anzuelo',
    svg: G(`<path d="M24 78 C 46 44 78 36 84 62"/>${guardaEn(24, 78, 22, -34, 26)}`),
  },
  {
    n: 33,
    en: 'una BARRA INCLINADA: el tachón del nº 10 otra vez',
    svg: campoRojo + armaVieja(FLORETE_ICONO, 2.1, -55, -28),
  },
  {
    n: '—',
    en: 'el florete en rojo SIN teja: elegante a 180 px y a 16 px un arañazo',
    svg: armaVieja(FLORETE_ICONO, 1.5, -25, -15, ROJO),
  },
];

const SIN_DIBUJO = [
  [1, 'Hoja en diagonal que se afina desde la guarda', 'un VISTO BUENO'],
  [2, 'La misma con la cazoleta de lente', 'un PÁJARO; en un escudo, una HOJA DE ÁRBOL'],
  [3, 'Arma horizontal, guarda alineada con los ejes', 'un BANDERÍN; con el puño, un AVIÓN'],
  [4, 'El saludo: arma vertical, cazoleta cerrada', 'un AVIÓN desde arriba; a 16 px una CRUZ'],
  [5, 'Hoja atravesando la cazoleta de frente', 'una SEÑAL DE PROHIBIDO'],
  [6, 'Cazoleta sola de perfil', 'una D'],
  [7, 'Careta de frente y de perfil', 'CAMPANA, BUZÓN y RADIADOR'],
  [8, 'Escudo con faja', 'heráldica genérica: cero esgrima'],
  [10, 'Hoja hasta el borde de la teja', 'un TACHÓN, como un fallo de pintado'],
  [11, 'Punta con afilado largo', 'una AGUJA, y el conjunto una flecha'],
];

const ficha = (d) => `
  <div style="width:196px">
    <div style="display:flex;gap:10px;align-items:flex-end;background:${FONDO};padding:10px;border-radius:8px">
      <svg viewBox="0 0 100 100" width="64" height="64" style="flex:none">${d.svg}</svg>
      <svg viewBox="0 0 100 100" width="28" height="28" style="flex:none">${d.svg}</svg>
      <svg viewBox="0 0 100 100" width="16" height="16" style="flex:none">${d.svg}</svg>
    </div>
    <p style="font:400 11px/1.35 Inter,system-ui;margin:6px 0 0;color:#a1a1aa">
      <b style="color:#e4e4e7">${d.n}.</b> se convirtió en ${d.en}
    </p>
  </div>`;

writeFileSync(
  'tests/ui/marca-descartadas.html',
  `<!doctype html><meta charset="utf-8">
  <body style="background:#08090c;color:#f5f5f6;font:13px Inter,system-ui;padding:26px;width:1180px">
    <h1 style="font:600 18px Inter,system-ui;margin:0 0 4px">Formas descartadas de la marca</h1>
    <p style="font:400 12px/1.5 Inter,system-ui;color:#a1a1aa;margin:0 0 6px;max-width:760px">
      Lo que está escrito no es la idea: es <b>en qué se convirtió al
      renderizarla</b>. Cada una son capturas ya pagadas. El por qué de la que
      se publica está en la cabecera de <code>src/components/marca.tsx</code>.
    </p>
    <p style="font:400 12px/1.5 Inter,system-ui;color:#a1a1aa;margin:0 0 18px;max-width:760px">
      Y el hallazgo de fondo: <b>la caja es el problema</b>. El rectángulo
      redondeado es la forma más sobrecargada de la iconografía —tarjeta, nota,
      ventana, imagen, batería, interruptor— y cruzarla con una diagonal da un
      visto bueno casi siempre.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:18px 14px">
      ${DESCARTADAS.map(ficha).join('')}
    </div>
    <h2 style="font:600 14px Inter,system-ui;margin:28px 0 8px">
      Y estas diez, de la ronda anterior, que no se han vuelto a dibujar
    </h2>
    <table style="border-spacing:0 4px;font:400 12px Inter,system-ui">
      ${SIN_DIBUJO.map(
        ([n, idea, en]) => `<tr>
          <td style="color:#e4e4e7;padding-right:10px;vertical-align:top"><b>${n}.</b></td>
          <td style="color:#e4e4e7;padding-right:10px">${idea}</td>
          <td style="color:#a1a1aa">→ ${en}</td>
        </tr>`,
      ).join('')}
    </table>
  </body>`,
);

/* ------------------------------------------------------------------------ */

const navegador = await chromium.launch();

for (const dpr of [2, 1]) {
  const pagina = await navegador.newPage({
    viewport: { width: 1320, height: 900 },
    deviceScaleFactor: dpr,
  });
  await pagina.goto(pathToFileURL('tests/ui/marca.html').href);
  await pagina.screenshot({
    path: dpr === 2 ? 'capturas/marca.png' : 'capturas/marca-1x.png',
    fullPage: true,
  });
  await pagina.close();
}

/*
 * La prueba de fuego, aislada y ampliada.
 *
 * Es la única captura que decide de verdad, y hay que verla dos veces: a 1x,
 * que son los píxeles que recibe el ojo, y ampliada sin suavizar, que es la
 * única forma de saber qué queda del dibujo cuando el trazo mide 1,3 px. Si
 * aquí la marca no se distingue de las de al lado, no vale, por bien que se
 * vea a 180 px.
 */
{
  const tira = await navegador.newPage({
    viewport: { width: 1300, height: 60 },
    deviceScaleFactor: 1,
  });
  const html = readFileSync('tests/ui/marca.html', 'utf8');
  await tira.setContent(
    `<body style="margin:0;background:#1f1f23;font:13px Inter,system-ui">
       ${html.slice(html.lastIndexOf('<div style="display:flex;gap:2px'))}
     </body>`,
  );
  const png = await tira.screenshot({ clip: { x: 0, y: 0, width: 1240, height: 44 } });
  await tira.close();

  /* 44 de la tira a tamaño real + 44 × 5 de la tira ampliada. */
  const zoom = await navegador.newPage({
    viewport: { width: 1240, height: 44 + 44 * 5 },
    deviceScaleFactor: 1,
  });
  await zoom.setContent(
    `<body style="margin:0;background:#08090c">
       <img src="data:image/png;base64,${png.toString('base64')}"
            style="width:1240px;display:block">
       <img src="data:image/png;base64,${png.toString('base64')}"
            style="width:6200px;margin-left:-2480px;image-rendering:pixelated;display:block">
     </body>`,
  );
  await zoom.screenshot({ path: 'capturas/marca-pestanas.png' });
  await zoom.close();
}

const descartes = await navegador.newPage({
  viewport: { width: 1240, height: 900 },
  deviceScaleFactor: 2,
});
await descartes.goto(pathToFileURL('tests/ui/marca-descartadas.html').href);
await descartes.screenshot({ path: 'capturas/marca-descartadas.png', fullPage: true });
await descartes.close();

/*
 * El icono de iOS.
 *
 * Va **a sangre y sin redondear**: los 180 px los recorta iOS con su propia
 * máscara, y si la teja ya viniera redondeada se verían dos redondeos, uno
 * dentro del otro, con las esquinas transparentes entre medias. Sale de aquí
 * y no de un editor para que no se pueda desincronizar del componente.
 */
if (process.argv.includes('--apple')) {
  const apple = await navegador.newPage({
    viewport: { width: 180, height: 180 },
    deviceScaleFactor: 1,
  });
  await apple.setContent(
    `<body style="margin:0;line-height:0">${marca(180, ROJO, BLANCO, false)}</body>`,
  );
  await apple.screenshot({ path: 'src/app/apple-icon.png' });
  await apple.close();
  console.log('src/app/apple-icon.png');
}

await navegador.close();

console.log('capturas/marca.png');
console.log('capturas/marca-1x.png');
console.log('capturas/marca-pestanas.png');
console.log('capturas/marca-descartadas.png');
if (conRed < AJENAS.length) {
  console.log(
    `AVISO: solo ${conRed} de ${AJENAS.length} favicons ajenos; la prueba de las pestañas está incompleta.`,
  );
}
