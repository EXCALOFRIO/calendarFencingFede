import { AcumuladorAsaltos, exclusionesVacias } from './asaltos';
import { agruparValores, compatibles, normalizar, redondear } from './geometria';
import { resolverParticipante, type Atribucion, type Participante } from './identidad';
import { esItemRonda, type PaginaAnalizada } from './paginas';
import type { AsaltoPdf, ExclusionesPdf, ItemTexto, Rechazo, Region } from './tipos';

/**
 * Cuadro de eliminación directa de un PDF de Engarde.
 *
 * La primera columna lista a los tiradores (puesto de siembra, nombre, club).
 * Cada columna siguiente repite el nombre del ganador de cada cruce, a media
 * altura de sus dos participantes, y el marcador `ganador/perdedor` unos
 * puntos por debajo. Un cruce sólo es un asalto si: sus dos participantes
 * existen en la columna anterior, el ganador es exactamente uno de ellos, hay
 * marcador y el ganador tiene más tocados, y ambos se atribuyen a una sola
 * fila de la clasificación. Un participante sin pareja avanza sin asalto.
 *
 * Los cuadros grandes repiten cada ronda en dos páginas; el acumulador cuenta
 * el cruce una vez y retira los que se contradicen.
 */

export type LecturaCuadro = {
  asaltos: AsaltoPdf[];
  excluidos: ExclusionesPdf;
  rechazos: Rechazo[];
  /** Cruces con dos participantes publicados, una vez por cruce. */
  publicado: number;
};

type Entrada = ItemTexto & { texto: string; atrib: Atribucion };

const RE_SCORE = /^(\d+)\/(\d+)$/;
const RE_NUMERO = /^\d{1,3}$/;
const TOL_Y = 1.8;

export function claveRonda(texto: string): string | null {
  const t = normalizar(texto);
  const n = t.match(/^(?:TABLEAU OF|TABLA DE) (\d+)$/);
  if (n) {
    const v = Number(n[1]);
    return v >= 2 && (v & (v - 1)) === 0 ? `A${v}` : null;
  }
  if (/^SEMI-?FINALES?$|^SEMIFINALS?$/.test(t)) return 'A4';
  if (/^(QUARTS|CUARTOS) DE FINAL$/.test(t)) return 'A8';
  if (t === 'FINAL') return 'A2';
  if (/^TERCER (LUGAR|PUESTO)$/.test(t)) return 'C2';
  return null;
}

const regionPar = (pagina: number, yAlto: number, yBajo: number): Region => ({
  pagina,
  yMax: redondear(yAlto + 8),
  yMin: redondear(yBajo - 4),
});

