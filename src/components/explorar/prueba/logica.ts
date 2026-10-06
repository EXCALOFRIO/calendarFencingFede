import type { VistaPrueba } from '@/lib/sport/explorar/edicion-url';
import type { AsaltoDePrueba, FilaPoule, RondaCuadro } from '@/lib/sport/explorar/tipos-busqueda';
import { nombreVisible, partesNombre } from '@/lib/sport/nombre-visible';

/**
 * Lógica pura de la página de una prueba (búsqueda, rondas visibles del
 * cuadro y vista inicial). Sin React ni DOM: se prueba sola y la usa el cliente.
 */

export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Cada palabra escrita aparece en el nombre, en cualquier orden y sin tildes. */
export function coincideNombre(nombre: string, consulta: string): boolean {
  const palabras = normalizarBusqueda(consulta).split(' ').filter(Boolean);
  if (palabras.length === 0) return false;
  const objetivo = ` ${normalizarBusqueda(nombre)}`;
  return palabras.every((p) => objetivo.includes(` ${p}`));
}

/**
 * Nombre para una casilla estrecha del cuadro: «Kano K.» cuando la fuente
 * separa apellidos y nombre («KANO Koki»); si no, el nombre visible entero.
 */
export function nombreCorto(publicado: string): string {
  const { nombre, apellidos } = partesNombre(publicado);
  if (!nombre || !apellidos) return nombreVisible(publicado);
  return `${nombreVisible(apellidos)} ${nombre.charAt(0).toLocaleUpperCase('es')}.`;
}

export type Filtro = { consulta: string; persona?: string };

/**
 * A quién se resalta: con texto escrito, a quien lo contenga en el nombre; sin
 * texto, a la persona de la dirección (`persona=`).
 */
export function resaltado(t: { personaId: string | null; nombre: string }, filtro: Filtro): boolean {
  if (normalizarBusqueda(filtro.consulta)) return coincideNombre(t.nombre, filtro.consulta);
  return Boolean(filtro.persona) && t.personaId === filtro.persona;
}

export function hayFiltro(filtro: Filtro): boolean {
  return Boolean(normalizarBusqueda(filtro.consulta) || filtro.persona);
}

/* -------------------------------------------------------------- poules */

type CifrasPoule = Pick<FilaPoule, 'victorias' | 'asaltos' | 'tocados' | 'recibidos'>;

/**
 * Puesto de cada fila dentro de su poule, en el orden de `filas`: cociente de
 * victorias, después índice y después tocados dados, como el reglamento FIE.
 * Dos filas con las tres cifras iguales comparten puesto.
 */
export function puestosPoule(filas: readonly CifrasPoule[]): number[] {
  const clave = (f: CifrasPoule) => [f.asaltos > 0 ? f.victorias / f.asaltos : 0, f.tocados - f.recibidos, f.tocados];
  const compara = (a: CifrasPoule, b: CifrasPoule) => {
    const [x, y] = [clave(a), clave(b)];
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  };
  return filas.map((f) => 1 + filas.filter((o) => compara(o, f) < 0).length);
}

/* -------------------------------------------------------------- rondas */

export type Ventana = { desde: number; hasta: number; puedeAtras: boolean; puedeAdelante: boolean };

/**
 * Rondas visibles del cuadro: `ancho` columnas seguidas a partir de `inicio`.
 * Nunca pasa de la última ronda (la final): con las últimas `ancho` a la vista
 * ya no se puede avanzar, y con menos rondas que columnas se ven todas.
 */
export function ventanaRondas(total: number, inicio: number, ancho: number): Ventana {
  const n = Math.max(0, Math.min(Math.max(1, Math.floor(ancho)), total));
  const maximo = Math.max(0, total - n);
  const desde = Math.min(Math.max(0, Math.floor(Number.isNaN(inicio) ? 0 : inicio)), maximo);
  return { desde, hasta: desde + n, puedeAtras: desde > 0, puedeAdelante: desde < maximo };
}

