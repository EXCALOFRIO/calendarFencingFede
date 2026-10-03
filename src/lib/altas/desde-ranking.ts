import { and, eq, or, sql } from 'drizzle-orm';
import { enLista as inArray, textoSinAcentos } from '@/lib/sqlite';
import { db, type Db } from '@/db';
import { nowMilliseconds } from '@/db/d1/columns';
import {
  athlete,
  club,
  officialRankingEntry,
  userProfile,
} from '@/db/schema';
import { titular, yearFromIsoDate } from '@/lib/utils';
import { normalizarLicencia, sinAcentos } from './texto';
import { solicitarVinculo } from './solicitudes';
import {
  type AprobacionVinculo,
  aprobacionVigente,
  cierreAprobacion,
  cuentaSinFicha,
  escribirVinculoAtomico,
  evidenciaValida,
  exigirUnCambio,
} from './vinculo-atomico';
import { requiresGuardianAccount } from '@/lib/categories';

/**
 * Alta de un tirador a partir del ranking oficial de la RFEE.
 *
 * Es el único sitio donde se crea una ficha con los datos de Skermo, y lo usan
 * las dos puertas que existen: la pantalla `/alta`, que es la que ve una
 * persona, y `scripts/alta-desde-ranking.ts`, que es la que usa la dirección
 * técnica desde la línea de órdenes. Estaban separadas y esto las une a
 * propósito: si la regla de negocio vive en dos sitios, en un mes hacen cosas
 * distintas.
 *
 * -------------------------------------------------------------------------
 * LOS DATOS NO LOS TECLEA NADIE
 * -------------------------------------------------------------------------
 * Nombre, apellidos, fecha de nacimiento, club, arma, género y licencia salen
 * de la fila de `official_ranking_entry`, que es una copia fiel de lo que
 * publica `app.skermo.org/ranking-rfee/public/RFEE`. Una licencia tecleada
 * ayuda a encontrar la fila, pero no se guarda como prueba de identidad.
 *
 * -------------------------------------------------------------------------
 * LA LICENCIA NO CONCEDE PROPIEDAD
 * -------------------------------------------------------------------------
 * La tabla del ranking publica puesto, nombre, fecha de nacimiento, club y
 * puntos — pero **no la licencia** (eso lo dice el comentario del esquema y es
 * la razón de que `source_license` se rellene a posteriori, ficha a ficha).
 * No es un secreto criptográfico: conocerla no autoriza a gestionar la ficha.
 * El autoservicio guarda una solicitud pendiente. La dirección técnica debe
 * verificar la identidad por una vía independiente. El enlace se escribe
 * atómicamente junto a las armas, las fuentes y el rastro de aprobación.
 */

export type Arma = 'FLORETE' | 'ESPADA' | 'SABLE';
export type Genero = 'M' | 'F' | 'MIXTO';

/** Un tirador dentro de un ranking concreto: su puesto y sus puntos. */
export type ClasificacionOficial = {
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  /** Literal de la fuente: «VET50» se normaliza a VET y aquí queda el original. */
  categoriaOriginal: string;
  /** `null` si todavía no está clasificado (Skermo lo marca 9999). */
  puesto: number | null;
  puntos: number | null;
  urlFuente: string | null;
};

/**
 * Un resultado de la búsqueda.
 *
 * Trae **todo lo que hace falta para distinguir a dos homónimos** —arma,
 * género, categoría, club, año de nacimiento y puesto— y nada más. En concreto
 * NO trae la licencia ni la fecha completa: no son necesarias para reconocer
 * la fila ni deben viajar al navegador de quien escriba un apellido.
 */
export type Candidato = {
  /** Clave estable del tirador en Skermo. No es la licencia. */
  clave: string;
  /** Nombre en forma de título: la fuente lo publica en MAYÚSCULAS. */
  nombre: string;
  /** Nombre y apellidos por separado, que es como los publica la fuente. */
  nombrePila: string;
  apellidos: string;
  /** El nombre tal y como lo publica la fuente, para poder auditarlo. */
  nombreOficial: string;
  anioNacimiento: number | null;
  club: string | null;
  /** Todas sus clasificaciones: puede estar en absoluto y en sub-23, o en dos armas. */
  clasificaciones: ClasificacionOficial[];
  armas: Arma[];
  /** La fuente no ha resuelto su licencia todavía: no se puede comprobar nada. */
  sinLicencia: boolean;
  /** Ya hay una ficha con esa licencia colgada de una cuenta. */
  yaVinculado: boolean;
};

