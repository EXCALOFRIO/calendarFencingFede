import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  athlete,
  athleteWeapon,
  fieClasificacion,
  fieFencer,
  officialRankingEntry,
} from '@/db/schema';
import {
  MINIMO_LETRAS,
  UMBRAL,
  bastanteParaBuscar,
  fonetico,
  palabrasNombre,
  parecidoNombre,
} from '@/lib/nombres';
import { titular, yearFromIsoDate } from '@/lib/utils';
import type {
  Arma,
  Genero,
  MotivoRechazo,
  ResultadoAlta,
} from './desde-ranking';
import { vincularFichaDesdeRanking } from './desde-ranking';

/**
 * «¿Cómo te llamas?»: encontrarse por el nombre y decir «sí, soy yo».
 *
 * -------------------------------------------------------------------------
 * POR QUÉ ESTO NO ROMPE LA REGLA DE «NUNCA POR NOMBRE»
 * -------------------------------------------------------------------------
 * Todo este proyecto repite la misma regla —está en `src/db/schema/fie.ts`, en
 * `src/db/schema/results.ts` y en `src/lib/ingest/upsert.ts`—: **un resultado
 * NUNCA se empareja con un tirador por el nombre**, porque hay homónimos
 * (medidos: «JAVIER ALONSO ESCOBAR» y «JAVIER ALONSO PRIETO», «PAULA GARCIA
 * BLANCO» y «PAULA GARCIA GONZALEZ-ESTEFANI») y porque los acentos van a su
 * aire entre fuentes.
 *
 * Lo de aquí no es una excepción a esa regla: es su versión segura, y la
 * diferencia es quién decide. Ahí decidía la máquina y por eso estaba
 * prohibido. Aquí la máquina solo **propone** hasta cinco filas y quien decide
 * es la persona diciendo cuál es la suya, que es la confirmación más fuerte que
 * existe para la identidad de uno mismo: nadie tiene mejor información sobre
 * quién es Jorge Casaus que Jorge Casaus.
 *
 * Alguien va a cuestionar esto dentro de seis meses, así que las dos
 * condiciones que lo hacen legítimo están puestas en el código y no solo en
 * este comentario:
 *
 *   1. **No se escribe ningún enlace sin un clic humano**: buscar no vincula
 *      nada, ni cuando hay un único candidato con puntuación 1,00. La
 *      propuesta se enseña y la persona pulsa «Sí, soy yo».
 *   2. **Queda escrito quién lo confirmó y cuándo**: `athlete.linked_via =
 *      'persona'`, `linked_by_profile_id` con su cuenta, `linked_at` y
 *      `linked_evidence` con lo que escribió y qué fila reclamó. Si mañana
 *      resulta que se equivocó —o que mintió—, se sabe exactamente qué pasó.
 *
 * -------------------------------------------------------------------------
 * UN BUSCADOR DE NOMBRES ES UNA SUPERFICIE DE FUGA
 * -------------------------------------------------------------------------
 * En estas listas hay menores de edad, así que el buscador está estrechado a
 * propósito y los tres límites son de seguridad, no de comodidad:
 *
 *   - **Sesión obligatoria** (`requireProfile` en la acción). Esto no es
 *     público.
 *   - **Mínimo tres letras** y nada con una o dos: con «ab» se sacaría el censo
 *     a tirones, una letra por petición.
 *   - **Cinco candidatos como máximo.** «garcia» casa con 94 nombres reales;
 *     enseñar los 94 convierte la pantalla en un listado de personas. Cinco es
 *     lo que cabe en un móvil y lo que basta para reconocerse.
 *
 * Y de cada candidato se enseña solo lo que permite reconocerse: nombre
 * publicado, arma, categoría, **año** de nacimiento y club. El **año** y no la
 * fecha: para distinguir a dos homónimos sobra el año, y la fecha de
 * nacimiento completa de un menor no se pinta en una pantalla a la que se llega
 * escribiendo un apellido. Ni licencias, ni correos, ni la fecha entera.
 */

