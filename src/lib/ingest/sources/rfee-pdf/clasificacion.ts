import { agruparValores, normalizar, redondear, textoFila, type Fila } from './geometria';
import type { PaginaAnalizada } from './paginas';
import type { Formato, PuestoPdf, Rechazo, Region } from './tipos';

/**
 * «Clasificación general final» de un PDF de Engarde: un puesto por fila.
 *
 * Los puestos son los publicados: los empates repiten número y el siguiente
 * conserva el suyo (3, 3, 5), y un literal que no es un número («Ganador»,
 * «Abandono») se guarda como texto sin inventar el puesto. La clasificación
 * es también el registro de participantes del documento: de ella salen las
 * referencias que usan poules y cuadro.
 */

export type LecturaClasificacion = {
  puestos: PuestoPdf[];
  rechazos: Rechazo[];
  /** Total que declara el encabezado («- 28 tiradores»), si lo declara. */
  publicado: number | null;
  unidad: Formato | null;
  /** Encabezados con totales distintos entre páginas. */
  totalesContradictorios: boolean;
  paginas: number;
};

const RE_TOTAL = /-\s*(\d+)\s+(TIRADORES|TIRADORAS|EQUIPOS)\)/;
export const RE_COLUMNA_PUESTO = /^(CL\.?|CLAS\.?|POS\.?|LUGAR)$/;
export const RE_PUESTO_TEXTO =
  /^(GANAN?DOR[A]?|FINALISTA|ABANDONO|ABAND\.?|RETIRAD[OA]|RET\.?|EXCLUID[OA]|EXC\.?|DESCALIFICAD[OA]|DESC\.?|NO PRESENTAD[OA]|NP|DNS|DNF|DQ|FORFAIT|-+)$/;

const region = (pagina: number, y: number): Region => ({ pagina, yMax: redondear(y + 7), yMin: redondear(y - 3) });

export function leerClasificacion(paginas: readonly PaginaAnalizada[]): LecturaClasificacion {
  const puestos: PuestoPdf[] = [];
  const rechazos: Rechazo[] = [];
  const totales = new Set<number>();
  let unidad: Formato | null = null;
  let n = 0;

  for (const pg of paginas) {
    const encabezado = normalizar(textoFila(pg.filas[0]));
    const total = encabezado.match(RE_TOTAL);
    if (total) {
      totales.add(Number(total[1]));
      unidad = total[2] === 'EQUIPOS' ? 'EQUIPOS' : 'INDIVIDUAL';
    }

    const cuerpo: Fila[] = pg.filas.slice(1);
    if (cuerpo.length > 0 && RE_COLUMNA_PUESTO.test(normalizar(cuerpo[0].items[0].s)) && !/\d/.test(cuerpo[0].items[0].s)) {
      // Sin total declarado, una columna «Nombre» es la tabla de personas.
      const columnasTabla = cuerpo[0].items.map((i) => normalizar(i.s));
      if (unidad === null && columnasTabla.some((c) => /(^| )NOMBRE$/.test(c)) && !columnasTabla.some((c) => /^EQUIPOS?$/.test(c))) {
        unidad = 'INDIVIDUAL';
      }
      cuerpo.shift();
    }

    const esPuesto = (f: Fila): boolean => {
      if (f.items.length < 2) return false;
      const p = f.items[0].s.trim();
      return /^\d{1,4}$/.test(p) || RE_PUESTO_TEXTO.test(normalizar(p));
    };
    const filasPuesto = cuerpo.filter(esPuesto);

    // Las columnas se deducen de dónde empieza el texto de las filas, no de
    // su orden: una fila sin club no desplaza el resto.
    const apoyo = Math.max(1, Math.floor(filasPuesto.length * 0.2));
    const columnas = agruparValores(
      filasPuesto.flatMap((f) => f.items.slice(1).map((i) => i.x)),
      4,
    ).filter((c) => c.n >= apoyo);

    for (const f of cuerpo) {
      if (!esPuesto(f)) {
        // Integrantes de un equipo: líneas con un solo texto bajo su equipo.
        if (f.items.length === 1 && unidad === 'EQUIPOS') continue;
        rechazos.push({ seccion: 'puestos', region: region(pg.numero, f.y), motivo: 'Fila de clasificación sin puesto publicado' });
        continue;
      }
      if (columnas.length < 1 || columnas.length > 3) {
        rechazos.push({ seccion: 'puestos', region: region(pg.numero, f.y), motivo: `Maquetación de columnas no reconocida (${columnas.length})` });
        continue;
      }

      const celdas: string[] = columnas.map(() => '');
      let valida = true;
      for (const it of f.items.slice(1)) {
        // Un texto pertenece a la última columna que empieza a su izquierda:
        // los apellidos compuestos parten el texto en varios ítems dentro
        // de la misma columna.
        let k = -1;
        for (let c = 0; c < columnas.length; c += 1) if (columnas[c].centro <= it.x + 4) k = c;
        if (k < 0) {
          valida = false;
          continue;
        }
        celdas[k] = `${celdas[k]} ${it.s}`.trim();
      }
      const nombre = columnas.length === 3 ? `${celdas[0]} ${celdas[1]}`.trim() : celdas[0];
      const club = columnas.length === 1 ? null : celdas[columnas.length - 1] || null;
      if (!valida || nombre.length < 2) {
        rechazos.push({ seccion: 'puestos', region: region(pg.numero, f.y), motivo: 'Fila de clasificación no atribuible a nombre y club' });
        continue;
      }

      const textoPuesto = f.items[0].s.trim();
      const numerico = /^\d{1,4}$/.test(textoPuesto);
      n += 1;
      puestos.push({
        sourceFactKey: `pdf:p${pg.numero}:y${Math.round(f.y)}`,
        ref: `${unidad === 'EQUIPOS' ? 't' : 'p'}${String(n).padStart(4, '0')}`,
        posicion: numerico ? Number(textoPuesto) : null,
        posicionRaw: numerico ? null : textoPuesto,
        nombre,
        club,
        region: region(pg.numero, f.y),
      });
    }
  }

  return {
    puestos,
    rechazos,
    publicado: totales.size === 1 ? [...totales][0] : null,
    unidad,
    totalesContradictorios: totales.size > 1,
    paginas: paginas.length,
  };
}