/**
 * La fecha de nacimiento que publica la fuente para una fila del ranking.
 *
 * Existe porque el alta de `/admin/usuarios` tiene que poder **negarse antes
 * de crear nada** si la persona es menor de 14 años, y `Candidato` a propósito
 * solo lleva el año: es lo que basta para distinguir homónimos en una lista, y
 * mandar la fecha exacta de nacimiento de cientos de menores al navegador de
 * quien escriba un apellido no hace falta para eso.
 *
 * Aquí se pide UNA, la de la fila que ya se ha elegido, y se resuelve en el
 * servidor sin que salga de él.
 */
export async function nacimientoDeLaFila(clave: string): Promise<string | null> {
  const [fila] = await db
    .select({ nacimiento: officialRankingEntry.sourceBirthDate })
    .from(officialRankingEntry)
    .where(eq(officialRankingEntry.skermoAthleteId, clave))
    .limit(1);

  return fila?.nacimiento ?? null;
}

export type MotivoRechazo =
  | 'YA_TIENES_FICHA'
  | 'NO_ENCONTRADO'
  | 'SIN_LICENCIA_EN_LA_FUENTE'
  | 'LICENCIA_NO_COINCIDE'
  | 'YA_VINCULADO'
  | 'DEMASIADOS_INTENTOS'
  | 'REVISION_PENDIENTE'
  | 'SOLICITUD_PENDIENTE'
  | 'CUENTA_NO_ELEGIBLE'
  | 'VINCULO_CAMBIO';

export type Alta = {
  atletaId: string;
  nombre: string;
  licencia: string;
  club: string | null;
  fechaNacimiento: string;
  armas: Arma[];
  clasificaciones: ClasificacionOficial[];
  /** Cuántas filas del ranking oficial han quedado apuntando a la ficha. */
  filasEmparejadas: number;
};

export type ResultadoAlta =
  | { ok: true; alta: Alta }
  | { ok: false; motivo: MotivoRechazo; error: string };

/** El nombre de la fuente, en minúsculas y sin acentos, dentro de la consulta. */
const NOMBRE_LLANO = textoSinAcentos(officialRankingEntry.sourceAthleteName);

/** Mínimo de letras para buscar por nombre. Con una sale media federación. */
const MINIMO_NOMBRE = 3;

/**
 * Busca en el ranking oficial por nombre o por número de licencia.
 *
 * Por licencia la comparación es EXACTA y no por prefijo, a propósito: con
 * prefijos, este buscador sería una forma de ir adivinando licencias ajenas
 * letra a letra. Por nombre se exige que aparezcan todas las palabras
 * tecleadas, que es lo que hace útil escribir «maria mariño» cuando la fuente
 * publica «MARIA MARIÑO BLANCO».
 */
