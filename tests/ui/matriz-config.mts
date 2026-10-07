/**
 * Parte pura de la matriz de dispositivos (sin Playwright ni base): los
 * dispositivos y variantes, qué arnés pinta cada página principal, el cálculo
 * de fallos a partir de las medidas del navegador, la puntuación con la que se
 * priorizan y el informe en Markdown. La usan `matriz-dispositivos.mts` (el
 * runner), `matriz-gancho.mts` (lo que se engancha a cada arnés) y
 * `tests/matriz-dispositivos.test.ts`.
 */

export type Dispositivo = {
  id: string;
  nombre: string;
  ancho: number;
  alto: number;
  dpr: number;
  movil: boolean;
  tactil: boolean;
};

export type Tema = 'oscuro' | 'claro';

export type Variante = Dispositivo & {
  /** Carpeta de capturas: `<dispositivo>[-claro][-texto130]`. */
  clave: string;
  tema: Tema;
  /** Tamaño del texto raíz en %, 100 sin zoom. */
  texto: number;
};

export const DISPOSITIVOS: readonly Dispositivo[] = [
  { id: 'iphone-se', nombre: 'iPhone SE', ancho: 320, alto: 568, dpr: 2, movil: true, tactil: true },
  { id: 'galaxy-s8', nombre: 'Galaxy S8', ancho: 360, alto: 740, dpr: 3, movil: true, tactil: true },
  { id: 'iphone-13-mini', nombre: 'iPhone 13 mini', ancho: 375, alto: 812, dpr: 3, movil: true, tactil: true },
  { id: 'iphone-15', nombre: 'iPhone 15', ancho: 393, alto: 852, dpr: 3, movil: true, tactil: true },
  { id: 'pixel-7', nombre: 'Pixel 7', ancho: 412, alto: 915, dpr: 2.625, movil: true, tactil: true },
  { id: 'iphone-15-pro-max', nombre: 'iPhone 15 Pro Max', ancho: 430, alto: 932, dpr: 3, movil: true, tactil: true },
  { id: 'ipad-mini', nombre: 'iPad mini vertical', ancho: 768, alto: 1024, dpr: 2, movil: true, tactil: true },
  { id: 'ipad-mini-horizontal', nombre: 'iPad mini horizontal', ancho: 1024, alto: 768, dpr: 2, movil: true, tactil: true },
  { id: 'portatil', nombre: 'Portátil 1280', ancho: 1280, alto: 800, dpr: 1, movil: false, tactil: false },
  { id: 'escritorio', nombre: 'Escritorio 1440', ancho: 1440, alto: 900, dpr: 1, movil: false, tactil: false },
  { id: 'escritorio-fhd', nombre: 'Escritorio 1920', ancho: 1920, alto: 1080, dpr: 1, movil: false, tactil: false },
];

/** Los dos móviles en los que se prueba el texto al 130 %. */
export const CON_TEXTO_GRANDE = ['iphone-se', 'iphone-15'] as const;
export const TEXTO_GRANDE = 130;
export const RAPIDO = ['iphone-15', 'escritorio'] as const;

export type OpcionesMatriz = {
  rapido?: boolean;
  /** Lista separada por comas de ids de dispositivo; vacía, todos. */
  dispositivos?: string;
  /** Lista separada por comas de temas; por defecto los dos (en rápido, sólo oscuro). */
  temas?: string;
  /** false quita las variantes de texto al 130 %. */
  textoGrande?: boolean;
};

export function claveVariante(id: string, tema: Tema, texto: number): string {
  return `${id}${tema === 'claro' ? '-claro' : ''}${texto !== 100 ? `-texto${texto}` : ''}`;
}