/**
 * Lo que se le dice a la persona cuando no se puede vincular, por motivo.
 *
 * Está en un mapa y no repartido por los `return` porque la pantalla recibe
 * **solo el código** del rechazo: «Sí, soy yo» es un formulario que acaba en
 * una redirección, y meter la frase entera en la URL sería dejar que cualquiera
 * le escriba a otro el mensaje que quiera en una pantalla de su cuenta. Con un
 * código de una lista cerrada eso no se puede hacer.
 *
 * Cada frase dice qué ha pasado y qué hacer. Ninguna dice «ha habido un
 * error»: eso no es información, es ruido con forma de disculpa.
 */
export const MENSAJE_RECHAZO: Record<MotivoRechazo, string> = {
  YA_TIENES_FICHA:
    'Tu cuenta ya tiene una ficha de tirador vinculada, así que no hay nada ' +
    'que dar de alta. Si la ficha no es la que te corresponde, escribe a la ' +
    'dirección técnica: cambiarla no es algo que deba poder hacer uno mismo.',
  NO_ENCONTRADO:
    'Esa propuesta ya no vale: las listas oficiales se releen cada noche y ' +
    'puede haber cambiado. Vuelve a buscarte.',
  SIN_LICENCIA_EN_LA_FUENTE:
    'De esa ficha la fuente no publica todo lo que hace falta para crear la ' +
    'tuya, y lo que falta no se inventa. Pídele la vinculación a la dirección ' +
    'técnica.',
  LICENCIA_NO_COINCIDE:
    'Esa licencia no es la de esa ficha. Compruébala en tu carné de la RFEE.',
  YA_VINCULADO:
    'Esa ficha ya está vinculada a otra cuenta. Si crees que la cuenta es ' +
    'tuya, entra con ella; si no, escribe a la dirección técnica para que lo ' +
    'revise. Desde aquí no se le quita una ficha a nadie.',
  DEMASIADOS_INTENTOS:
    'Demasiados intentos seguidos. Espera diez minutos o pide a la dirección ' +
    'técnica que te vincule la ficha.',
};

export type FuenteCandidato = 'RANKING_RFEE' | 'FIE';

/** Una propuesta para que la persona la reconozca o la descarte. */
export type CandidatoNombre = {
  /** `rfee:<id de Skermo>` o `fie:<addrId>`. Nunca una licencia. */
  clave: string;
  /** En forma de título, que es como se escribe un nombre. */
  nombre: string;
  /** Tal y como lo publica la fuente, para poder auditar el emparejado. */
  nombrePublicado: string;
  fuente: FuenteCandidato;
  /** El AÑO, nunca la fecha completa. Ver la cabecera de este fichero. */
  anioNacimiento: number | null;
  club: string | null;
  armas: Arma[];
  /** Etiquetas de categoría de la fuente, ya normalizadas («M20», «ABS»). */
  categorias: string[];
  genero: Genero | null;
  mejorPuesto: number | null;
  /**
   * Es un candidato del ranking de la RFEE que ADEMÁS está en la FIE con el
   * mismo nombre y el mismo año. Solo tiene sentido en los de la RFEE: en los
   * de la FIE, la fuente ya lo dice.
   */
  tambienEnLaFie: boolean;
  /** Ya hay una cuenta con esta ficha: no se le quita a nadie desde aquí. */
  yaVinculado: boolean;
  /**
   * La fuente no publica algo obligatorio de la ficha (la fecha de nacimiento,
   * o el género). No se inventa: se enseña el candidato sin botón y se manda a
   * la dirección técnica.
   */
  faltaDato: string | null;
  /** De 0 a 1. No se enseña en pantalla: ordena la lista. */
  parecido: number;
};

/** Cinco. Ver la cabecera: es un límite de seguridad, no de maquetación. */
export const TOPE_CANDIDATOS = 5;

export type ResultadoNombres =
  | { ok: true; candidatos: CandidatoNombre[]; hayMas: boolean }
  | { ok: false; error: string };