export async function buscarCandidatos(
  texto: string,
  tope = 8,
): Promise<Candidato[]> {
  const limpio = texto.trim();
  if (limpio.length === 0) return [];

  const palabras = sinAcentos(limpio).split(/\s+/).filter(Boolean);
  const licencia = normalizarLicencia(limpio);

  const porNombre =
    sinAcentos(limpio).replace(/\s+/g, '').length >= MINIMO_NOMBRE
      ? and(...palabras.map((p) => sql`${NOMBRE_LLANO} like ${`%${p}%`}`))
      : undefined;

  const porLicencia = sql`upper(${officialRankingEntry.sourceLicense}) = ${licencia}`;

  const filas = await db
    .select({
      clave: officialRankingEntry.skermoAthleteId,
      nombre: officialRankingEntry.sourceAthleteName,
      nombrePila: officialRankingEntry.sourceFirstName,
      apellidos: officialRankingEntry.sourceLastName,
      licencia: officialRankingEntry.sourceLicense,
      nacimiento: officialRankingEntry.sourceBirthDate,
      clubFuente: officialRankingEntry.sourceClub,
      temporada: officialRankingEntry.seasonLabel,
      arma: officialRankingEntry.weapon,
      genero: officialRankingEntry.gender,
      categoria: officialRankingEntry.category,
      categoriaOriginal: officialRankingEntry.categoryRaw,
      puesto: officialRankingEntry.position,
      puntos: officialRankingEntry.totalPoints,
      urlFuente: officialRankingEntry.sourceUrl,
    })
    .from(officialRankingEntry)
    .where(porNombre ? or(porLicencia, porNombre) : porLicencia)
    // Por nombre, para que agrupar sea estable; el puesto ordena dentro.
    .orderBy(
      officialRankingEntry.sourceAthleteName,
      sql`${officialRankingEntry.position} asc nulls last`,
    )
    // Un apellido muy común son unas pocas decenas de filas. El tope está para
    // que teclear «ma» no se traiga la tabla entera, no para recortar a nadie.
    .limit(240);

  if (filas.length === 0) return [];

  const porTirador = new Map<string, typeof filas>();
  for (const f of filas) {
    // Sin id de Skermo no hay clave estable; se cae a la licencia y, en último
    // término, al nombre. Hoy no pasa (las 1.235 filas lo traen), pero la fila
    // sin id no puede tumbar la búsqueda entera.
    const clave = f.clave ?? f.licencia ?? f.nombre;
    const lista = porTirador.get(clave) ?? [];
    lista.push(f);
    porTirador.set(clave, lista);
  }

  const elegidos = [...porTirador.entries()].slice(0, tope);

  /**
   * ¿Alguna de estas fichas tiene ya dueño? Se comprueba aquí y no al
   * confirmar para poder decirlo en la propia lista: enterarse de que la ficha
   * es de otro después de teclear la licencia es el peor momento posible.
   */
  const licencias = elegidos
    .map(([, lista]) => lista.find((f) => f.licencia)?.licencia)
    .filter((l): l is string => Boolean(l));

  const vinculadas = new Set<string>();
  if (licencias.length > 0) {
    const fichas = await db
      .select({
        rfeeLicense: athlete.rfeeLicense,
        userProfileId: athlete.userProfileId,
        guardianProfileId: athlete.guardianProfileId,
      })
      .from(athlete)
      .where(inArray(athlete.rfeeLicense, licencias));
    for (const f of fichas) {
      if (!f.rfeeLicense) continue;
      if (f.userProfileId || f.guardianProfileId) {
        vinculadas.add(normalizarLicencia(f.rfeeLicense));
      }
    }
  }

  return elegidos.map(([clave, lista]) => {
    const primera = lista[0];
    const licenciaFila = lista.find((f) => f.licencia)?.licencia ?? null;

    return {
      clave,
      nombre: nombreCompleto(primera),
      nombrePila: titular(primera.nombrePila?.trim() || ''),
      apellidos: titular(primera.apellidos?.trim() || ''),
      nombreOficial: primera.nombre,
      anioNacimiento: primera.nacimiento
        ? yearFromIsoDate(primera.nacimiento)
        : null,
      club: primera.clubFuente,
      armas: [...new Set(lista.map((f) => f.arma))],
      clasificaciones: lista.map(aClasificacion),
      sinLicencia: licenciaFila === null,
      yaVinculado: licenciaFila
        ? vinculadas.has(normalizarLicencia(licenciaFila))
        : false,
    };
  });
}

/**
 * Vincula la ficha de un tirador del ranking oficial a una cuenta.
 *
 * Devuelve el motivo del rechazo como código, no solo como frase: la pantalla
 * necesita distinguir «esa licencia no es» de «esa ficha ya tiene dueño» para
 * decir qué hacer en cada caso, y el guion de la línea de órdenes también.
 */
