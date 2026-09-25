import * as cheerio from 'cheerio';
import type { CredencialesSkermo } from './credentials';

/**
 * Fase 10 (opcional): envío directo de inscripciones a Skermo.
 *
 * QUÉ ES Y QUÉ NO ES
 * ------------------
 * Esto manda LA MISMA petición HTTP que manda el formulario de Skermo,
 * autenticada con las credenciales del propio club, que ya está autorizado a
 * hacer esa inscripción. No es suplantación: el sujeto autorizado es el mismo
 * y la acción es la que él acaba de aprobar. Lo único que cambia es que el
 * clic lo da nuestra interfaz en vez de la suya.
 *
 * SITUACIÓN VERIFICADA (25/09/2026)
 * ---------------------------------
 * - `app.skermo.org` es Laravel con formularios renderizados en servidor y
 *   plantilla AdminLTE en el acceso. Por tanto: POST con cookie de sesión y,
 *   casi con certeza, token CSRF oculto (`_token`, que SÍ se ha visto en el
 *   formulario público de exportación).
 * - Sus términos son una plantilla auto-generada con el plugin `wpautoterms`:
 *   NO prohíben scraping, ni acceso automatizado, ni clientes de terceros. Su
 *   robots.txt permite todo. El riesgo legal es bajo.
 * - Lo que NO se puede averiguar desde fuera es el endpoint de inscripción,
 *   que está tras autenticación. Por eso `CONFIGURACION_ENVIO` está a null y
 *   señalizada: ver el procedimiento documentado ahí mismo.
 *
 * REGLAS QUE NO SE NEGOCIAN
 * -------------------------
 * 1. MODO SIMULACIÓN por defecto (`SKERMO_SUBMIT_DRY_RUN=true`): se construye
 *    la petición, se registra en `submission` con estado 'dry_run' y NO SE
 *    ENVÍA NADA. Ni siquiera se hace login. Así se compara byte a byte contra
 *    lo que hace el navegador antes de tocar datos reales.
 * 2. Idempotencia: `submission` es única por `entryId`. Una inscripción no
 *    puede enviarse dos veces.
 * 3. NUNCA envío automático masivo: hay que pasar explícitamente
 *    `triggeredByProfileId`. Si falta, la función lanza. Un humano decide
 *    siempre, y queda por escrito quién fue.
 * 4. Sin `verifyEntry` (releer el listado y comprobar que la inscripción
 *    aparece) no se puede afirmar que el envío fue correcto. Un HTTP 200 de
 *    Laravel no significa nada: puede ser el formulario devuelto con errores.
 * 5. Si Skermo cambia el formulario, esto falla de forma VISIBLE: estado
 *    'failed' con `lastError`, nunca en silencio. Y el export CSV sigue siendo
 *    el respaldo: no se retira del producto.
 * 6. Las credenciales no se registran jamás. `requestSnapshot` pasa por
 *    `sanearParaRegistro` antes de guardarse.
 */

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

export const SKERMO_BASE_URL_POR_DEFECTO = 'https://app.skermo.org';

export function skermoBaseUrl(): string {
  return (process.env.SKERMO_BASE_URL || SKERMO_BASE_URL_POR_DEFECTO).replace(/\/+$/, '');
}

/** Formulario de acceso. Esta ruta sí es pública y está comprobada. */
export const RUTA_ACCESO = '/login';

export type CamposInscripcionSkermo = {
  /** Nombre del campo del formulario que lleva el id de la competición. */
  competicion: string | null;
  /** Nombre del campo con el número de licencia del tirador. */
  licencia: string | null;
  nombre: string | null;
  apellidos: string | null;
  fechaNacimiento: string | null;
  club: string | null;
};

export type ConfiguracionEnvioSkermo = {
  /** Mientras sea `false`, `submitEntry` se niega a ENVIAR (simular sí puede). */
  configurado: boolean;
  /** Ruta del formulario de inscripción (para leer el `_token` fresco). */
  rutaFormulario: string | null;
  /** Ruta a la que el formulario hace POST. */
  rutaEnvio: string | null;
  /** Ruta del listado de inscritos, para la verificación posterior. */
  rutaListado: string | null;
  campos: CamposInscripcionSkermo;
  /** Campos fijos que el formulario manda siempre igual (p. ej. `action=add`). */
  camposFijos: Record<string, string>;
};

