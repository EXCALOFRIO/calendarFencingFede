import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * Copia a `public/banderas/` los SVG de bandera que la aplicación puede pintar.
 *
 *   node scripts/banderas.mjs
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EN EL REPOSITORIO Y NO DE UN CDN
 * ---------------------------------------------------------------------------
 * Lo dejó escrito `src/components/bandera.tsx` antes de que existieran: el
 * emoji de bandera **no se pinta en Windows** (Segoe UI Emoji no trae los
 * pares de indicadores regionales, así que se leen dos letras sueltas), y un
 * sprite de un CDN es una petición a un tercero por cada fila de un ranking de
 * mil. La única alternativa buena era guardarlas, y se puede: **las banderas
 * nacionales son de dominio público** —al revés que los escudos de la FIE y la
 * RFEE, que se enlazan a su origen y no se copian nunca.
 *
 * Salen de `flag-icons` (MIT), que trae 271. Se copian TODAS las que pueda
 * necesitar la aplicación en vez de solo las 136 del ranking de hoy: la lista
 * de países cambia cada temporada y una bandera que falta es un hueco en una
 * tabla. Pesan ~2,4 MB en total y **las sirve la red de Cloudflare desde
 * `public/`, sin tocar el Worker**; el navegador solo pide las que ve.
 *
 * Se ejecuta a mano, no en cada compilación: `flag-icons` es una dependencia
 * de desarrollo y los ficheros resultantes están versionados, así que quien
 * clone el repositorio no necesita instalar nada.
 */
const ORIGEN = 'node_modules/flag-icons/flags/4x3';
const DESTINO = 'public/banderas';

mkdirSync(DESTINO, { recursive: true });

/**
 * ---------------------------------------------------------------------------
 * Y SE RASTERIZAN, QUE ES LO QUE LAS HACE USABLES EN UNA TABLA
 * ---------------------------------------------------------------------------
 * Los SVG originales pesan de forma muy desigual porque algunos llevan el
 * escudo dibujado vector a vector: la mediana son **0,7 kB** pero **España
 * pesa 79 kB, México 83 y Serbia 177**. En una pastilla de 16 px de ancho ese
 * detalle no se ve, y la de España sale en casi todas las filas de esta
 * aplicación.
 *
 * Así que se convierten a PNG de 48×36 —24 px de ancho a 2x, que es el doble
 * de lo que se pinta—, con lo que **todas pesan lo mismo y poco**. El SVG se
 * copia también: sirve para regenerar y para cualquier sitio donde algún día
 * haga falta una bandera grande.
 */
const { chromium } = await import('playwright');
const svgs = readdirSync(ORIGEN).filter((f) => f.endsWith('.svg'));
const navegador = await chromium.launch();
const ctx = await navegador.newContext({
  viewport: { width: 48, height: 36 },
  deviceScaleFactor: 1,
});
const pagina = await ctx.newPage();

let bytesSvg = 0;
let bytesPng = 0;
let mayor = ['', 0];
for (const f of svgs) {
  copyFileSync(`${ORIGEN}/${f}`, `${DESTINO}/${f}`);
  bytesSvg += statSync(`${DESTINO}/${f}`).size;

  const svg = readFileSync(`${ORIGEN}/${f}`, 'utf8');
  await pagina.setContent(
    '<!doctype html><html><body style="margin:0;width:48px;height:36px">' +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" ` +
      'width="48" height="36" style="display:block">' +
      '</body></html>',
  );
  const png = f.replace(/\.svg$/, '.png');
  await pagina.screenshot({ path: `${DESTINO}/${png}` });
  const b = statSync(`${DESTINO}/${png}`).size;
  bytesPng += b;
  if (b > mayor[1]) mayor = [png, b];
}
await navegador.close();

console.log(`${svgs.length} banderas · SVG ${(bytesSvg / 1024 / 1024).toFixed(1)} MB · PNG ${(bytesPng / 1024).toFixed(0)} kB`);
console.log(`el PNG más grande: ${mayor[0]} ${(mayor[1] / 1024).toFixed(1)} kB`);