/**
 * Busca a una persona por su nombre en las listas oficiales.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ SE COMPARA EN MEMORIA Y NO EN SQL
 * -------------------------------------------------------------------------
 * Tolerar erratas hace falta —la fuente publica «CARLOS LLAVADOR FERNANDEZ» y
 * hay quien escribe «carlos yavador»— y eso en Postgres serían trigramas, otra
 * extensión y otro índice. Medido el 28/09/2026: los nombres distintos de las
 * tres listas son **1.497** (809 del ranking de la RFEE, 344 fichas de la FIE,
 * 417 de la clasificación mundial con país ESP), que caben en 45 KB y se
 * puntúan en unos 60 ms. Una búsqueda entera —las dos consultas de nombres,
 * la puntuación y los datos de los cinco que se enseñan— tarda entre 180 y 200
 * ms contra Neon por HTTP, y de eso casi todo son los viajes de red. Para una
 * aplicación de la selección española eso es gratis, y se ahorra una extensión
 * de base de datos.
 *
 * Van dos consultas y no una: la primera trae **solo el nombre y la clave** de
 * cada persona, y la segunda los datos (arma, año, club, puesto) **solo de los
 * cinco que se van a enseñar**. Traer los 1.497 con su club y su fecha de
 * nacimiento para descartar 1.492 sería sacar de la base datos personales de
 * gente que no se va a pintar.
 */
export async function buscarPorNombre(texto: string): Promise<ResultadoNombres> {
  if (!bastanteParaBuscar(texto)) {
    return {
      ok: false,
      error:
        `Escribe al menos ${MINIMO_LETRAS} letras de tu nombre. Con una o dos ` +
        'no se busca: saldría media federación.',
    };
  }

  const [delRanking, deLaFie] = await Promise.all([
    db
      .selectDistinct({
        clave: officialRankingEntry.skermoAthleteId,
        nombre: officialRankingEntry.sourceAthleteName,
      })
      .from(officialRankingEntry),
    /**
     * `fie_fencer` es el índice de los tiradores que nos importan y hoy son
     * **los 344 españoles**, así que sirve de identidad para las dos tablas de
     * la FIE. La clasificación mundial tiene un `fie_id` español más que no
     * está aquí: de ese no hay fecha de nacimiento en ninguna parte, así que
     * tampoco se podría crear su ficha. No se enseña lo que no se puede
     * vincular.
     */
    db
      .select({ clave: fieFencer.fieId, nombre: fieFencer.sourceName })
      .from(fieFencer)
      .where(eq(fieFencer.countryCode, 'ESP')),
  ]);

  type Puntuado = {
    clave: string;
    fuente: FuenteCandidato;
    nombre: string;
    parecido: number;
    reconocidas: number;
  };

  const puntuados: Puntuado[] = [];

  for (const fila of delRanking) {
    if (!fila.clave) continue;
    const p = parecidoNombre(texto, fila.nombre);
    if (!p) continue;
    puntuados.push({
      clave: `rfee:${fila.clave}`,
      fuente: 'RANKING_RFEE',
      nombre: fila.nombre,
      parecido: p.puntos,
      reconocidas: p.reconocidas,
    });
  }

  for (const fila of deLaFie) {
    if (!fila.nombre || fila.nombre.trim() === '') continue;
    const p = parecidoNombre(texto, fila.nombre);
    if (!p) continue;
    puntuados.push({
      clave: `fie:${fila.clave}`,
      fuente: 'FIE',
      nombre: fila.nombre,
      parecido: p.puntos,
      reconocidas: p.reconocidas,
    });
  }

  puntuados.sort(
    (a, b) =>
      b.parecido - a.parecido ||
      b.reconocidas - a.reconocidas ||
      a.nombre.localeCompare(b.nombre, 'es'),
  );

  if (puntuados.length === 0) return { ok: true, candidatos: [], hayMas: false };

  /**
   * Se detalla el doble del tope y luego se unifica, porque la misma persona
   * viene por duplicado de las dos fuentes: «javier moreno» devuelve cuatro
   * filas puntuadas y son dos personas.
   */
  const ventana = puntuados.slice(0, TOPE_CANDIDATOS * 2);
  const unificados = unificar(await detallar(ventana));

  return {
    ok: true,
    candidatos: unificados.slice(0, TOPE_CANDIDATOS),
    /**
     * «Hay más», no «hay N más»: la cuenta exacta habría que sacarla de los
     * puntuados en bruto, y ahí la misma persona aparece hasta dos veces. Dar
     * un número sería dar un número falso, y en una pantalla que dice «no te
     * fíes, mira el año» eso es justo lo que no se puede hacer.
     */
    hayMas: puntuados.length > ventana.length || unificados.length > TOPE_CANDIDATOS,
  };
}

