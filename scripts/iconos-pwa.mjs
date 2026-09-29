/**
 * Los iconos que pide Android para poder instalar la aplicación.
 *
 *   node scripts/iconos-pwa.mjs
 *
 * Chrome exige en el manifiesto un icono de 192 y otro de 512. Los que hay
 * —`icon.png` de 96 y `apple-icon.png` de 180— los usan la pestaña y iOS, y
 * no valen: Chrome no escala hacia arriba, simplemente no ofrece instalar.
 *
 * Se rasterizan desde `src/app/icon.svg`, que es el original vectorial, y no
 * desde el PNG de 96: ampliar un mapa de bits da un icono borroso en la
 * pantalla de inicio, que es justo donde más se mira.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ HAY UNA VERSIÓN `maskable` Y ES DISTINTA
 * ---------------------------------------------------------------------------
 * Android recorta los iconos de la pantalla de inicio con la forma que tenga
 * el lanzador: círculo, cuadrado redondeado, gota. Un icono normal metido en
 * un círculo pierde las esquinas — y las nuestras son el propio cuadrado rojo
 * de la marca. La especificación reserva para eso un «área segura» que es un
 * círculo del 80 % del lienzo: todo lo que importa tiene que caber ahí.
 *
 * Así que el maskable no es el mismo fichero con otra etiqueta: es el dibujo
 * **al 78 %** sobre un fondo rojo a sangre. Recortado de cualquier manera,
 * sigue viéndose el sable entero sobre rojo.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const ORIGEN = 'src/app/icon.svg';
const DESTINO = 'public/iconos';

/** El rojo del cuadrado de la marca, el mismo del SVG. */
const ROJO = '#c60c1e';

/*
  Se le quitan los comentarios antes de rasterizar.

  El de `icon.svg` menciona `--primary`, y un comentario XML **no puede
  contener dos guiones seguidos**. Los navegadores lo perdonan y por eso el
  icono se ve bien en la pestaña; librsvg, que es quien rasteriza aquí, no:
  «Comment must not contain '--' (double-hyphen)». Antes que recortar un
  comentario útil del original, se limpia la copia que entra al conversor.
*/
const svg = Buffer.from(
  (await readFile(ORIGEN, 'utf8')).replace(/<!--[\s\S]*?-->/g, ''),
);
await mkdir(DESTINO, { recursive: true });

const hechos = [];

for (const lado of [192, 512]) {
  const salida = `${DESTINO}/icono-${lado}.png`;
  await sharp(svg, { density: 384 }).resize(lado, lado).png().toFile(salida);
  hechos.push(salida);

  /*
    El maskable: el dibujo al 78 % centrado sobre rojo a sangre. El 78 % y no
    el 80 exacto para dejar un par de píxeles de holgura al redondeo.
  */
  const dentro = Math.round(lado * 0.78);
  const margen = Math.round((lado - dentro) / 2);
  const dibujo = await sharp(svg, { density: 384 }).resize(dentro, dentro).png().toBuffer();

  const salidaMask = `${DESTINO}/icono-${lado}-maskable.png`;
  await sharp({
    create: {
      width: lado,
      height: lado,
      channels: 4,
      background: ROJO,
    },
  })
    .composite([{ input: dibujo, top: margen, left: margen }])
    .png()
    .toFile(salidaMask);
  hechos.push(salidaMask);
}

for (const f of hechos) {
  const { size } = await sharp(f).metadata().then(async (m) => ({
    size: (await readFile(f)).length,
    ...m,
  }));
  console.log(`${f.padEnd(40)} ${(size / 1024).toFixed(1)} kB`);
}