/**
 * =========================================================================
 *  PENDIENTE DE CONFIGURAR. AQUÍ NO HAY NINGÚN ENDPOINT REAL.
 * =========================================================================
 *
 * Todo está a `null` a propósito. Inventarse una ruta que "parezca" la buena
 * (`/entries/store`, `/inscripciones/nueva`...) sería lo peor que se puede
 * hacer: daría la impresión de estar terminado, alguien activaría el envío
 * real y mandaría POSTs a ciegas contra un servidor ajeno. Mientras
 * `configurado` sea `false`, `submitEntry` SIMULA pero se NIEGA a enviar.
 *
 * CÓMO OBTENER LOS VALORES REALES (hacen falta 5 minutos y una cuenta de club):
 *
 *   1. Abre Skermo en el navegador e inicia sesión con la cuenta del club.
 *   2. Abre las herramientas de desarrollo (F12) y ve a la pestaña "Red"
 *      ("Network"). Marca "Conservar registro" / "Preserve log".
 *   3. Haz UNA inscripción real, de verdad, hasta el final.
 *   4. En la lista de peticiones busca la de método POST que se dispara al
 *      pulsar "Inscribir" (normalmente la última antes de la redirección).
 *   5. Clic derecho sobre ella -> "Copiar como cURL" ("Copy as cURL").
 *   6. ANTES DE PASARLO A NADIE, quita del texto copiado:
 *        - la cabecera `Cookie:` entera (lleva la sesión activa),
 *        - cualquier campo con la contraseña,
 *        - el valor de `_token` (es de un solo uso y va atado a la sesión).
 *      El resto (la URL y los NOMBRES de los campos) es lo que hace falta.
 *   7. Rellena aquí `rutaEnvio`, `rutaFormulario`, `rutaListado` y los nombres
 *      de `campos`, y pon `configurado: true`.
 *   8. Deja `SKERMO_SUBMIT_DRY_RUN=true` y compara el `requestSnapshot` que
 *      queda en la tabla `submission` con el cURL que copiaste. Cuando
 *      coincidan campo por campo, y solo entonces, se puede pensar en enviar.
 */
export const CONFIGURACION_ENVIO: ConfiguracionEnvioSkermo = {
  configurado: false,
  rutaFormulario: null,
  rutaEnvio: null,
  rutaListado: null,
  campos: {
    competicion: null,
    licencia: null,
    nombre: null,
    apellidos: null,
    fechaNacimiento: null,
    club: null,
  },
  camposFijos: {},
};

// ---------------------------------------------------------------------------
// Interruptores
// ---------------------------------------------------------------------------

export type ModoEnvio = { activo: boolean; simulacion: boolean };

/**
 * `simulacion` solo es `false` si alguien pone expresamente
 * `SKERMO_SUBMIT_DRY_RUN="false"`. Cualquier otro valor, incluida la variable
 * sin definir, significa simular. El fallo seguro es no enviar.
 */
export function leerModoEnvio(): ModoEnvio {
  return {
    activo: process.env.SKERMO_SUBMIT_ENABLED === 'true',
    simulacion: process.env.SKERMO_SUBMIT_DRY_RUN !== 'false',
  };
}

// ---------------------------------------------------------------------------
// Saneado de lo que se registra
// ---------------------------------------------------------------------------

const CLAVES_SECRETAS =
  /(pass|passwd|password|clave|contrase|secret|token|cookie|authorization|auth|session)/i;

/**
 * Quita de un objeto cualquier cosa que huela a credencial ANTES de guardarlo
 * en `submission.requestSnapshot`.
 *
 * Es una lista negra por nombre de clave, que es una defensa imperfecta; por
 * eso además la construcción de la petición nunca mete la contraseña en el
 * objeto que se registra (ver `construirPeticionInscripcion`). Esto es el
 * segundo cinturón, no el único.
 */