/** Los datos de los pocos que se van a enseñar, no de todos los que casan. */
async function detallar(
  puntuados: {
    clave: string;
    fuente: FuenteCandidato;
    nombre: string;
    parecido: number;
  }[],
): Promise<CandidatoNombre[]> {
  const clavesRfee = puntuados
    .filter((p) => p.fuente === 'RANKING_RFEE')
    .map((p) => p.clave.slice('rfee:'.length));
  const clavesFie = puntuados
    .filter((p) => p.fuente === 'FIE')
    .map((p) => Number.parseInt(p.clave.slice('fie:'.length), 10))
    .filter((n) => Number.isFinite(n));

  const [filasRfee, fichasFie, mundialFie, vinculadas] = await Promise.all([
    clavesRfee.length === 0
      ? []
      : db
          .select({
            clave: officialRankingEntry.skermoAthleteId,
            nombre: officialRankingEntry.sourceAthleteName,
            nombrePila: officialRankingEntry.sourceFirstName,
            apellidos: officialRankingEntry.sourceLastName,
            nacimiento: officialRankingEntry.sourceBirthDate,
            club: officialRankingEntry.sourceClub,
            arma: officialRankingEntry.weapon,
            genero: officialRankingEntry.gender,
            categoria: officialRankingEntry.category,
            puesto: officialRankingEntry.position,
            atletaId: officialRankingEntry.athleteId,
          })
          .from(officialRankingEntry)
          .where(inArray(officialRankingEntry.skermoAthleteId, clavesRfee)),
    clavesFie.length === 0
      ? []
      : db
          .select({
            clave: fieFencer.fieId,
            nombre: fieFencer.sourceName,
            nombrePila: fieFencer.sourceFirstName,
            apellidos: fieFencer.sourceLastName,
            nacimiento: fieFencer.sourceBirthDate,
            atletaId: fieFencer.athleteId,
            estado: fieFencer.linkStatus,
          })
          .from(fieFencer)
          .where(inArray(fieFencer.fieId, clavesFie)),
    clavesFie.length === 0
      ? []
      : db
          .selectDistinct({
            clave: fieClasificacion.fieId,
            arma: fieClasificacion.weapon,
            genero: fieClasificacion.gender,
            categoria: fieClasificacion.category,
            puesto: fieClasificacion.position,
          })
          .from(fieClasificacion)
          .where(
            and(
              inArray(fieClasificacion.fieId, clavesFie),
              eq(fieClasificacion.format, 'INDIVIDUAL'),
            ),
          ),
    /**
     * Qué fichas tienen ya dueño. Se comprueba aquí, en la propia lista, y no
     * al confirmar: enterarse de que la ficha es de otro DESPUÉS de pulsar «Sí,
     * soy yo» es el peor momento posible.
     */
    db
      .select({ id: athlete.id })
      .from(athlete)
      .where(
        sql`(${athlete.userProfileId} is not null or ${athlete.guardianProfileId} is not null)`,
      ),
  ]);

  const conDueno = new Set(vinculadas.map((a) => a.id));

  const salida: CandidatoNombre[] = [];

  for (const p of puntuados) {
    if (p.fuente === 'RANKING_RFEE') {
      const filas = filasRfee.filter(
        (f) => `rfee:${f.clave}` === p.clave,
      );
      if (filas.length === 0) continue;
      const primera = filas[0];
      salida.push({
        clave: p.clave,
        nombre: enTitular(primera),
        nombrePublicado: primera.nombre,
        fuente: 'RANKING_RFEE',
        anioNacimiento: primera.nacimiento
          ? yearFromIsoDate(primera.nacimiento)
          : null,
        club: primera.club,
        armas: [...new Set(filas.map((f) => f.arma))],
        categorias: [...new Set(filas.map((f) => f.categoria))],
        genero: primera.genero,
        mejorPuesto: menorPuesto(filas.map((f) => f.puesto)),
        tambienEnLaFie: false,
        yaVinculado: filas.some((f) => f.atletaId && conDueno.has(f.atletaId)),
        // La fecha de nacimiento la publica siempre esta fuente; si faltara, se dice.
        faltaDato: primera.nacimiento ? null : 'la fecha de nacimiento',
        parecido: p.parecido,
      });
      continue;
    }

    const ficha = fichasFie.find((f) => `fie:${f.clave}` === p.clave);
    if (!ficha) continue;
    const suyas = mundialFie.filter((m) => `fie:${m.clave}` === p.clave);
    const genero = suyas[0]?.genero ?? null;
    salida.push({
      clave: p.clave,
      nombre: enTitular({
        nombre: ficha.nombre,
        nombrePila: ficha.nombrePila,
        apellidos: ficha.apellidos,
      }),
      nombrePublicado: ficha.nombre,
      fuente: 'FIE',
      anioNacimiento: ficha.nacimiento ? yearFromIsoDate(ficha.nacimiento) : null,
      /** La FIE no publica el club de nadie. No se rellena con el país. */
      club: null,
      armas: [...new Set(suyas.map((m) => m.arma))],
      categorias: [...new Set(suyas.map((m) => m.categoria))],
      genero,
      mejorPuesto: menorPuesto(suyas.map((m) => m.puesto)),
      tambienEnLaFie: false,
      yaVinculado: Boolean(ficha.atletaId && conDueno.has(ficha.atletaId)),
      faltaDato: !ficha.nacimiento
        ? 'la fecha de nacimiento'
        : genero === null
          ? 'el género con el que compite'
          : null,
      parecido: p.parecido,
    });
  }

  return salida;
}

