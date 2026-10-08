import { COLOR_MEDALLA, type Medalla } from '@/lib/sport/explorar/presentacion';
import type { AmbitoCompeticion, TonoTipo } from '@/lib/sport/explorar/tipos-social';
import { nombreVisible, partesNombre } from '@/lib/sport/nombre-visible';

/**
 * Piezas comunes de las gráficas. Los colores son variables CSS del tema
 * (`globals.css`), así que siguen al tema oscuro o claro sin tocar nada; los
 * únicos literales son los de medalla, que ya están en `presentacion.ts`.
 *
 * Las gráficas pintan las líneas en un SVG estirado (`preserveAspectRatio`
 * `none` con trazo que no escala) y los puntos y rótulos en HTML colocado en
 * porcentajes: así ocupan el 100 % del ancho a 393 px y a 1440 px sin que la
 * letra crezca ni los círculos se deformen.
 */

/**
 * Para bloques largos por debajo del pliegue: el navegador no los maqueta ni
 * pinta hasta que se acercan a la pantalla. El alto de reserva evita que la
 * barra de desplazamiento salte; `auto` recuerda el real una vez pintado.
 */
export const FUERA_DE_PANTALLA = '[content-visibility:auto] [contain-intrinsic-size:auto_480px]';

export const COLOR_TONO: Record<TonoTipo, string> = {
  gold: 'var(--gold)',
  primary: 'var(--primary-text)',
  'org-fie': 'var(--org-fie)',
  'org-efc': 'var(--org-efc)',
  'org-rfee': 'var(--org-rfee)',
  'org-aut': 'var(--org-aut)',
  off: 'var(--off)',
};

export const COLOR_AMBITO: Record<AmbitoCompeticion, string> = {
  internacional: 'var(--org-fie)',
  nacional: 'var(--org-rfee)',
};

export const COLOR = {
  marca: 'var(--primary-text)',
  relleno: 'var(--primary)',
  apagado: 'var(--off)',
  texto: 'var(--foreground)',
  victoria: 'var(--ok)',
  derrota: 'var(--danger)',
  ...COLOR_MEDALLA,
} as const;

export const MEDALLAS: { clave: Medalla; nombre: string }[] = [
  { clave: 'oro', nombre: 'Oro' },
  { clave: 'plata', nombre: 'Plata' },
  { clave: 'bronce', nombre: 'Bronce' },
];

/** Mezcla un color del tema con transparencia (para áreas y tintes de gráfica). */
export const tinte = (color: string, por: number) => `color-mix(in oklab, ${color} ${por}%, transparent)`;

export const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100));

const DECIMAL = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const decimal = (v: number) => DECIMAL.format(v);

export const conSigno = (v: number, texto = String(v)) =>
  v > 0 ? `+${texto}` : v < 0 ? `−${texto.replace('-', '')}` : texto;

/** Percentil (puesto / cuadro) como «Top 9 %»; por debajo del 1 % se redondea a 1. */
export function top(p: number | null | undefined): string | null {
  if (p == null) return null;
  return `Top ${Math.max(1, Math.round(p * 100))}%`;
}

/**
 * Escala vertical de percentiles: raíz cuadrada, para que el tramo de arriba
 * (podios, top 10 %) no quede aplastado contra el borde. 0 % arriba.
 */
export const yPercentil = (p: number) => Math.sqrt(Math.min(1, Math.max(0, p))) * 100;

/**
 * Parte del cuadro que acabó por delante (0 = ganó, 1 = último). Para pintar
 * puestos sueltos es mejor que puesto / cuadro: ganar un TNR de 20 y una Copa
 * del Mundo de 200 caen los dos en la línea de arriba.
 */
export function fraccionDelante(puesto: number, participantes: number | null): number | null {
  if (participantes === null || participantes < 2 || puesto < 1 || puesto > participantes) return null;
  return (puesto - 1) / (participantes - 1);
}

/** Valores redondos para las guías de un eje lineal entre `min` y `max` (dos o tres). */
export function marcasRedondas(min: number, max: number): number[] {
  const rango = max - min;
  if (!(rango > 0)) return [];
  const bruto = rango / 3;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= bruto) ?? bruto;
  const salida: number[] = [];
  for (let v = Math.ceil(min / paso) * paso; v < max; v += paso) if (v > min) salida.push(Number(v.toFixed(6)));
  return salida;
}

export const MARCAS_PERCENTIL = [
  { p: 0.1, rotulo: 'Top 10%' },
  { p: 0.25, rotulo: 'Top 25%' },
  { p: 0.5, rotulo: 'Top 50%' },
];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

export function mesAnio(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null;
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** Índices a rotular en un eje de `n` columnas sin que se pisen: siempre el último. */
export function indicesRotulo(n: number, maximo = 6): Set<number> {
  const paso = Math.max(1, Math.ceil(n / maximo));
  const salida = new Set<number>();
  for (let i = n - 1; i >= 0; i -= paso) salida.add(i);
  return salida;
}

/** Centro de la columna `i` de `n`, en %: las líneas por temporada caen en el centro de cada barra. */
export const xColumna = (i: number, n: number) => ((i + 0.5) / Math.max(1, n)) * 100;

/** Primer apellido en formato título, para rótulos de una palabra. */
export function apellidoCorto(publicado: string): string {
  const { nombre, apellidos } = partesNombre(publicado);
  // «APELLIDOS Nombre»: el primer apellido abre. Si no, va después del nombre («Juan Pérez»).
  const palabras = nombreVisible(publicado).split(/\s+/).filter(Boolean);
  const p = nombre ? apellidos.split(/\s+/)[0] : palabras.length > 1 ? palabras[1] : palabras[0] ?? publicado;
  return p.charAt(0).toLocaleUpperCase('es') + p.slice(1).toLocaleLowerCase('es');
}

/** Tramos sin huecos de una serie: un `null` corta la línea en vez de unir por encima. */
export function tramos(puntos: ({ x: number; y: number } | null)[]): { x: number; y: number }[][] {
  const salida: { x: number; y: number }[][] = [];
  let actual: { x: number; y: number }[] = [];
  for (const p of puntos) {
    if (p) actual.push(p);
    else if (actual.length) {
      salida.push(actual);
      actual = [];
    }
  }
  if (actual.length) salida.push(actual);
  return salida;
}

export const camino = (ps: { x: number; y: number }[]) =>
  ps.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