export async function vincularFichaDesdeRanking({
  profileId,
  clave,
  licencia,
  origen,
  evidencia,
  aprobacion,
  adminProfileId,
}: {
  profileId: string;
  /** La `clave` de un `Candidato` (el id del tirador en Skermo). */
  clave: string;
  /**
   * Dato opcional de búsqueda, nunca una credencial de propiedad.
   */
  licencia?: string;
  /**
   * De dónde viene el alta. Cambia la nota que queda en la ficha —para que en
   * `/admin/usuarios` se vea que no la creó la dirección técnica—, lo que se
   * escribe en `athlete.linked_via` y, solo en el guion de demostración, deja
   * el consentimiento firmado.
   *
   * `nombre` y `autoservicio` solo solicitan revisión. No modifican la ficha,
   * sus fuentes, armas, club o permisos.
   *
   * `direccion` es el alta desde `/admin/usuarios`. Como el guion, no pide
   * licencia: quien pulsa ES la autoridad que da de alta a la gente. Y a
   * diferencia del guion **no da por firmado el consentimiento**, que en el
   * guion es una comodidad de la demostración y aquí sería falsificar un
   * documento que nadie ha firmado. Sale en «Qué te falta» hasta que se firme.
   */
  origen: 'autoservicio' | 'guion' | 'nombre' | 'direccion';
  /** Qué escribió y qué fila reclamó. Obligatorio con `origen: 'nombre'`. */
  evidencia?: string;
  /** Always obtained from the writable admin session, never from form data. */
  adminProfileId?: string;
  aprobacion?: AprobacionVinculo;
}, database: Db = db): Promise<ResultadoAlta> {
  if (origen === 'nombre' || origen === 'autoservicio') {
    const solicitud = await solicitarVinculo({
      profileId, clave: `rfee:${clave}`, nombreEscrito: evidencia?.slice(0, 160) ?? '',
      ...(origen === 'autoservicio' ? { licencia: licencia ?? '' } : {}),
    }, database);
    return rechazoVinculo(solicitud.ok ? 'REVISION_PENDIENTE' : solicitud.motivo);
  }
  const actorId = aprobacion?.adminProfileId ?? adminProfileId;
  if (origen === 'direccion' && (!actorId || (aprobacion && !evidenciaValida(aprobacion)))) {
    return rechazoVinculo('CUENTA_NO_ELEGIBLE');
  }
  const [perfil] = await database.select({ id: userProfile.id }).from(userProfile)
    .where(and(eq(userProfile.id, profileId), eq(userProfile.role, 'athlete'),
      sql`${userProfile.inviteStatus} in ('pendiente','aceptada')`)).limit(1);
  if (!perfil) return rechazoVinculo('CUENTA_NO_ELEGIBLE');
  /**
   * Una ficha por cuenta. No es una limitación técnica: si una cuenta ya
   * gestiona un tirador, «búscate en el ranking» no es lo que necesita, y
   * dejarla reclamar una segunda ficha convierte esta pantalla en la forma
   * cómoda de colgarse la ficha de otro.
   */
  const [suya] = await database
    .select({ id: athlete.id, nombre: athlete.firstName })
    .from(athlete)
    .where(
      and(
        eq(athlete.active, true),
        or(
          eq(athlete.userProfileId, profileId),
          eq(athlete.guardianProfileId, profileId),
        ),
      ),
    )
    .limit(1);

  if (suya) {
    return {
      ok: false,
      motivo: 'YA_TIENES_FICHA',
      error:
        'Tu cuenta ya tiene una ficha de tirador vinculada, así que no hay ' +
        'nada que dar de alta. Si la ficha no es la que te corresponde, ' +
        'escribe a la dirección técnica: cambiarla no es algo que deba poder ' +
        'hacer uno mismo.',
    };
  }

  const filas = await database
    .select({
      id: officialRankingEntry.id,
      atletaId: officialRankingEntry.athleteId,
      nombre: officialRankingEntry.sourceAthleteName,
      nombrePila: officialRankingEntry.sourceFirstName,
      apellidos: officialRankingEntry.sourceLastName,
      licencia: officialRankingEntry.sourceLicense,
      nacimiento: officialRankingEntry.sourceBirthDate,
      clubFuente: officialRankingEntry.sourceClub,
      temporada: officialRankingEntry.seasonLabel,
      arma: officialRankingEntry.weapon,
      genero: officialRankingEntry.gender,
      categoria: officialRankingEntry.category,
      categoriaOriginal: officialRankingEntry.categoryRaw,
      puesto: officialRankingEntry.position,
      puntos: officialRankingEntry.totalPoints,
      urlFuente: officialRankingEntry.sourceUrl,
    })
    .from(officialRankingEntry)
    .where(eq(officialRankingEntry.skermoAthleteId, clave))
    .orderBy(sql`${officialRankingEntry.position} asc nulls last`);

  if (filas.length === 0) {
    return {
      ok: false,
      motivo: 'NO_ENCONTRADO',
      error:
        'Esa fila del ranking ya no está. Vuelve a buscarte: la clasificación ' +
        'oficial se relee cada noche y puede haber cambiado.',
    };
  }

  const licenciaOficial = filas.find((f) => f.licencia)?.licencia ?? null;

  if (!licenciaOficial && origen === 'guion') {
    return {
      ok: false,
      motivo: 'SIN_LICENCIA_EN_LA_FUENTE',
      error:
        'De esta fila todavía no tenemos el número de licencia, así que no hay ' +
        'nada con lo que comprobar que eres tú, ni con qué emparejar el resto ' +
        'de tus clasificaciones. Pídele la vinculación a la dirección técnica.',
    };
  }

  const primera = filas[0];

  // La fecha de nacimiento es obligatoria en la ficha y la fuente la publica
  // siempre. Si algún día faltase, se dice; no se inventa un 1900-01-01.
  if (!primera.nacimiento) {
    return {
      ok: false,
      motivo: 'SIN_LICENCIA_EN_LA_FUENTE',
      error:
        'La clasificación oficial no publica tu fecha de nacimiento, y sin ella ' +
        'no se puede derivar tu categoría. Pídele la vinculación a la dirección ' +
        'técnica.',
    };
  }

  /**
   * ¿Existe ya una ficha con esa licencia? Puede pasar de dos formas: la creó
   * la dirección técnica y está libre (entonces se adopta, no se duplica: la
   * licencia es única en `athlete`), o ya tiene dueño (entonces rebota).
   */
  const licenciaLlana = licenciaOficial ? normalizarLicencia(licenciaOficial) : null;

  /**
   * Sin licencia no se puede preguntar por licencia. Y NO se pregunta por el
   * nombre para salir del paso: eso es exactamente el emparejado automático
   * que el proyecto prohíbe. Lo que sí hay es la fila del ranking que se
   * reclamó, y a esa se le puede preguntar si ya apunta a una ficha, porque si
   * apunta es un enlace que alguien decidió antes.
   */
  const existente = licenciaLlana
    ? await fichaPorLicencia(licenciaLlana, database)
    : await fichaDeLaFilaDelRanking(clave, database);

  if (
    existente &&
    (existente.userProfileId !== null || existente.guardianProfileId !== null)
  ) {
    return {
      ok: false,
      motivo: 'YA_VINCULADO',
      error:
        'Esa ficha ya está vinculada a otra cuenta. Si crees que la cuenta es ' +
        'tuya, entra con ella; si no, escribe a la dirección técnica para que ' +
        'lo revise. Desde aquí no se le quita una ficha a nadie.',
    };
  }

  const nombrePila = titular(primera.nombrePila?.trim() || '');
  const apellidos = titular(primera.apellidos?.trim() || '');
  const nombre = `${nombrePila} ${apellidos}`.trim() || titular(primera.nombre);

  /**
   * El club se crea si no existe, con el código tal y como lo publica Skermo:
   * `FED-M-C` no es un nombre bonito, pero es el que permite cruzarlo después.
   * No se traduce ni se adorna.
   */
  if (requiresGuardianAccount(primera.nacimiento)) return rechazoVinculo('CUENTA_NO_ELEGIBLE');
  if (filas.some((fila) => fila.atletaId && fila.atletaId !== existente?.id)) {
    return rechazoVinculo('YA_VINCULADO');
  }
  const { clubId, crearClub } = await clubDe(primera.clubFuente, database);

  const nota = origen === 'direccion'
    ? 'Vinculación aprobada por la dirección técnica con los datos del ranking oficial de la RFEE.'
    : 'Alta creada a partir del ranking oficial de la RFEE con scripts/alta-desde-ranking.ts.';
  const atletaId = existente?.id ?? crypto.randomUUID();
  const claveFuente = `rfee:${clave}`;
  const prueba = aprobacion?.evidencia.trim() ?? evidencia ??
    `Alta creada por la dirección técnica desde la fila ${clave} del ranking oficial.`;
  const aprobada = aprobacion ? aprobacionVigente(aprobacion, profileId, claveFuente)
    : origen === 'direccion' ? sql`exists (select 1 from user_profile where id = ${actorId!}
        and role = 'admin' and invite_status in ('pendiente','aceptada'))` : sql`1 = 1`;
  const fuenteVigente = sql`exists (select 1 from official_ranking_entry
      where id = ${primera.id} and skermo_athlete_id = ${clave}
        and source_license is ${primera.licencia} and source_birth_date = ${primera.nacimiento})
    and not exists (select 1 from official_ranking_entry where skermo_athlete_id = ${clave}
      and athlete_id is not null and athlete_id <> ${atletaId})`;
  const condicion = sql`${cuentaSinFicha(profileId)} and ${aprobada} and ${fuenteVigente}`;
  const propiedad = existente ? sql`update athlete set user_profile_id = ${profileId},
    club_id = ${clubId}, notes = ${existente.notes ? `${existente.notes} ${nota}` : nota},
    linked_via = 'direccion_tecnica', linked_at = ${nowMilliseconds},
    linked_by_profile_id = ${actorId ?? profileId}, linked_evidence = ${prueba},
    updated_at = ${nowMilliseconds}
    where id = ${atletaId} and active = 1 and user_profile_id is null
      and guardian_profile_id is null and ${condicion}`
    : sql`insert into athlete(id,first_name,last_name,birth_date,gender,club_id,rfee_license,
        consent_signed_at,user_profile_id,notes,linked_via,linked_at,linked_by_profile_id,linked_evidence)
      select ${atletaId},${nombrePila || nombre},${apellidos},${primera.nacimiento},
        ${primera.genero === 'F' ? 'F' : 'M'},${clubId},${licenciaLlana},
        ${origen === 'guion' ? nowMilliseconds : sql`null`},${profileId},${nota},
        'direccion_tecnica',${nowMilliseconds},${actorId ?? profileId},${prueba}
      where ${condicion} on conflict(rfee_license) do nothing`;

  /**
   * Las armas, que es lo que determina todo lo que ve en el calendario. Van
   * TODAS las de sus filas del ranking: quien puntúa en florete y en espada
   * compite en las dos, y dejarle una sola le esconde medio calendario.
   */
  const armas = [...new Set(filas.map((f) => f.arma))];
  const relacionadas = armas.map((arma) => sql`insert into athlete_weapon(athlete_id,weapon)
    values(${atletaId},${arma}) on conflict do nothing`);

  /**
   * Emparejar TODAS sus filas del ranking, no solo la que se buscó. Un tirador
   * puede estar en absoluto y en sub-23, o en dos armas.
   *
   * Solo se actualiza el ID de Skermo aprobado, nunca otros IDs por compartir
   * nombre o licencia en temporadas diferentes. No se confirma una fusión de
   * identidades nacionales/internacionales desde esta operación de permisos.
   */
  relacionadas.push(sql`update official_ranking_entry
    set athlete_id = ${atletaId}, updated_at = ${nowMilliseconds}
    where skermo_athlete_id = ${clave} and athlete_id is null returning id`);

  /**
   * El club en la cuenta, solo si no tenía ninguno y solo para tiradores y
   * tutores: a un seleccionador o a la dirección técnica el club no les cambia
   * lo que ven, pero tampoco hace falta tocárselo.
   */
  if (clubId) {
    relacionadas.push(sql`update user_profile set club_id = ${clubId}, updated_at = ${nowMilliseconds}
      where id = ${profileId} and club_id is null and role = 'athlete'`);
  }
  const guardada = await escribirVinculoAtomico([
    ...(crearClub ? [crearClub] : []), propiedad, exigirUnCambio, ...relacionadas,
    ...(aprobacion ? cierreAprobacion(aprobacion, profileId, claveFuente, atletaId) : []),
  ], database);
  if (!guardada) return rechazoVinculo('VINCULO_CAMBIO');

  return {
    ok: true,
    alta: {
      atletaId,
      nombre,
      licencia: licenciaLlana ?? '',
      club: primera.clubFuente,
      fechaNacimiento: primera.nacimiento,
      armas,
      clasificaciones: filas.map(aClasificacion),
      filasEmparejadas: guardada[(crearClub ? 1 : 0) + 2 + armas.length].rows.length,
    },
  };
}