/** Rondas por tamaño (de la mayor a la final) y el resto (tercer puesto, claves raras) aparte. */
export function separarRondas(cuadro: readonly RondaCuadro[]): { principales: RondaCuadro[]; otras: RondaCuadro[] } {
  return {
    principales: cuadro.filter((r) => r.tamano !== null),
    otras: cuadro.filter((r) => r.tamano === null),
  };
}

function claveTirador(t: { personaId: string | null; nombre: string }): string {
  return t.personaId ?? `nombre:${normalizarBusqueda(t.nombre)}`;
}

function ganadorDe(a: AsaltoDePrueba) {
  if (a.a.tantos === a.b.tantos) return null;
  return a.a.tantos > a.b.tantos ? a.a : a.b;
}

/**
 * Casillas de cada ronda principal, de la mayor a la final, con `null` donde
 * falta el asalto (un exento que entra en una ronda posterior, o un asalto no
 * publicado). Así cada columna tiene el doble de casillas que la siguiente y el
 * cuadro se alinea con cualquier ventana. Se parte de la final: cada tirador
 * de una ronda ocupa la casilla del asalto que ganó en la anterior. Lo que no
 * encaja va al final de su ronda; si una ronda no encaja nada, va tal cual.
 */
export function huecosCuadro(rondas: readonly RondaCuadro[]): (AsaltoDePrueba | null)[][] {
  const n = rondas.length;
  if (n === 0) return [];
  const huecos: (AsaltoDePrueba | null)[][] = new Array(n);
  huecos[n - 1] = [...rondas[n - 1].asaltos];
  for (let k = n - 2; k >= 0; k -= 1) {
    const propios = rondas[k].asaltos;
    const usados = new Set<string>();
    const fila: (AsaltoDePrueba | null)[] = [];
    for (const s of huecos[k + 1]) {
      if (!s) {
        fila.push(null, null);
        continue;
      }
      for (const t of [s.a, s.b]) {
        const clave = claveTirador(t);
        const previo = propios.find((p) => {
          const g = ganadorDe(p);
          return !usados.has(p.id) && g !== null && claveTirador(g) === clave;
        });
        if (previo) usados.add(previo.id);
        fila.push(previo ?? null);
      }
    }
    huecos[k] = usados.size === 0 ? [...propios] : [...fila, ...propios.filter((p) => !usados.has(p.id))];
  }
  return huecos;
}

/** Última ronda en la que tira alguien resaltado por el filtro, o `-1`. */
export function ultimaRondaResaltada(rondas: readonly RondaCuadro[], filtro: Filtro): number {
  if (!hayFiltro(filtro)) return -1;
  for (let i = rondas.length - 1; i >= 0; i -= 1) {
    if (rondas[i].asaltos.some((a) => resaltado(a.a, filtro) || resaltado(a.b, filtro))) return i;
  }
  return -1;
}

/**
 * Primera ronda que se enseña al abrir las directas: la mayor del cuadro
 * principal. El cuadro previo de la FIE (rótulos «Previa · …») queda a la
 * izquierda, a una flecha.
 */
export function inicioPorDefecto(rondas: readonly Pick<RondaCuadro, 'etiqueta'>[]): number {
  const i = rondas.findIndex((r) => !r.etiqueta.startsWith('Previa'));
  return i < 0 ? 0 : i;
}

/**
 * Inicio de la ventana para enseñar la ronda `indice`: en la segunda columna
 * si se puede, para que se vea también de dónde viene.
 */
export function inicioParaRonda(indice: number): number {
  return indice <= 0 ? 0 : indice - 1;
}

/* --------------------------------------------------------------- vistas */

export type Disponibles = Record<VistaPrueba, boolean>;

/** La vista pedida si tiene datos; si no, la primera que los tenga, y la clasificación si ninguna. */
export function vistaInicial(pedida: VistaPrueba | undefined, disponibles: Disponibles): VistaPrueba {
  if (pedida && disponibles[pedida]) return pedida;
  return (['clasificacion', 'directas', 'poules'] as const).find((v) => disponibles[v]) ?? 'clasificacion';
}