export function sanearParaRegistro(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(sanearParaRegistro);
  if (valor && typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[clave] = CLAVES_SECRETAS.test(clave) ? '[omitido]' : sanearParaRegistro(v);
    }
    return salida;
  }
  return valor;
}

// ---------------------------------------------------------------------------
// Sesión: login con cookie + token CSRF
// ---------------------------------------------------------------------------

export type SesionSkermo = {
  baseUrl: string;
  /** Valor listo para la cabecera `Cookie`. Nunca se registra. */
  cookieHeader: string;
  csrfToken: string;
  usuario: string;
};

/** Extrae el `_token` oculto del formulario (Laravel) o del meta de la página. */
export function leerTokenCsrf(html: string): string | null {
  const $ = cheerio.load(html);
  const enFormulario = $('input[name="_token"]').attr('value');
  if (enFormulario) return enFormulario;
  const enMeta = $('meta[name="csrf-token"]').attr('content');
  return enMeta || null;
}

/**
 * Nombres de los campos de usuario y contraseña LEÍDOS DEL PROPIO FORMULARIO.
 *
 * Laravel por defecto usa `email`, pero Skermo podría usar `username` o
 * `login`. Adivinarlo sería otra suposición más; el formulario lo dice, así
 * que se lee. Si el día de mañana cambia, esto lo detecta en vez de mandar un
 * POST con nombres de campo obsoletos.
 */
export function leerCamposDeAcceso(
  html: string,
): { usuario: string; password: string } | null {
  const $ = cheerio.load(html);
  const password = $('input[type="password"]').first().attr('name');
  if (!password) return null;
  const usuario = $('input[type="email"], input[type="text"]')
    .filter((_, el) => Boolean($(el).attr('name')))
    .first()
    .attr('name');
  if (!usuario) return null;
  return { usuario, password };
}

/** Acumula cookies de una respuesta sobre las que ya tuviéramos. */
function acumularCookies(previas: Map<string, string>, res: Response): Map<string, string> {
  const cabeceras = res.headers as Headers & { getSetCookie?: () => string[] };
  const crudas =
    typeof cabeceras.getSetCookie === 'function'
      ? cabeceras.getSetCookie()
      : ([res.headers.get('set-cookie')].filter(Boolean) as string[]);

  for (const cruda of crudas) {
    const primerPar = cruda.split(';')[0];
    const igual = primerPar.indexOf('=');
    if (igual <= 0) continue;
    previas.set(primerPar.slice(0, igual).trim(), primerPar.slice(igual + 1).trim());
  }
  return previas;
}