/**
 * La misma persona no se enseña dos veces.
 *
 * Carlos Llavador está en las tres listas, y enseñarle tres tarjetas iguales
 * con tres botones distintos es peor que no encontrarle: no sabría cuál pulsar.
 *
 * Se unifica **solo** cuando la ficha de la FIE está contenida en el nombre del
 * ranking de la RFEE **y los dos años de nacimiento coinciden**, y esa segunda
 * condición es la que evita convertir esto en un emparejado por nombre: hay dos
 * «Javier Moreno» en el ranking de la RFEE, así que el nombre por sí solo no
 * decide nada. Si los años no coinciden —o falta alguno—, se enseñan los dos
 * candidatos y elige la persona, que es de lo que va esta pantalla.
 *
 * Y ojo: unificar aquí es una decisión de PRESENTACIÓN. No escribe ningún
 * enlace entre las dos fuentes; lo que se vincula al confirmar sigue siendo una
 * fila concreta de una fuente concreta.
 */
function unificar(candidatos: CandidatoNombre[]): CandidatoNombre[] {
  const salida: CandidatoNombre[] = [];

  for (const c of candidatos) {
    if (c.fuente === 'FIE') {
      const yaEsta = salida.find(
        (otro) =>
          otro.fuente === 'RANKING_RFEE' &&
          otro.anioNacimiento !== null &&
          otro.anioNacimiento === c.anioNacimiento &&
          contenido(c.nombrePublicado, otro.nombrePublicado),
      );
      if (yaEsta) {
        yaEsta.tambienEnLaFie = true;
        // Las armas de la FIE suman: puede tirar sable internacional y espada
        // nacional, y esconderle un arma le esconde medio calendario.
        yaEsta.armas = [...new Set([...yaEsta.armas, ...c.armas])];
        continue;
      }
    }
    salida.push(c);
  }

  return salida;
}