/** La ficha que ya tiene esa licencia, si la hay. */
async function fichaPorLicencia(licenciaLlana: string, database: Db) {
  const [ficha] = await database
    .select({
      id: athlete.id,
      userProfileId: athlete.userProfileId,
      guardianProfileId: athlete.guardianProfileId,
      notes: athlete.notes,
    })
    .from(athlete)
    .where(sql`upper(${athlete.rfeeLicense}) = ${licenciaLlana}`)
    .limit(1);
  return ficha ?? null;
}

/**
 * La ficha a la que ya apunta esa fila del ranking, si alguna.
 *
 * Es el sustituto de la búsqueda por licencia cuando la fuente todavía no la
 * publica. No es emparejar por nombre: `official_ranking_entry.athlete_id` solo
 * lo rellena una licencia o una persona, así que si hay algo ahí es un enlace
 * que alguien ya decidió.
 */
async function fichaDeLaFilaDelRanking(clave: string, database: Db) {
  const [ficha] = await database
    .select({
      id: athlete.id,
      userProfileId: athlete.userProfileId,
      guardianProfileId: athlete.guardianProfileId,
      notes: athlete.notes,
    })
    .from(officialRankingEntry)
    .innerJoin(athlete, eq(athlete.id, officialRankingEntry.athleteId))
    .where(eq(officialRankingEntry.skermoAthleteId, clave))
    .limit(1);
  return ficha ?? null;
}