function cabeceraCookie(cookies: Map<string, string>): string {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export type OpcionesRed = {
  /** Inyectable para los tests: así se puede afirmar "no hubo red". */
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
};

function agenteUsuario(): string {
  return process.env.INGEST_USER_AGENT || 'CalendarioEsgrima/1.0 (+contacto)';
}

/**
 * Inicia sesión: lee el formulario de acceso (cookie + `_token` + nombres de
 * campo) y hace el POST de credenciales.
 *
 * La contraseña entra por parámetro, se usa aquí y no se guarda en ningún
 * sitio ni se devuelve en el resultado. Lo que sale es una cookie de sesión.
 */
export async function login(
  credenciales: CredencialesSkermo,
  opciones: OpcionesRed = {},
): Promise<SesionSkermo> {
  const hacerFetch = opciones.fetchImpl ?? fetch;
  const baseUrl = (opciones.baseUrl ?? skermoBaseUrl()).replace(/\/+$/, '');
  const timeoutMs = opciones.timeoutMs ?? 30_000;
  const cookies = new Map<string, string>();

  const resFormulario = await hacerFetch(`${baseUrl}${RUTA_ACCESO}`, {
    headers: { 'User-Agent': agenteUsuario(), Accept: 'text/html' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'manual',
  });
  if (!resFormulario.ok) {
    throw new Error(
      `Skermo devolvió ${resFormulario.status} al pedir el formulario de acceso.`,
    );
  }
  acumularCookies(cookies, resFormulario);

  const html = await resFormulario.text();
  const token = leerTokenCsrf(html);
  if (!token) {
    // Fallo visible: si desaparece el `_token`, han cambiado el formulario.
    throw new Error(
      'No se encontró el token CSRF (input[name=_token]) en el formulario de acceso ' +
        'de Skermo. Probablemente hayan cambiado el formulario: revisa el parser ' +
        'antes de volver a intentarlo.',
    );
  }

  const nombresCampo = leerCamposDeAcceso(html) ?? { usuario: 'email', password: 'password' };

  const cuerpo = new URLSearchParams({
    _token: token,
    [nombresCampo.usuario]: credenciales.usuario,
    [nombresCampo.password]: credenciales.password,
  });

  const resAcceso = await hacerFetch(`${baseUrl}${RUTA_ACCESO}`, {
    method: 'POST',
    headers: {
      'User-Agent': agenteUsuario(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cabeceraCookie(cookies),
      Referer: `${baseUrl}${RUTA_ACCESO}`,
    },
    body: cuerpo.toString(),
    signal: AbortSignal.timeout(timeoutMs),
    // Laravel responde 302 al panel cuando el acceso es correcto.
    redirect: 'manual',
  });
  acumularCookies(cookies, resAcceso);

  const correcto = resAcceso.status >= 300 && resAcceso.status < 400;
  if (!correcto) {
    throw new Error(
      `El acceso a Skermo no fue correcto (HTTP ${resAcceso.status}). Revisa el ` +
        'usuario y la contraseña; no se han registrado en ningún sitio.',
    );
  }

  return {
    baseUrl,
    cookieHeader: cabeceraCookie(cookies),
    csrfToken: token,
    usuario: credenciales.usuario,
  };
}

// ---------------------------------------------------------------------------
// Construcción de la petición
// ---------------------------------------------------------------------------

export type DatosInscripcion = {
  /** Id de la competición en Skermo (el número del ancla `#detailNNNNN`). */
  competicionSkermoId: string;
  licencia: string;
  nombre: string;
  apellidos: string;
  fechaNacimiento?: string | null;
  clubCodigo?: string | null;
  /** Campos adicionales que descubra el cURL y aún no estén modelados. */
  extras?: Record<string, string>;
};

export type PeticionConstruida = {
  url: string | null;
  metodo: 'POST';
  /** Sin `Cookie`: la cookie se añade en el momento del envío, no antes. */
  cabeceras: Record<string, string>;
  campos: Record<string, string>;
  cuerpo: string;
  /** Qué falta por saber para poder enviar de verdad. */
  incompleto: string[];
};

/**
 * Construye la petición a partir de la configuración y los datos del tirador.
 *
 * Funciona aunque la configuración esté pendiente: en ese caso devuelve la URL
 * a `null` y la lista de lo que falta en `incompleto`. Eso es justo lo que
 * hace útil el modo simulación antes de conocer el endpoint: se ve la forma de
 * la petición y se ve exactamente qué falta.
 *
 * El `_token` NO se rellena aquí: es de un solo uso y va atado a la sesión, así
 * que se pide fresco justo antes de enviar. En el snapshot queda como marcador.
 */
export function construirPeticionInscripcion(
  datos: DatosInscripcion,
  opciones: {
    config?: ConfiguracionEnvioSkermo;
    baseUrl?: string;
    csrfToken?: string | null;
  } = {},
): PeticionConstruida {
  const config = opciones.config ?? CONFIGURACION_ENVIO;
  const baseUrl = (opciones.baseUrl ?? skermoBaseUrl()).replace(/\/+$/, '');
  const incompleto: string[] = [];

  if (!config.rutaEnvio) incompleto.push('rutaEnvio (URL del POST de inscripción)');

  const campos: Record<string, string> = {
    _token: opciones.csrfToken ?? '[se rellena con el token de la sesión]',
    ...config.camposFijos,
  };

  const mapeo: [keyof CamposInscripcionSkermo, string | null | undefined][] = [
    ['competicion', datos.competicionSkermoId],
    ['licencia', datos.licencia],
    ['nombre', datos.nombre],
    ['apellidos', datos.apellidos],
    ['fechaNacimiento', datos.fechaNacimiento],
    ['club', datos.clubCodigo],
  ];

  for (const [clave, valor] of mapeo) {
    const nombreCampo = config.campos[clave];
    if (!nombreCampo) {
      // Solo se reclama lo que de verdad hay que mandar: si no tenemos valor
      // para ese dato, que falte el nombre del campo da igual.
      if (valor) incompleto.push(`campos.${clave} (nombre del campo en el formulario)`);
      continue;
    }
    if (valor) campos[nombreCampo] = valor;
  }

  for (const [clave, valor] of Object.entries(datos.extras ?? {})) {
    campos[clave] = valor;
  }

  return {
    url: config.rutaEnvio ? `${baseUrl}${config.rutaEnvio}` : null,
    metodo: 'POST',
    cabeceras: {
      'User-Agent': agenteUsuario(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
    },
    campos,
    cuerpo: new URLSearchParams(campos).toString(),
    incompleto,
  };
}

// ---------------------------------------------------------------------------
// Persistencia en `submission`
// ---------------------------------------------------------------------------

export type EstadoEnvio = 'dry_run' | 'sent' | 'verified' | 'failed';

export type RegistroEnvio = {
  entryId: string;
  status: EstadoEnvio;
  requestSnapshot: unknown;
  responseStatus?: number | null;
  responseSnapshot?: string | null;
  verifiedAt?: Date | null;
  verificationNote?: string | null;
  lastError?: string | null;
  triggeredByProfileId: string;
};

export type RepositorioEnvios = {
  registrar(registro: RegistroEnvio): Promise<void>;
  /** ¿Ya hay un envío REAL (no simulado) para esta inscripción? */
  yaEnviada(entryId: string): Promise<boolean>;
};

/**
 * Repositorio real. Import dinámico de `@/db` a propósito: ese módulo lanza si
 * falta `DATABASE_URL`, y la construcción de la petición y el modo simulación
 * tienen que poder probarse sin base de datos.
 */
export function repositorioPorDefecto(): RepositorioEnvios {
  return {
    async registrar(registro) {
      const { db } = await import('@/db');
      const { submission } = await import('@/db/schema');
      const { sql } = await import('drizzle-orm');

      // `requestSnapshot` SIEMPRE saneado: es la última barrera antes de que
      // algo acabe escrito en una tabla que alguien exportará algún día.
      const snapshot = sanearParaRegistro(registro.requestSnapshot);

      await db
        .insert(submission)
        .values({
          entryId: registro.entryId,
          status: registro.status,
          requestSnapshot: snapshot,
          responseStatus: registro.responseStatus ?? null,
          responseSnapshot: registro.responseSnapshot ?? null,
          verifiedAt: registro.verifiedAt ?? null,
          verificationNote: registro.verificationNote ?? null,
          lastError: registro.lastError ?? null,
          attempts: 1,
          triggeredByProfileId: registro.triggeredByProfileId,
        })
        // Única por `entryId`: el segundo intento actualiza la misma fila y
        // suma un intento. Nunca crea una segunda inscripción.
        .onConflictDoUpdate({
          target: submission.entryId,
          set: {
            status: registro.status,
            requestSnapshot: snapshot,
            responseStatus: registro.responseStatus ?? null,
            responseSnapshot: registro.responseSnapshot ?? null,
            verifiedAt: registro.verifiedAt ?? null,
            verificationNote: registro.verificationNote ?? null,
            lastError: registro.lastError ?? null,
            attempts: sql`${submission.attempts} + 1`,
            triggeredByProfileId: registro.triggeredByProfileId,
            updatedAt: new Date(),
          },
        });
    },

    async yaEnviada(entryId) {
      const { db } = await import('@/db');
      const { submission } = await import('@/db/schema');
      const { and, eq, inArray } = await import('drizzle-orm');

      const filas = await db
        .select({ id: submission.id })
        .from(submission)
        .where(
          and(
            eq(submission.entryId, entryId),
            // 'dry_run' y 'failed' no bloquean: no llegaron a inscribir a nadie.
            inArray(submission.status, ['sent', 'verified']),
          ),
        )
        .limit(1);
      return filas.length > 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Verificación: releer el listado
// ---------------------------------------------------------------------------

export type ResultadoVerificacion = {
  encontrada: boolean;
  nota: string;
};

/** Marcas diacríticas combinantes, por punto de código (ver ai/extract.ts). */
const RE_DIACRITICOS = new RegExp(
  `[${String.fromCodePoint(0x0300)}-${String.fromCodePoint(0x036f)}]`,
  'gu',
);

/**
 * Vuelve a LEER el listado de inscritos y comprueba que el tirador aparece.
 *
 * Sin esto no se puede afirmar que el envío fue correcto: Laravel devuelve
 * 200 tanto cuando guarda como cuando te repinta el formulario con errores de
 * validación. La única prueba es que el nombre esté en la lista.
 */
export async function verifyEntry(
  sesion: SesionSkermo,
  datos: DatosInscripcion,
  opciones: { config?: ConfiguracionEnvioSkermo; fetchImpl?: typeof fetch } = {},
): Promise<ResultadoVerificacion> {
  const config = opciones.config ?? CONFIGURACION_ENVIO;
  const hacerFetch = opciones.fetchImpl ?? fetch;

  if (!config.rutaListado) {
    return {
      encontrada: false,
      nota:
        'No se puede verificar: falta la ruta del listado de inscritos en ' +
        'CONFIGURACION_ENVIO. Mientras tanto, el envío no se da por bueno.',
    };
  }

  const url = `${sesion.baseUrl}${config.rutaListado.replace(
    '{competicion}',
    encodeURIComponent(datos.competicionSkermoId),
  )}`;

  const res = await hacerFetch(url, {
    headers: {
      'User-Agent': agenteUsuario(),
      Accept: 'text/html',
      Cookie: sesion.cookieHeader,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    return {
      encontrada: false,
      nota: `El listado de inscritos devolvió HTTP ${res.status}: no se puede verificar.`,
    };
  }

  const texto = cheerio.load(await res.text()).text();
  const normalizar = (v: string) =>
    v
      .normalize('NFD')
      .replace(RE_DIACRITICOS, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

  const listado = normalizar(texto);
  // La licencia es la clave fiable; el nombre solo como respaldo, porque hay
  // homónimos y acentos inconsistentes (mismo criterio que en resultados).
  const porLicencia =
    datos.licencia.length > 0 &&
    listado.includes(normalizar(datos.licencia).replace(/\s/g, ''));
  const porNombre = listado.includes(normalizar(`${datos.nombre} ${datos.apellidos}`));

  if (porLicencia) {
    return { encontrada: true, nota: `Licencia ${datos.licencia} encontrada en el listado.` };
  }
  if (porNombre) {
    return {
      encontrada: true,
      nota:
        'Encontrado por nombre y apellidos (la licencia no aparece en el listado): ' +
        'verificación más débil de lo deseable.',
    };
  }
  return {
    encontrada: false,
    nota: 'La inscripción NO aparece en el listado tras el envío.',
  };
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

export type ResultadoEnvio =
  | { estado: 'desactivado'; motivo: string }
  | { estado: 'ya_enviada'; motivo: string }
  | { estado: 'dry_run'; peticion: PeticionConstruida; snapshot: unknown; motivo: string }
  | {
      estado: 'sent' | 'verified';
      peticion: PeticionConstruida;
      snapshot: unknown;
      responseStatus: number;
      verificacion: ResultadoVerificacion;
    }
  | { estado: 'failed'; motivo: string; snapshot: unknown; responseStatus?: number };

export type OpcionesEnvio = {
  entryId: string;
  /**
   * Quién ha aprobado este envío concreto. OBLIGATORIO y sin valor por
   * defecto: es lo que impide que esto se convierta en un envío automático
   * masivo. Un humano decide siempre, y su id queda en `submission`.
   */
  triggeredByProfileId: string;
  datos: DatosInscripcion;
  /** Necesarias solo para el envío real. En simulación no se piden. */
  credenciales?: CredencialesSkermo;
  config?: ConfiguracionEnvioSkermo;
  repositorio?: RepositorioEnvios;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  modo?: ModoEnvio;
};

/**
 * Envía (o simula) una inscripción.
 *
 * El camino de simulación no hace NI UNA petición de red: ni login, ni POST,
 * ni verificación. Construye, sanea, registra 'dry_run' y termina. Esa es la
 * razón de que `construirPeticionInscripcion` no necesite sesión.
 */
export async function submitEntry(opciones: OpcionesEnvio): Promise<ResultadoEnvio> {
  const {
    entryId,
    triggeredByProfileId,
    datos,
    credenciales,
    config = CONFIGURACION_ENVIO,
  } = opciones;

  if (!triggeredByProfileId || !triggeredByProfileId.trim()) {
    // Se lanza en vez de devolver un error: llamar a esto sin decir quién lo
    // aprueba es un fallo de programación, no una situación esperable.
    throw new Error(
      'submitEntry exige triggeredByProfileId: hay que decir explícitamente qué ' +
        'persona aprueba este envío. No existe el envío automático sin aprobación.',
    );
  }

  const modo = opciones.modo ?? leerModoEnvio();
  const repositorio = opciones.repositorio ?? repositorioPorDefecto();
  const baseUrl = (opciones.baseUrl ?? skermoBaseUrl()).replace(/\/+$/, '');

  if (!modo.activo) {
    return {
      estado: 'desactivado',
      motivo:
        'SKERMO_SUBMIT_ENABLED no está a "true": el envío directo está apagado. El ' +
        'export CSV sigue siendo la vía válida.',
    };
  }

  // Idempotencia antes que nada: si ya se envió, no se toca la red.
  if (await repositorio.yaEnviada(entryId)) {
    return {
      estado: 'ya_enviada',
      motivo: `La inscripción ${entryId} ya tiene un envío registrado. No se repite.`,
    };
  }

  const peticion = construirPeticionInscripcion(datos, { config, baseUrl });
  const snapshotBase = {
    url: peticion.url,
    metodo: peticion.metodo,
    cabeceras: peticion.cabeceras,
    campos: peticion.campos,
    incompleto: peticion.incompleto,
    configurado: config.configurado,
  };
  const snapshot = sanearParaRegistro(snapshotBase);

  // ---------------- Modo simulación (por defecto) ----------------
  if (modo.simulacion) {
    await repositorio.registrar({
      entryId,
      status: 'dry_run',
      requestSnapshot: snapshot,
      triggeredByProfileId,
      verificationNote:
        'Simulación: la petición se construyó y se registró, pero NO se envió.',
    });
    return {
      estado: 'dry_run',
      peticion,
      snapshot,
      motivo:
        'SKERMO_SUBMIT_DRY_RUN activo: petición construida y registrada sin enviar. ' +
        'Compárala con el cURL copiado del navegador antes de desactivar la simulación.',
    };
  }

  // ---------------- Envío real ----------------
  if (!config.configurado || !config.rutaEnvio || peticion.incompleto.length > 0) {
    const motivo =
      'No se envía: el endpoint de inscripción de Skermo todavía no está configurado. ' +
      `Falta por saber: ${peticion.incompleto.join(', ') || 'la URL del POST'}. ` +
      'Mira el procedimiento del F12 documentado en CONFIGURACION_ENVIO.';
    await repositorio.registrar({
      entryId,
      status: 'failed',
      requestSnapshot: snapshot,
      lastError: motivo,
      triggeredByProfileId,
    });
    return { estado: 'failed', motivo, snapshot };
  }

  if (!credenciales) {
    const motivo =
      'No se envía: faltan las credenciales de Skermo del club. Por diseño no se ' +
      'guardan salvo que el club lo pida, así que hay que teclearlas al aprobar.';
    await repositorio.registrar({
      entryId,
      status: 'failed',
      requestSnapshot: snapshot,
      lastError: motivo,
      triggeredByProfileId,
    });
    return { estado: 'failed', motivo, snapshot };
  }

  const hacerFetch = opciones.fetchImpl ?? fetch;

  try {
    const sesion = await login(credenciales, { fetchImpl: hacerFetch, baseUrl });

    // Token fresco del propio formulario de inscripción cuando se conoce su
    // ruta: el de la pantalla de acceso puede haber rotado tras el login.
    let token = sesion.csrfToken;
    if (config.rutaFormulario) {
      const resForm = await hacerFetch(`${baseUrl}${config.rutaFormulario}`, {
        headers: {
          'User-Agent': agenteUsuario(),
          Accept: 'text/html',
          Cookie: sesion.cookieHeader,
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resForm.ok) {
        throw new Error(
          `El formulario de inscripción devolvió HTTP ${resForm.status}.`,
        );
      }
      const tokenFresco = leerTokenCsrf(await resForm.text());
      if (!tokenFresco) {
        throw new Error(
          'El formulario de inscripción ya no trae input[name=_token]: Skermo ha ' +
            'cambiado el formulario. Se aborta el envío.',
        );
      }
      token = tokenFresco;
    }

    const definitiva = construirPeticionInscripcion(datos, {
      config,
      baseUrl,
      csrfToken: token,
    });
    const snapshotFinal = sanearParaRegistro({
      url: definitiva.url,
      metodo: definitiva.metodo,
      cabeceras: definitiva.cabeceras,
      campos: definitiva.campos,
      incompleto: definitiva.incompleto,
      configurado: config.configurado,
    });

    const res = await hacerFetch(definitiva.url as string, {
      method: 'POST',
      headers: {
        ...definitiva.cabeceras,
        Cookie: sesion.cookieHeader,
        Referer: `${baseUrl}${config.rutaFormulario ?? RUTA_ACCESO}`,
      },
      body: definitiva.cuerpo,
      signal: AbortSignal.timeout(45_000),
      redirect: 'manual',
    });

    const cuerpoRespuesta = (await res.text()).slice(0, 2_000);

    // Un 200 con el formulario dentro es un RECHAZO repintado, no un éxito.
    // Se comprueba, porque dar por buena esa respuesta es exactamente el
    // fallo silencioso que no queremos.
    const pareceFormularioDevuelto = /name=["']_token["']/.test(cuerpoRespuesta);
    if (res.status >= 400 || (res.status === 200 && pareceFormularioDevuelto)) {
      const motivo =
        `Skermo respondió ${res.status} y la respuesta parece el formulario ` +
        'devuelto con errores, no una inscripción guardada.';
      await repositorio.registrar({
        entryId,
        status: 'failed',
        requestSnapshot: snapshotFinal,
        responseStatus: res.status,
        responseSnapshot: cuerpoRespuesta,
        lastError: motivo,
        triggeredByProfileId,
      });
      return { estado: 'failed', motivo, snapshot: snapshotFinal, responseStatus: res.status };
    }

    const verificacion = await verifyEntry(sesion, datos, { config, fetchImpl: hacerFetch });
    const estado: EstadoEnvio = verificacion.encontrada ? 'verified' : 'sent';

    await repositorio.registrar({
      entryId,
      status: estado,
      requestSnapshot: snapshotFinal,
      responseStatus: res.status,
      responseSnapshot: cuerpoRespuesta,
      verifiedAt: verificacion.encontrada ? new Date() : null,
      verificationNote: verificacion.nota,
      // 'sent' sin verificar NO es un éxito: se deja escrito el porqué.
      lastError: verificacion.encontrada ? null : verificacion.nota,
      triggeredByProfileId,
    });

    return {
      estado,
      peticion: definitiva,
      snapshot: snapshotFinal,
      responseStatus: res.status,
      verificacion,
    };
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    await repositorio.registrar({
      entryId,
      status: 'failed',
      requestSnapshot: snapshot,
      lastError: motivo,
      triggeredByProfileId,
    });
    return { estado: 'failed', motivo, snapshot };
  }
}
