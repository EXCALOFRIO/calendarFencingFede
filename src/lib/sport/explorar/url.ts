import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, formatDateEs } from '@/lib/utils';

/**
 * Criterios de Explorar tal y como viajan en la URL.
 *
 * Es la única fuente de verdad de la pantalla: el servidor los lee de
 * `searchParams`, el formulario los escribe con `router.push` y el botón Atrás
 * recupera exactamente la búsqueda anterior. No importa nada de servidor, de
 * modo que el formulario (cliente) y la página (servidor) comparten estas
 * mismas funciones.
 */

export const RUTA_EXPLORAR = '/explorar';

/** El orden de esta lista es el de la URL y el de los chips. */
export const CLAVES_CRITERIO = [
  'q',
  'nacionalidad',
  'arma',
  'genero',
  'categoria',
  'ambito',
  'temporada',
  'torneo',
  'desde',
  'hasta',
  'edicionId',
  'formato',
  'categoriaRaw',
] as const;

export type ClaveCriterio = (typeof CLAVES_CRITERIO)[number];
export type CriteriosExplorar = Record<ClaveCriterio, string>;

export const CRITERIOS_VACIOS: CriteriosExplorar = {
  q: '',
  nacionalidad: '',
  arma: '',
  genero: '',
  categoria: '',
  ambito: '',
  temporada: '',
  torneo: '',
  desde: '',
  hasta: '',
  edicionId: '',
  formato: '',
  categoriaRaw: '',
};

/** Claves cuyo valor es un código en mayúsculas. */
const EN_MAYUSCULAS: ReadonlySet<ClaveCriterio> = new Set([
  'nacionalidad',
  'arma',
  'genero',
  'categoria',
  'ambito',
  'formato',
]);

const LONGITUD_MAXIMA = 80;

type ParametrosPagina = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor) ?? '';
}

/**
 * Extrae los criterios de `searchParams`. No valida vocabularios: un valor
 * desconocido llega al servidor y éste responde `entrada_invalida`, que la
 * pantalla distingue de «sin resultados».
 */
export function leerCriterios(params: ParametrosPagina): {
  criterios: CriteriosExplorar;
  cursor: string | undefined;
} {
  const criterios = { ...CRITERIOS_VACIOS };
  for (const clave of CLAVES_CRITERIO) {
    const crudo = primero(params[clave]).replace(/\s+/g, ' ').trim().slice(0, LONGITUD_MAXIMA);
    criterios[clave] = EN_MAYUSCULAS.has(clave) ? crudo.toUpperCase() : crudo;
  }
  const cursor = primero(params.cursor).trim();
  return { criterios, cursor: cursor || undefined };
}

export function hayCriterios(criterios: CriteriosExplorar): boolean {
  return CLAVES_CRITERIO.some((clave) => criterios[clave] !== '');
}

/** Entrada para `buscarDeportistas`: sólo lo rellenado, más el cursor si lo hay. */
export function aEntrada(
  criterios: CriteriosExplorar,
  cursor: string | undefined,
): Record<string, string> {
  const entrada: Record<string, string> = {};
  for (const clave of CLAVES_CRITERIO) {
    if (criterios[clave] !== '') entrada[clave] = criterios[clave];
  }
  if (cursor) entrada.cursor = cursor;
  return entrada;
}

/** Cambiar un criterio cambia la consulta: por eso el cursor nunca se arrastra. */
export function construirUrl(criterios: CriteriosExplorar, cursor?: string): string {
  const params = new URLSearchParams();
  for (const clave of CLAVES_CRITERIO) {
    if (criterios[clave] !== '') params.set(clave, criterios[clave]);
  }
  if (cursor) params.set('cursor', cursor);
  const texto = params.toString();
  return texto ? `${RUTA_EXPLORAR}?${texto}` : RUTA_EXPLORAR;
}

export function alternarEspana(criterios: CriteriosExplorar): CriteriosExplorar {
  return { ...criterios, nacionalidad: criterios.nacionalidad === 'ESP' ? '' : 'ESP' };
}

/**
 * Ficha deportiva de una persona indexada. Es una ruta común a todas las
 * cuentas con sesión y se abre siempre por el identificador elegido: dos
 * homónimos nunca comparten enlace.
 */
export function rutaFicha(personaId: string): string {
  return `${RUTA_EXPLORAR}/${personaId}`;
}

const ETIQUETA: Record<ClaveCriterio, string> = {
  q: 'Nombre',
  nacionalidad: 'País',
  arma: 'Arma',
  genero: 'Género',
  categoria: 'Categoría',
  ambito: 'Ámbito',
  temporada: 'Temporada',
  torneo: 'Torneo',
  desde: 'Desde',
  hasta: 'Hasta',
  edicionId: 'Edición',
  formato: 'Formato',
  categoriaRaw: 'Categoría publicada',
};

const AMBITO_LABEL: Record<string, string> = {
  NACIONAL: 'Nacional',
  INTERNACIONAL: 'Internacional',
  AUTONOMICO: 'Autonómico',
};

const FORMATO_LABEL: Record<string, string> = {
  INDIVIDUAL: 'Individual',
  EQUIPOS: 'Equipos',
};

function fechaLegible(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDateEs(iso) : iso;
}

export function valorLegible(clave: ClaveCriterio, valor: string): string {
  switch (clave) {
    case 'arma':
      return WEAPON_LABEL[valor as keyof typeof WEAPON_LABEL] ?? valor;
    case 'genero':
      return GENDER_LABEL[valor as keyof typeof GENDER_LABEL] ?? valor;
    case 'categoria':
      return CATEGORY_LABEL[valor as keyof typeof CATEGORY_LABEL] ?? valor;
    case 'ambito':
      return AMBITO_LABEL[valor] ?? valor;
    case 'formato':
      return FORMATO_LABEL[valor] ?? valor;
    case 'desde':
    case 'hasta':
      return fechaLegible(valor);
    case 'edicionId':
      return 'una edición concreta';
    default:
      return valor;
  }
}

export type ChipCriterio = {
  clave: ClaveCriterio;
  etiqueta: string;
  valor: string;
  /** URL de la misma búsqueda sin este criterio y desde la primera página. */
  quitar: string;
};

export function chipsActivos(criterios: CriteriosExplorar): ChipCriterio[] {
  return CLAVES_CRITERIO.filter((clave) => criterios[clave] !== '').map((clave) => ({
    clave,
    etiqueta: ETIQUETA[clave],
    valor: valorLegible(clave, criterios[clave]),
    quitar: construirUrl({ ...criterios, [clave]: '' }),
  }));
}

/**
 * Claves de temporada deportiva tal y como se guardan (`AAAA-AAAA`), de la
 * vigente hacia atrás. La temporada empieza en septiembre y cruza el año
 * civil, así que en octubre de 2026 la vigente es 2026-2027.
 */
export function temporadasOfrecidas(hoy: string, cuantas = 16): string[] {
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  const inicio = mes >= 9 ? anio : anio - 1;
  return Array.from({ length: cuantas }, (_, i) => `${inicio - i}-${inicio - i + 1}`);
}