/** Busca el club por el código de la fuente y lo crea si no existe. */
async function clubDe(nombreFuente: string | null, database: Db) {
  if (!nombreFuente) return { clubId: null, crearClub: null };

  const [existente] = await database
    .select({ id: club.id })
    .from(club)
    .where(eq(club.name, nombreFuente))
    .limit(1);

  if (existente) return { clubId: existente.id, crearClub: null };
  const id = crypto.randomUUID();
  return { clubId: id, crearClub: sql`insert into club(id,name) values(${id},${nombreFuente})` };
}

function rechazoVinculo(motivo: MotivoRechazo): ResultadoAlta {
  const mensajes: Partial<Record<MotivoRechazo, string>> = {
    REVISION_PENDIENTE: 'Solicitud guardada. La dirección técnica debe verificar tu identidad antes de vincular la ficha.',
    SOLICITUD_PENDIENTE: 'Ya tienes otra solicitud pendiente. Espera su revisión o cancélala antes de elegir otra ficha.',
    CUENTA_NO_ELEGIBLE: 'Esta cuenta no puede recibir una ficha de tirador. Consulta a la dirección técnica.',
    VINCULO_CAMBIO: 'La ficha, la cuenta o la solicitud ha cambiado. No se ha vinculado nada; vuelve a revisarlo.',
  };
  return { ok: false, motivo, error: mensajes[motivo] ?? 'No se ha solicitado la vinculación. Revisa los datos con la dirección técnica.' };
}

type FilaRanking = {
  temporada: string;
  arma: Arma;
  genero: Genero;
  categoria: string;
  categoriaOriginal: string;
  puesto: number | null;
  puntos: string | null;
  urlFuente: string | null;
};

function aClasificacion(fila: FilaRanking): ClasificacionOficial {
  return {
    temporada: fila.temporada,
    arma: fila.arma,
    genero: fila.genero,
    categoria: fila.categoria,
    categoriaOriginal: fila.categoriaOriginal,
    puesto: fila.puesto,
    puntos: fila.puntos === null ? null : Number.parseFloat(fila.puntos),
    urlFuente: fila.urlFuente,
  };
}

/**
 * Nombre en forma de título.
 *
 * Skermo publica «CARLOS LLAVADOR FERNANDEZ» y se guarda «Carlos Llavador
 * Fernandez», que es como se escribe un nombre. El original queda intacto en la
 * fila del ranking, que no se toca.
 */
function nombreCompleto(fila: {
  nombre: string;
  nombrePila: string | null;
  apellidos: string | null;
}): string {
  const pila = titular(fila.nombrePila?.trim() || '');
  const apellidos = titular(fila.apellidos?.trim() || '');
  return `${pila} ${apellidos}`.trim() || titular(fila.nombre);
}