/** ¿Todas las palabras de A están, con el mismo sonido, dentro de B? */
function contenido(a: string, b: string): boolean {
  const deB = new Set(palabrasNombre(b).map(fonetico));
  return palabrasNombre(a)
    .map(fonetico)
    .every((p) => deB.has(p));
}

function menorPuesto(puestos: (number | null)[]): number | null {
  const validos = puestos.filter((p): p is number => p !== null);
  return validos.length === 0 ? null : Math.min(...validos);
}

function enTitular(fila: {
  nombre: string | null;
  nombrePila: string | null;
  apellidos: string | null;
}): string {
  const pila = titular(fila.nombrePila?.trim() || '');
  const apellidos = titular(fila.apellidos?.trim() || '');
  return `${pila} ${apellidos}`.trim() || titular(fila.nombre?.trim() || '');
}

/**
 * «Sí, soy yo»: la persona reclama una de las filas propuestas.
 *
 * `nombreEscrito` no se usa para buscar nada aquí: se guarda en
 * `athlete.linked_evidence`. Es lo que permite reconstruir dentro de un año qué
 * escribió y qué se le propuso, y sin eso un enlace confirmado por la persona
 * tendría fecha pero no evidencia.
 */
export async function confirmarSoyYo({
  profileId,
  clave,
  nombreEscrito,
}: {
  profileId: string;
  clave: string;
  nombreEscrito: string;
}): Promise<ResultadoAlta> {
  if (clave.startsWith('rfee:')) {
    return vincularFichaDesdeRanking({
      profileId,
      clave: clave.slice('rfee:'.length),
      origen: 'nombre',
      evidencia: evidencia(nombreEscrito, clave),
    });
  }

  if (clave.startsWith('fie:')) {
    return vincularFichaDeLaFie({
      profileId,
      fieId: Number.parseInt(clave.slice('fie:'.length), 10),
      evidencia: evidencia(nombreEscrito, clave),
    });
  }

  return rechazo('NO_ENCONTRADO');
}

function evidencia(nombreEscrito: string, clave: string): string {
  return (
    `La persona escribió «${nombreEscrito.trim()}» en /alta, se reconoció en ` +
    `${clave} y pulsó «Sí, soy yo».`
  );
}

/**
 * Crear la ficha a partir de la FIE, para quien no está en el ranking de la
 * RFEE.
 *
 * Hace falta y no es un extra: Jorge Casaus, sable, 61.º del mundo absoluto,
 * **no aparece en el ranking oficial de la RFEE** de esta temporada. Con solo
 * la lista de la RFEE, esta pantalla le habría dicho «no apareces» a alguien de
 * la selección.
 *
 * Los datos salen de dos tablas de la FIE porque cada una publica una mitad:
 * la fecha de nacimiento está en su ficha (`fie_fencer`) y el arma, el género y
 * el puesto en la clasificación mundial (`fie_clasificacion`). Lo que ninguna
 * publica —el club y la licencia de la RFEE— se queda vacío; sale en «Qué te
 * falta» de `/estado`, que es donde tiene que salir.
 */
