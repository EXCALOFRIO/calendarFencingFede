/**
 * Cómo se escribe una prueba, un puesto y un recorte en un aviso. Puro y sin
 * servidor. La privacidad empieza aquí: estas funciones solo reciben nombre,
 * prueba y puesto, así que un aviso no puede llevar otra cosa.
 */

const ARMA: Record<string, string> = { FLORETE: 'Florete', ESPADA: 'Espada', SABLE: 'Sable' };
const GENERO_PRUEBA: Record<string, string> = { M: 'masculino', F: 'femenino', MIXTO: 'mixto' };
const CATEGORIA: Record<string, string> = { ABS: 'absoluto', VET: 'veteranos' };

export type DescripcionPrueba = {
  arma: string;
  genero: string;
  categoria: string;
  formato?: string | null;
};

/** «Espada femenino M17», «Sable masculino absoluto · equipos». */
export function nombrePrueba(p: DescripcionPrueba): string {
  const partes = [
    ARMA[p.arma] ?? p.arma,
    GENERO_PRUEBA[p.genero] ?? p.genero,
    CATEGORIA[p.categoria] ?? p.categoria,
  ].filter(Boolean);
  const base = partes.join(' ');
  return p.formato === 'EQUIPOS' ? `${base} · equipos` : base;
}

export function puestoTexto(puesto: number | null): string {
  return puesto !== null && Number.isInteger(puesto) && puesto > 0 ? `${puesto}.º` : 'sin puesto publicado';
}

/** Recorta sin partir una palabra y con «…» si hace falta. */
export function recortar(texto: string, maximo: number): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= maximo) return limpio;
  const corte = limpio.slice(0, maximo - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > maximo * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** «ahora», «hace 5 min», «hace 3 h», «hace 2 d», «12 mar» (como la actividad de Instagram). */
export function tiempoRelativo(ms: number, ahora: number): string {
  const s = Math.max(0, Math.round((ahora - ms) / 1000));
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86_400) return `hace ${Math.floor(s / 86_400)} d`;
  const fecha = new Date(ms);
  const partes = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'numeric', year: 'numeric' })
    .formatToParts(fecha);
  const dia = partes.find((p) => p.type === 'day')?.value ?? '';
  const mes = Number(partes.find((p) => p.type === 'month')?.value ?? '1');
  const anio = partes.find((p) => p.type === 'year')?.value ?? '';
  const esteAnio = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', year: 'numeric' }).format(new Date(ahora));
  return anio === esteAnio ? `${dia} ${MESES[mes - 1]}` : `${dia} ${MESES[mes - 1]} ${anio}`;
}

/** «Ana García, 3.º; Luis Pérez, 12.º y 4 más». */
export function listaPersonas(lineas: readonly { nombre: string; puesto: number | null }[], maximo = 4): string {
  const vistas = lineas.slice(0, maximo).map((l) => `${l.nombre}, ${puestoTexto(l.puesto)}`);
  const resto = lineas.length - vistas.length;
  return resto > 0 ? `${vistas.join('; ')} y ${resto} más` : vistas.join('; ');
}