function lista(valor: string | undefined): string[] {
  return (valor ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Variantes que se ejecutan; lanza si se pide un dispositivo o un tema que no existe. */
export function parsearMatriz(o: OpcionesMatriz = {}): Variante[] {
  const pedidos = lista(o.dispositivos);
  for (const id of pedidos) {
    if (!DISPOSITIVOS.some((d) => d.id === id)) throw new Error(`dispositivo desconocido: ${id} (hay ${DISPOSITIVOS.map((d) => d.id).join(', ')})`);
  }
  const temasPedidos = lista(o.temas);
  for (const t of temasPedidos) if (t !== 'oscuro' && t !== 'claro') throw new Error(`tema desconocido: ${t}`);
  const ids = pedidos.length > 0 ? pedidos : o.rapido ? [...RAPIDO] : DISPOSITIVOS.map((d) => d.id);
  const temas = (temasPedidos.length > 0 ? temasPedidos : o.rapido ? ['oscuro'] : ['oscuro', 'claro']) as Tema[];
  const variantes: Variante[] = [];
  for (const d of DISPOSITIVOS.filter((x) => ids.includes(x.id))) {
    for (const tema of temas) variantes.push({ ...d, clave: claveVariante(d.id, tema, 100), tema, texto: 100 });
  }
  if (o.textoGrande !== false) {
    const grandes = o.rapido ? ids.filter((id) => DISPOSITIVOS.find((d) => d.id === id)?.movil) : CON_TEXTO_GRANDE.filter((id) => ids.includes(id));
    for (const id of grandes) {
      const d = DISPOSITIVOS.find((x) => x.id === id)!;
      variantes.push({ ...d, clave: claveVariante(d.id, 'oscuro', TEXTO_GRANDE), tema: 'oscuro', texto: TEXTO_GRANDE });
    }
  }
  return variantes;
}

/** Lee `--rapido`, `--dispositivos=a,b`, `--temas=oscuro`, `--sin-texto`, `--solo=alias,…`, `--paralelo=N`. */
export function parsearArgumentos(argv: readonly string[]): OpcionesMatriz & { solo: string[]; paralelo: number; listar: boolean } {
  const valor = (nombre: string) => argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
  const paralelo = Number(valor('paralelo') ?? 2);
  if (!Number.isInteger(paralelo) || paralelo < 1) throw new Error(`--paralelo no válido: ${valor('paralelo')}`);
  return {
    rapido: argv.includes('--rapido'),
    dispositivos: valor('dispositivos'),
    temas: valor('temas'),
    textoGrande: !argv.includes('--sin-texto'),
    solo: lista(valor('solo')),
    paralelo,
    listar: argv.includes('--listar'),
  };
}

// ---------------------------------------------------------------- arneses

export type Arnes = {
  /** Nombre corto de la página en el informe y en las capturas. */
  alias: string;
  fichero: string;
  /** Rutas del servidor del arnés (pathname + search) que entran en la matriz. */
  paginas: RegExp;
  env?: Record<string, string>;
  /** Nombre en el informe de alguna ruta, si no basta con alias + ruta. */
  nombres?: Record<string, string>;
  /** Qué pantallas de la app cubre, para el informe. */
  cubre: string;
};

function mesIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function arneses(hoy = new Date()): Arnes[] {
  const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return [
    { alias: 'calendario', fichero: 'calendario-pasado.mts', paginas: /^\/\d{4}-\d{2}-(mes|resultados)$/, env: { MESES: `${mesIso(hoy)},${mesIso(anterior)}` }, cubre: 'Calendario (mes actual y pasado) y hoja de resultados' },
    { alias: 'ficha-evento', fichero: 'ficha-evento-v2.mts', paginas: /^\/[^?]+$/, cubre: 'Ficha de un torneo del calendario' },
    { alias: 'explorar', fichero: 'explorar-app.mts', paginas: /^\/explorar(\/buscar(\?ver=paises)?|\/siguiendo|\/ediciones(\?q=mndial)?|\?q=alejandro)?$/, cubre: 'Explorar: feed, Buscar (tiradores, competiciones con y sin búsqueda, países), lista y Siguiendo' },
    { alias: 'perfil', fichero: 'perfil-secciones.mts', paginas: /^\/llavador-/, env: { SOLO: 'llavador' }, cubre: 'Perfil y sus secciones' },
    // La edición «por partes» por defecto no está en todas las copias y el arnés se para al no encontrarla.
    { alias: 'prueba', fichero: 'prueba-v2.mts', paginas: /^\/copa-(clasificacion|poules|directas)$/, env: { EDICION_PARTES: 'a8f16016-15ed-4f33-b5c6-beb73548a37c' }, cubre: 'Página de una prueba (clasificación, poules, directas)' },
    { alias: 'poule', fichero: 'tanda1.mts', paginas: /^\/(prueba-hoja-abierta|rivales)$/, cubre: 'Poule a pantalla completa y lista de rivales' },
    { alias: 'cara-a-cara', fichero: 'cara-a-cara-v2.mts', paginas: /^\/zabala-ramirez(-poule)?$/, cubre: 'Cara a cara' },
    // `tanda2.mts` exige RANKING_SQL; `diseno-perfil.mts` pinta lo mismo con la copia sola.
    { alias: 'ranking', fichero: 'diseno-perfil.mts', paginas: /^\/(ranking-nacional|ranking-internacional|espanol-cabecera)$/, nombres: { '/espanol-cabecera': 'perfil-cabecera' }, cubre: '/ranking nacional e internacional y cabecera del perfil' },
    // Avisos generados por el código real en un SQLite temporal; la copia sólo se lee.
    { alias: 'notificaciones', fichero: 'notificaciones.mts', paginas: /^\/(bandeja|bandeja-vacia|ajustes|ajustes-iphone|ajustes-activo)$/, cubre: 'Bandeja de notificaciones (con avisos y vacía) y Ajustes › Notificaciones (apagado, iPhone sin instalar y activo)' },
  ];
}

/** Pantallas pedidas que hoy no tienen arnés sin servidor. */
export const SIN_ARNES: string[] = [];

export function nombrePagina(alias: string, ruta: string, nombres: Record<string, string> = {}): string {
  if (nombres[ruta]) return nombres[ruta];
  const slug = ruta.replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'inicio';
  return slug === alias || slug.startsWith(`${alias}-`) ? slug : `${alias}-${slug}`;
}

// ---------------------------------------------------------------- medidas y fallos

/** Lo que devuelve `medirEnPagina` en el navegador. */
export type Medida = {
  ancho: number;
  alto: number;
  desborde: number;
  culpables: string[];
  cortados: string[];
  solapados: string[];
  tactiles: string[];
  grandes: string[];
  textoPequeno: string[];
  textoPequenoTotal: number;
  contraste: string[];
  contrasteTotal: number;
  truncados: string[];
  imagenes: string[];
  cls: number;
  fcp: number | null;
};

export type Registro = {
  alias: string;
  pagina: string;
  ruta: string;
  variante: string;
  tactil: boolean;
  captura: string | null;
  ms: number;
  consola: string[];
  error?: string;
  medida?: Medida;
};

export type TipoFallo =
  | 'error' | 'desborde' | 'consola' | 'cls' | 'solapado' | 'cortado' | 'tactil'
  | 'contraste' | 'imagen' | 'fcp' | 'texto' | 'grande';

export type Fallo = { tipo: TipoFallo; cuenta: number; puntos: number; ejemplos: string[] };

export const UMBRALES = { tactil: 40, grande: 44, texto: 12, contraste: 4.5, cls: 0.1, fcp: 1800 } as const;

const PESOS: Record<TipoFallo, { peso: number; tope: number }> = {
  error: { peso: 60, tope: 1 },
  desborde: { peso: 30, tope: 1 },
  consola: { peso: 12, tope: 3 },
  cls: { peso: 15, tope: 2 },
  solapado: { peso: 8, tope: 5 },
  cortado: { peso: 6, tope: 5 },
  tactil: { peso: 3, tope: 10 },
  contraste: { peso: 2, tope: 10 },
  imagen: { peso: 2, tope: 5 },
  fcp: { peso: 3, tope: 1 },
  texto: { peso: 1, tope: 10 },
  grande: { peso: 1, tope: 10 },
};

export const ETIQUETAS: Record<TipoFallo, string> = {
  error: 'no cargó',
  desborde: 'desborde horizontal',
  consola: 'errores de consola',
  cls: 'CLS',
  solapado: 'solapados',
  cortado: 'cortados',
  tactil: `táctil < ${UMBRALES.tactil} px`,
  contraste: `contraste < ${UMBRALES.contraste}:1`,
  imagen: 'imágenes sin tamaño',
  fcp: `FCP > ${UMBRALES.fcp} ms`,
  texto: `texto < ${UMBRALES.texto} px`,
  grande: `control > ${UMBRALES.grande} px de alto`,
};

function fallo(tipo: TipoFallo, cuenta: number, ejemplos: string[]): Fallo {
  const { peso, tope } = PESOS[tipo];
  return { tipo, cuenta, puntos: peso * Math.min(cuenta, tope), ejemplos: ejemplos.slice(0, 5) };
}

/** Fallos de una página en una variante. Los táctiles sólo cuentan en dispositivos táctiles. */
export function calcularFallos(r: Pick<Registro, 'tactil' | 'consola' | 'error' | 'medida'>): Fallo[] {
  const fallos: Fallo[] = [];
  if (r.error || !r.medida) return [fallo('error', 1, [r.error ?? 'sin medida'])];
  const m = r.medida;
  if (m.desborde > 0) fallos.push(fallo('desborde', 1, [`${m.desborde} px de más`, ...m.culpables]));
  if (r.consola.length > 0) fallos.push(fallo('consola', r.consola.length, r.consola));
  if (m.cls > UMBRALES.cls) fallos.push(fallo('cls', m.cls > 0.25 ? 2 : 1, [`CLS ${m.cls}`]));
  if (m.solapados.length > 0) fallos.push(fallo('solapado', m.solapados.length, m.solapados));
  if (m.cortados.length > 0) fallos.push(fallo('cortado', m.cortados.length, m.cortados));
  if (r.tactil && m.tactiles.length > 0) fallos.push(fallo('tactil', m.tactiles.length, m.tactiles));
  if (m.contrasteTotal > 0) fallos.push(fallo('contraste', m.contrasteTotal, m.contraste));
  if (m.imagenes.length > 0) fallos.push(fallo('imagen', m.imagenes.length, m.imagenes));
  if (m.fcp !== null && m.fcp > UMBRALES.fcp) fallos.push(fallo('fcp', 1, [`FCP ${Math.round(m.fcp)} ms`]));
  if (m.textoPequenoTotal > 0) fallos.push(fallo('texto', m.textoPequenoTotal, m.textoPequeno));
  if (m.grandes.length > 0) fallos.push(fallo('grande', m.grandes.length, m.grandes));
  return fallos.sort((a, b) => b.puntos - a.puntos);
}

export const puntuacion = (fallos: readonly Fallo[]) => fallos.reduce((s, f) => s + f.puntos, 0);

// ---------------------------------------------------------------- informe

export type EstadoArnes = {
  alias: string;
  fichero: string;
  cubre: string;
  estado: 'ok' | 'parcial' | 'no-arranco' | 'omitido';
  codigo: number | null;
  segundos: number;
  paginas: string[];
  motivo?: string;
};

export type Fila = Registro & { fallos: Fallo[]; puntos: number };

export function evaluar(registros: readonly Registro[]): Fila[] {
  return registros
    .map((r) => {
      const fallos = calcularFallos(r);
      return { ...r, fallos, puntos: puntuacion(fallos) };
    })
    .sort((a, b) => b.puntos - a.puntos || a.pagina.localeCompare(b.pagina) || a.variante.localeCompare(b.variante));
}

/** Las n peores, con como mucho `porPagina` variantes de cada página para que no las acapare una sola. */
export function peores<T extends { pagina: string; puntos: number }>(filas: readonly T[], n = 20, porPagina = 3): T[] {
  const cuenta = new Map<string, number>();
  const r: T[] = [];
  for (const f of filas) {
    if (f.puntos <= 0 || r.length >= n) continue;
    const k = cuenta.get(f.pagina) ?? 0;
    if (k >= porPagina) continue;
    cuenta.set(f.pagina, k + 1);
    r.push(f);
  }
  return r;
}

const celda = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');

export function informeMarkdown(o: { generado: string; modo: string; variantes: readonly Variante[]; arneses: readonly EstadoArnes[]; filas: readonly Fila[] }): string {
  const { filas } = o;
  const md: string[] = [];
  md.push(`# Matriz de dispositivos (${o.modo})`, '', `Generado: ${o.generado}. ${filas.length} capturas medidas en ${o.variantes.length} variantes: ${o.variantes.map((v) => v.clave).join(', ')}.`, '');
  md.push('## Arneses', '', '| Página | Arnés | Estado | Páginas | s | Motivo |', '|---|---|---|---|---|---|');
  for (const a of o.arneses) md.push(`| ${a.alias} | ${a.fichero} | ${a.estado} | ${a.paginas.length} | ${a.segundos} | ${celda(a.motivo ?? '')} |`);
  for (const s of SIN_ARNES) md.push(`| — | — | sin arnés | 0 | 0 | ${celda(s)} |`);
  md.push('');

  const tipos = Object.keys(ETIQUETAS) as TipoFallo[];
  md.push('## Resumen por tipo', '', '| Fallo | Capturas afectadas | Páginas | Peor dispositivo |', '|---|---|---|---|');
  for (const t of tipos) {
    const con = filas.filter((f) => f.fallos.some((x) => x.tipo === t));
    if (con.length === 0) continue;
    const porVariante = new Map<string, number>();
    for (const f of con) porVariante.set(f.variante, (porVariante.get(f.variante) ?? 0) + 1);
    const peor = [...porVariante].sort((a, b) => b[1] - a[1])[0]!;
    md.push(`| ${ETIQUETAS[t]} | ${con.length} | ${new Set(con.map((f) => f.pagina)).size} | ${peor[0]} (${peor[1]}) |`);
  }
  md.push('');

  md.push('## Peores 20', '', 'Como mucho tres dispositivos por página; la tabla completa va después.', '');
  peores(filas).forEach((f, i) => {
    md.push(`${i + 1}. **${f.pagina}** en **${f.variante}**: ${f.puntos} puntos${f.captura ? ` ([captura](${f.captura.replace(/\\/g, '/').replace(/^capturas\/matriz(-rapido)?\//, '')}))` : ''}`);
    for (const x of f.fallos.slice(0, 4)) md.push(`   - ${ETIQUETAS[x.tipo]} (${x.cuenta}): ${celda(x.ejemplos.slice(0, 2).join(' · ')).slice(0, 220)}`);
  });
  md.push('');

  md.push('## Fallos por página y dispositivo', '', 'Ordenado por puntuación. Cada celda es el número de casos.', '');
  md.push(`| Página | Dispositivo | Puntos | ${tipos.map((t) => ETIQUETAS[t]).join(' | ')} |`, `|---|---|---|${tipos.map(() => '---').join('|')}|`);
  for (const f of filas.filter((x) => x.puntos > 0)) {
    md.push(`| ${f.pagina} | ${f.variante} | ${f.puntos} | ${tipos.map((t) => f.fallos.find((x) => x.tipo === t)?.cuenta ?? '').join(' | ')} |`);
  }
  md.push('');

  const conFcp = filas.filter((f) => f.medida?.fcp != null);
  if (conFcp.length > 0) {
    md.push('## Primera pintura en el arnés (mediana por página, ms)', '', '| Página | FCP | CLS máx. |', '|---|---|---|');
    const porPagina = new Map<string, Fila[]>();
    for (const f of conFcp) porPagina.set(f.pagina, [...(porPagina.get(f.pagina) ?? []), f]);
    for (const [p, fs] of [...porPagina].sort()) {
      const xs = fs.map((f) => f.medida!.fcp!).sort((a, b) => a - b);
      md.push(`| ${p} | ${Math.round(xs[Math.floor(xs.length / 2)]!)} | ${Math.max(...fs.map((f) => f.medida!.cls))} |`);
    }
    md.push('');
  }
  return md.join('\n');
}