export function leerCuadro(paginas: readonly PaginaAnalizada[], registro: readonly Participante[]): LecturaCuadro {
  const excluidos = exclusionesVacias();
  const rechazos: Rechazo[] = [];
  const acumulador = new AcumuladorAsaltos(excluidos);
  const cruces = new Set<string>();

  for (const pg of paginas) {
    const regionPagina: Region = { pagina: pg.numero, yMax: redondear(pg.filas[0].y + 8), yMin: 55 };
    const rechazarPagina = (motivo: string) => rechazos.push({ seccion: 'cuadro', region: regionPagina, motivo });

    const encabezados = pg.filas[0].items.filter((i) => esItemRonda(i.s)).sort((a, b) => a.x - b.x);
    const cuerpo = pg.filas.slice(1).flatMap((f) => f.items);
    const semillas = cuerpo.filter((i) => RE_NUMERO.test(i.s) && i.x < pg.ancho * 0.1);
    if (semillas.length === 0) {
      rechazarPagina('Cuadro sin participantes numerados en la primera columna');
      continue;
    }

    const filasSemilla = semillas.map((s) => ({ s, items: cuerpo.filter((i) => Math.abs(i.y - s.y) <= TOL_Y).sort((a, b) => a.x - b.x) }));
    const columna0: Entrada[] = [];
    for (const { s, items } of filasSemilla) {
      const resto = items.filter((i) => i.x > s.x + s.w);
      if (resto.length === 0) continue;
      const club = resto[1]?.s ?? null;
      columna0.push({ ...resto[0], texto: resto[0].s, atrib: resolverParticipante(registro, resto[0].s, club) });
    }
    const yFilas = semillas.map((s) => s.y);
    const xNombre = columna0.length > 0 ? Math.min(...columna0.map((c) => c.x)) : 0;

    const ganadores = cuerpo.filter(
      (i) =>
        /\p{L}/u.test(i.s) &&
        !RE_SCORE.test(i.s) &&
        i.x > xNombre + 20 &&
        !yFilas.some((y) => Math.abs(y - i.y) <= TOL_Y),
    );
    const centros = agruparValores(ganadores.map((g) => g.x), 3).map((c) => c.centro);
    const columnas: Entrada[][] = [columna0];
    for (const c of centros) {
      columnas.push(
        ganadores
          .filter((g) => Math.abs(g.x - c) <= 3)
          .map((g) => ({ ...g, texto: g.s, atrib: { ok: false, motivo: 'desconocido' } as Atribucion })),
      );
    }
    const marcadores = cuerpo.filter((i) => RE_SCORE.test(i.s));

    for (let k = 0; k + 1 < columnas.length; k += 1) {
      const encabezado = encabezados[k];
      const ronda = encabezado ? claveRonda(encabezado.s) : null;
      if (!encabezado || !ronda) {
        rechazarPagina(`Ronda de la columna ${k + 1} sin encabezado reconocible`);
        continue;
      }
      const entradas = columnas[k];

      for (const w of columnas[k + 1]) {
        const dist = entradas.map((e) => ({ e, d: Math.abs(e.y - w.y) }));
        const d1 = Math.min(...dist.map((x) => x.d));
        const cerca = dist.filter((x) => Math.abs(x.d - d1) <= 2);
        const arriba = cerca.filter((x) => x.e.y > w.y);
        const abajo = cerca.filter((x) => x.e.y < w.y);
        const reg = regionPar(pg.numero, w.y + d1, w.y - d1);
        const marcador = marcadores.find(
          (m) => m.x >= w.x - 2 && m.x <= w.x + 30 && m.y <= w.y - 8 && m.y >= w.y - 17,
        );
        const rechazarCruce = (motivo: string) => rechazos.push({ seccion: 'cuadro', region: reg, motivo });

        if (!Number.isFinite(d1) || d1 > pg.alto / 2) {
          rechazarCruce('Ganador sin participantes en la columna anterior');
          continue;
        }

        // Sin pareja: avanza sin asalto, y no puede traer marcador.
        if (arriba.length + abajo.length === 1) {
          const solo = cerca[0].e;
          if (marcador) {
            excluidos.incoherente += 1;
            rechazarCruce('Marcador publicado en un participante sin rival');
          } else if (!compatibles(solo.texto, w.texto)) {
            excluidos.incoherente += 1;
            rechazarCruce('El que avanza sin rival no coincide con el participante');
          } else {
            excluidos.bye += 1;
            w.atrib = solo.atrib;
          }
          continue;
        }
        if (arriba.length !== 1 || abajo.length !== 1) {
          excluidos.incoherente += 1;
          rechazarCruce('Cruce con más de dos participantes posibles');
          continue;
        }

        const a = arriba[0].e;
        const b = abajo[0].e;
        // Engarde rellena los huecos del cuadro con una fila de guiones.
        const esBye = (e: Entrada): boolean => /^-+$/.test(e.texto.trim());
        if (esBye(a) || esBye(b)) {
          const real = esBye(a) ? b : a;
          if (esBye(a) && esBye(b)) {
            excluidos.incoherente += 1;
            rechazarCruce('Cruce sin ningún participante');
          } else if (marcador) {
            excluidos.incoherente += 1;
            rechazarCruce('Marcador publicado en un participante sin rival');
          } else if (!compatibles(real.texto, w.texto)) {
            excluidos.incoherente += 1;
            rechazarCruce('El que avanza sin rival no coincide con el participante');
          } else {
            excluidos.bye += 1;
            w.atrib = real.atrib;
          }
          continue;
        }
        cruces.add(`${ronda}|${[normalizar(a.texto), normalizar(b.texto)].sort().join('|')}`);
        const esA = compatibles(a.texto, w.texto);
        const esB = compatibles(b.texto, w.texto);
        if (esA === esB) {
          excluidos[esA ? 'identidadNoConfirmada' : 'incoherente'] += 1;
          rechazarCruce(esA ? 'Los dos participantes encajan con el texto del ganador' : 'El ganador no coincide con ninguno de los dos participantes');
          continue;
        }
        const ganador = esA ? a : b;
        const perdedor = esA ? b : a;
        w.atrib = ganador.atrib;

        if (!marcador) {
          excluidos.sinMarcador += 1;
          continue;
        }
        const m = marcador.s.match(RE_SCORE);
        const pg1 = Number(m?.[1]);
        const pg2 = Number(m?.[2]);
        if (!(pg1 > pg2)) {
          excluidos.incoherente += 1;
          rechazarCruce('El marcador no da más tocados al ganador');
          continue;
        }
        if (!ganador.atrib.ok || !perdedor.atrib.ok || ganador.atrib.ref === perdedor.atrib.ref) {
          excluidos.identidadNoConfirmada += 1;
          rechazarCruce('Participante no atribuible a una sola fila de la clasificación');
          continue;
        }
        acumulador.agregar({
          fase: 'TABLEAU',
          ronda,
          rondaOriginal: encabezado.s,
          marcador: 'explicito',
          region: reg,
          ganador: { ref: ganador.atrib.ref, nombre: ganador.atrib.nombre, puntos: pg1 },
          perdedor: { ref: perdedor.atrib.ref, nombre: perdedor.atrib.nombre, puntos: pg2 },
        });
      }
    }
  }

  return { asaltos: acumulador.asaltos, excluidos, rechazos, publicado: cruces.size };
}