async function vincularFichaDeLaFie({
  profileId,
  fieId,
  evidencia: notaEvidencia,
}: {
  profileId: string;
  fieId: number;
  evidencia: string;
}): Promise<ResultadoAlta> {
  if (!Number.isFinite(fieId)) {
    return rechazo('NO_ENCONTRADO');
  }

  const [suya] = await db
    .select({ id: athlete.id })
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

  if (suya) return rechazo('YA_TIENES_FICHA');

  const [ficha] = await db
    .select({
      nombre: fieFencer.sourceName,
      nombrePila: fieFencer.sourceFirstName,
      apellidos: fieFencer.sourceLastName,
      nacimiento: fieFencer.sourceBirthDate,
      licenciaFie: fieFencer.fieLicense,
      atletaId: fieFencer.athleteId,
      pais: fieFencer.countryCode,
    })
    .from(fieFencer)
    .where(eq(fieFencer.fieId, fieId))
    .limit(1);

  if (!ficha || ficha.pais !== 'ESP') {
    return rechazo('NO_ENCONTRADO');
  }

  if (ficha.atletaId) {
    const [dueno] = await db
      .select({
        userProfileId: athlete.userProfileId,
        guardianProfileId: athlete.guardianProfileId,
      })
      .from(athlete)
      .where(eq(athlete.id, ficha.atletaId))
      .limit(1);
    if (dueno && (dueno.userProfileId || dueno.guardianProfileId)) {
      return rechazo('YA_VINCULADO');
    }
  }

  if (!ficha.nacimiento) {
    return rechazo('SIN_LICENCIA_EN_LA_FUENTE');
  }

  const suyas = await db
    .selectDistinct({
      arma: fieClasificacion.weapon,
      genero: fieClasificacion.gender,
    })
    .from(fieClasificacion)
    .where(
      and(
        eq(fieClasificacion.fieId, fieId),
        eq(fieClasificacion.format, 'INDIVIDUAL'),
      ),
    );

  const genero = suyas.find((s) => s.genero === 'M' || s.genero === 'F')?.genero;
  if (!genero) {
    return rechazo('SIN_LICENCIA_EN_LA_FUENTE');
  }

  const nombrePila = titular(ficha.nombrePila?.trim() || '');
  const apellidos = titular(ficha.apellidos?.trim() || '');
  const nota =
    'Alta de autoservicio por nombre: la persona se reconoció en la ficha de ' +
    'la FIE y lo confirmó ella misma. No aparece en el ranking oficial de la ' +
    'RFEE, así que no hay licencia RFEE que comprobar.';

  const atletaId =
    ficha.atletaId ??
    (
      await db
        .insert(athlete)
        .values({
          firstName: nombrePila || titular(ficha.nombre ?? ''),
          lastName: apellidos,
          birthDate: ficha.nacimiento,
          gender: genero,
          /** La FIE no publica el club. Vacío, no inventado. */
          clubId: null,
          fieLicense: ficha.licenciaFie,
          userProfileId: profileId,
          notes: nota,
          linkedVia: 'persona',
          linkedAt: new Date(),
          linkedByProfileId: profileId,
          linkedEvidence: notaEvidencia,
        })
        .returning({ id: athlete.id })
    )[0].id;

  if (ficha.atletaId) {
    await db
      .update(athlete)
      .set({
        userProfileId: profileId,
        linkedVia: 'persona',
        linkedAt: new Date(),
        linkedByProfileId: profileId,
        linkedEvidence: notaEvidencia,
        updatedAt: new Date(),
      })
      .where(eq(athlete.id, atletaId));
  }

  const armas = [...new Set(suyas.map((s) => s.arma))];
  if (armas.length > 0) {
    await db
      .insert(athleteWeapon)
      .values(armas.map((arma) => ({ athleteId: atletaId, weapon: arma })))
      .onConflictDoNothing();
  }

  /**
   * Y se cierra el enlace con la FIE con el vocabulario que ya existía en esa
   * tabla: `linked_via = 'persona'`, que es precisamente lo que su cabecera
   * decía que era la otra forma legítima de enlazar («o lo confirma una
   * persona»). Aquí la persona es el propio tirador.
   */
  await db
    .update(fieFencer)
    .set({
      athleteId: atletaId,
      linkStatus: 'CONFIRMADO',
      linkedVia: 'persona',
      linkedAt: new Date(),
      matchEvidence: notaEvidencia,
      updatedAt: new Date(),
    })
    .where(eq(fieFencer.fieId, fieId));

  return {
    ok: true,
    alta: {
      atletaId,
      nombre: `${nombrePila} ${apellidos}`.trim(),
      licencia: '',
      club: null,
      fechaNacimiento: ficha.nacimiento,
      armas,
      clasificaciones: [],
      filasEmparejadas: 0,
    },
  };
}

function rechazo(motivo: MotivoRechazo): ResultadoAlta {
  return { ok: false, motivo, error: MENSAJE_RECHAZO[motivo] };
}

/** Lo mínimo que tiene que devolver la búsqueda para merecer enseñarse. */
export const UMBRAL_PARECIDO = UMBRAL;
