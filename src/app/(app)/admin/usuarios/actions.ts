'use server';

import { asc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { athlete, athleteWeapon, club, userProfile } from '@/db/schema';
import { newIcalToken, requireRole } from '@/lib/auth/session';
import { ageOn, requiresGuardianAccount } from '@/lib/categories';

export type ResultadoAccion =
  | { ok: true; message: string }
  | { ok: false; error: string };

export type Rol = 'admin' | 'club' | 'athlete' | 'guardian';
export type Genero = 'M' | 'F' | 'MIXTO';
export type Arma = 'FLORETE' | 'ESPADA' | 'SABLE';

/**
 * Altas de usuarios y tiradores.
 *
 * La regla que manda sobre todo lo demás es el RGPD: en España un menor de 14
 * años no puede consentir el tratamiento por sí mismo, así que NO se le crea
 * cuenta. La cuenta es del padre, madre o tutor y el menor queda como perfil
 * vinculado (`guardianProfileId`). Esto no es configurable a propósito.
 */

// ------------------------------------------------------------ utilidades ---

function limpiar(valor: FormDataEntryValue | null | undefined): string {
  return String(valor ?? '').trim();
}

function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

const ROLES: Rol[] = ['admin', 'club', 'athlete', 'guardian'];

/**
 * Etiquetas de rol. Están aquí duplicadas respecto a la interfaz porque un
 * fichero `'use server'` solo puede exportar funciones asíncronas: exportar
 * esta constante convertiría el módulo en inválido.
 */
const ROL_LABEL: Record<Rol, string> = {
  admin: 'Administración',
  club: 'Responsable de club',
  athlete: 'Tirador',
  guardian: 'Padre, madre o tutor',
};

/** Acepta `2011-04-07`, `07/04/2011` y `7-4-2011`. */
function normalizarFecha(valor: string): string | null {
  const texto = valor.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;

  const partes = texto.split(/[/\-.]/).map((p) => p.trim());
  if (partes.length !== 3) return null;

  const [d, m, a] = partes;
  if (a.length !== 4) return null;
  const dia = Number(d);
  const mes = Number(m);
  const anio = Number(a);
  if (!dia || !mes || !anio || mes > 12 || dia > 31) return null;

  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function normalizarGenero(valor: string): Genero | null {
  const v = valor.trim().toUpperCase();
  if (['M', 'H', 'MASCULINO', 'HOMBRE', 'MALE'].includes(v)) return 'M';
  if (['F', 'FEMENINO', 'MUJER', 'FEMALE'].includes(v)) return 'F';
  if (['MIXTO', 'MX'].includes(v)) return 'MIXTO';
  return null;
}

function normalizarArmas(valor: string): { armas: Arma[]; desconocidas: string[] } {
  const armas: Arma[] = [];
  const desconocidas: string[] = [];

  for (const trozo of valor.split(/[,/|]+/)) {
    const v = trozo
      .trim()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toUpperCase();
    if (!v) continue;
    if (v.startsWith('FLOR') || v === 'F') armas.push('FLORETE');
    else if (v.startsWith('ESP') || v === 'E') armas.push('ESPADA');
    else if (v.startsWith('SAB') || v === 'S') armas.push('SABLE');
    else desconocidas.push(trozo.trim());
  }

  return { armas: [...new Set(armas)], desconocidas };
}

function normalizarRol(valor: string): Rol | null {
  const v = valor
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (!v) return null;
  if (['admin', 'administracion', 'administrador', 'rfee'].includes(v)) return 'admin';
  if (['club', 'responsable', 'responsable de club'].includes(v)) return 'club';
  if (['athlete', 'tirador', 'tiradora', 'atleta'].includes(v)) return 'athlete';
  if (['guardian', 'tutor', 'padre', 'madre'].includes(v)) return 'guardian';
  return null;
}

// -------------------------------------------------------------- clubes ---

export async function listarClubes() {
  await requireRole('admin');
  return db.select().from(club).orderBy(asc(club.name));
}

/** Alta rápida de club: sin clubes no se puede dar de alta a casi nadie. */
export async function crearClub(formData: FormData): Promise<ResultadoAccion> {
  await requireRole('admin');

  const name = limpiar(formData.get('name'));
  const regionalFederation = limpiar(formData.get('regionalFederation'));
  const contactEmail = limpiar(formData.get('contactEmail'));

  if (name.length < 2) return { ok: false, error: 'El nombre del club es obligatorio.' };
  if (contactEmail && !emailValido(contactEmail)) {
    return { ok: false, error: 'El correo de contacto no tiene forma de correo.' };
  }

  await db.insert(club).values({
    name,
    regionalFederation: regionalFederation || null,
    contactEmail: contactEmail || null,
  });

  revalidatePath('/admin/usuarios');
  return { ok: true, message: `Club "${name}" creado.` };
}

// ------------------------------------------------------- alta individual ---

/**
 * Alta de una persona.
 *
 * Si el tirador es menor de 14, la cuenta se crea a nombre del tutor y el
 * tirador se queda como ficha vinculada sin acceso propio.
 */
export async function crearUsuario(formData: FormData): Promise<ResultadoAccion> {
  await requireRole('admin');

  const firstName = limpiar(formData.get('firstName'));
  const lastName = limpiar(formData.get('lastName'));
  const email = limpiar(formData.get('email')).toLowerCase();
  const rol = (limpiar(formData.get('role')) || 'athlete') as Rol;
  const clubId = limpiar(formData.get('clubId'));
  const birthDate = normalizarFecha(limpiar(formData.get('birthDate')));
  const gender = normalizarGenero(limpiar(formData.get('gender')));
  const rfeeLicense = limpiar(formData.get('rfeeLicense'));
  const armas = formData.getAll('weapons').map(String) as Arma[];
  const guardianEmail = limpiar(formData.get('guardianEmail')).toLowerCase();
  const guardianName = limpiar(formData.get('guardianName'));

  if (!firstName || !lastName) {
    return { ok: false, error: 'El nombre y los apellidos son obligatorios.' };
  }
  if (!ROLES.includes(rol)) return { ok: false, error: 'Ese rol no existe.' };

  const esTirador = rol === 'athlete';

  if (esTirador) {
    if (!birthDate) {
      return {
        ok: false,
        error:
          'La fecha de nacimiento es obligatoria para un tirador: la categoría se ' +
          'deriva de ella, nunca se escribe a mano.',
      };
    }
    if (!gender) return { ok: false, error: 'Indica el género del tirador.' };
  }

  const menor = esTirador && birthDate ? requiresGuardianAccount(birthDate) : false;

  // Menor de 14: la cuenta es del tutor, sin excepciones (RGPD).
  if (menor) {
    if (!guardianEmail || !emailValido(guardianEmail)) {
      return {
        ok: false,
        error:
          `${firstName} tiene ${ageOn(birthDate!)} años. Por debajo de 14 la cuenta ` +
          'tiene que ir a nombre del padre, madre o tutor: hace falta su correo.',
      };
    }
  } else if (!emailValido(email)) {
    return { ok: false, error: 'El correo no tiene forma de correo.' };
  }

  const correoCuenta = menor ? guardianEmail : email;

  const [existente] = await db
    .select({ id: userProfile.id, role: userProfile.role, fullName: userProfile.fullName })
    .from(userProfile)
    .where(eq(userProfile.email, correoCuenta))
    .limit(1);

  let profileId: string;

  if (existente) {
    if (!menor) {
      return {
        ok: false,
        error: `Ya hay una cuenta con el correo ${correoCuenta} (${existente.fullName}).`,
      };
    }
    // El tutor ya existe: el hermano pequeño cuelga de la misma cuenta.
    profileId = existente.id;
  } else {
    const [creado] = await db
      .insert(userProfile)
      .values({
        email: correoCuenta,
        fullName: menor
          ? guardianName || `Tutor de ${firstName} ${lastName}`
          : `${firstName} ${lastName}`,
        role: menor ? 'guardian' : rol,
        clubId: clubId || null,
        icalToken: newIcalToken(),
        inviteStatus: 'pendiente',
        invitedAt: new Date(),
      })
      .returning({ id: userProfile.id });
    profileId = creado.id;
  }

  if (!esTirador) {
    revalidatePath('/admin/usuarios');
    return {
      ok: true,
      message: `${firstName} ${lastName} dado de alta como ${ROL_LABEL[rol]}.`,
    };
  }

  if (rfeeLicense) {
    const [conLicencia] = await db
      .select({ id: athlete.id })
      .from(athlete)
      .where(eq(athlete.rfeeLicense, rfeeLicense))
      .limit(1);
    if (conLicencia) {
      return {
        ok: false,
        error: `La licencia ${rfeeLicense} ya figura en otra ficha de tirador.`,
      };
    }
  }

  const [fichaCreada] = await db
    .insert(athlete)
    .values({
      userProfileId: menor ? null : profileId,
      guardianProfileId: menor ? profileId : null,
      firstName,
      lastName,
      birthDate: birthDate!,
      gender: gender!,
      clubId: clubId || null,
      rfeeLicense: rfeeLicense || null,
    })
    .returning({ id: athlete.id });

  if (armas.length > 0) {
    await db
      .insert(athleteWeapon)
      .values(
        armas.map((arma, i) => ({
          athleteId: fichaCreada.id,
          weapon: arma,
          primary: i === 0,
        })),
      )
      .onConflictDoNothing();
  }

  revalidatePath('/admin/usuarios');

  return {
    ok: true,
    message: menor
      ? `${firstName} ${lastName} creado como ficha vinculada. La cuenta es de ` +
        `${correoCuenta}: por ser menor de 14 años no puede tener cuenta propia.`
      : `${firstName} ${lastName} dado de alta con cuenta propia (${correoCuenta}).`,
  };
}

// ------------------------------------------------------- importación CSV ---

export type FilaCsv = {
  linea: number;
  firstName: string;
  lastName: string;
  email: string;
  role: Rol | null;
  clubName: string;
  clubId: string | null;
  birthDate: string | null;
  gender: Genero | null;
  weapons: Arma[];
  rfeeLicense: string;
  guardianEmail: string;
  guardianName: string;
  /** Menor de 14: la cuenta irá a nombre del tutor. */
  requiereTutor: boolean;
  errores: string[];
  avisos: string[];
};

export type PrevisualizacionCsv = {
  ok: true;
  filas: FilaCsv[];
  cabeceraDetectada: string[];
  separador: string;
  validas: number;
  conErrores: number;
};

export type ErrorCsv = { ok: false; error: string };

const COLUMNAS_ESPERADAS = [
  'nombre',
  'apellidos',
  'email',
  'rol',
  'club',
  'fecha_nacimiento',
  'genero',
  'armas',
  'licencia_rfee',
  'email_tutor',
  'nombre_tutor',
];

/** Cabecera de ejemplo para el botón "descargar plantilla". */
export async function plantillaCsv(): Promise<string> {
  await requireRole('admin');
  return `${COLUMNAS_ESPERADAS.join(';')}\r\n`;
}

function clave(texto: string): string {
  return texto
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** Divide una línea respetando las comillas dobles del formato CSV. */
function partirLinea(linea: string, separador: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      celdas.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

/**
 * Analiza el CSV y valida fila a fila SIN escribir nada.
 *
 * La previsualización existe porque una importación a ciegas de 200 filas es
 * la forma más rápida de llenar la base de basura. Aquí se ve qué entraría,
 * qué falla y por qué, y solo después se confirma.
 */
export async function previsualizarCsv(
  texto: string,
): Promise<PrevisualizacionCsv | ErrorCsv> {
  await requireRole('admin');
  return analizarCsv(texto);
}

async function analizarCsv(texto: string): Promise<PrevisualizacionCsv | ErrorCsv> {
  // Se quita el BOM inicial que mete Excel al guardar como CSV UTF-8.
  const limpio = texto.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (!limpio) return { ok: false, error: 'El fichero está vacío.' };

  const lineas = limpio.split('\n').filter((l) => l.trim().length > 0);
  if (lineas.length < 2) {
    return {
      ok: false,
      error: 'El fichero solo tiene la cabecera: no hay ninguna fila que importar.',
    };
  }

  // El separador se detecta contando: los CSV españoles usan `;` y los
  // exportados desde herramientas anglosajonas, `,`.
  const separador = (lineas[0].match(/;/g)?.length ?? 0) >=
    (lineas[0].match(/,/g)?.length ?? 0)
    ? ';'
    : ',';

  const cabecera = partirLinea(lineas[0], separador).map(clave);
  const indice = (nombre: string) => cabecera.indexOf(nombre);

  const faltan = ['nombre', 'apellidos'].filter((c) => indice(c) === -1);
  if (faltan.length > 0) {
    return {
      ok: false,
      error:
        `Faltan columnas obligatorias en la cabecera: ${faltan.join(', ')}. ` +
        `Se esperan estas columnas: ${COLUMNAS_ESPERADAS.join(', ')}.`,
    };
  }

  const [clubes, perfiles, licencias] = await Promise.all([
    db.select({ id: club.id, name: club.name }).from(club),
    db.select({ email: userProfile.email }).from(userProfile),
    db
      .select({ rfeeLicense: athlete.rfeeLicense })
      .from(athlete)
      .where(isNotNull(athlete.rfeeLicense)),
  ]);

  const emailsExistentes = new Set(perfiles.map((p) => p.email.toLowerCase()));
  const licenciasExistentes = new Set(
    licencias.map((l) => (l.rfeeLicense ?? '').toLowerCase()),
  );
  const emailsEnElFichero = new Set<string>();
  const licenciasEnElFichero = new Set<string>();

  const filas: FilaCsv[] = [];

  for (let i = 1; i < lineas.length; i += 1) {
    const celdas = partirLinea(lineas[i], separador);
    const leer = (nombre: string) => {
      const pos = indice(nombre);
      return pos === -1 ? '' : (celdas[pos] ?? '').trim();
    };

    const errores: string[] = [];
    const avisos: string[] = [];

    const firstName = leer('nombre');
    const lastName = leer('apellidos');
    const email = leer('email').toLowerCase();
    const rolTexto = leer('rol');
    const clubName = leer('club');
    const fechaTexto = leer('fecha_nacimiento');
    const generoTexto = leer('genero');
    const armasTexto = leer('armas');
    const rfeeLicense = leer('licencia_rfee');
    const guardianEmail = leer('email_tutor').toLowerCase();
    const guardianName = leer('nombre_tutor');

    if (!firstName) errores.push('Falta el nombre.');
    if (!lastName) errores.push('Faltan los apellidos.');

    const role = rolTexto ? normalizarRol(rolTexto) : 'athlete';
    if (!role) errores.push(`Rol no reconocido: "${rolTexto}".`);

    const birthDate = fechaTexto ? normalizarFecha(fechaTexto) : null;
    if (fechaTexto && !birthDate) {
      errores.push(`Fecha de nacimiento no válida: "${fechaTexto}".`);
    }

    const gender = generoTexto ? normalizarGenero(generoTexto) : null;
    if (generoTexto && !gender) {
      errores.push(`Género no reconocido: "${generoTexto}".`);
    }

    const { armas, desconocidas } = normalizarArmas(armasTexto);
    if (desconocidas.length > 0) {
      avisos.push(`Armas que no se entienden y se ignoran: ${desconocidas.join(', ')}.`);
    }

    const esTirador = role === 'athlete';
    if (esTirador) {
      if (!birthDate) errores.push('Un tirador necesita fecha de nacimiento.');
      if (!gender) errores.push('Un tirador necesita género.');
      if (armas.length === 0) avisos.push('Sin arma indicada.');
    }

    const requiereTutor = Boolean(
      esTirador && birthDate && requiresGuardianAccount(birthDate),
    );

    if (requiereTutor) {
      if (!guardianEmail || !emailValido(guardianEmail)) {
        errores.push(
          `Menor de 14 años (${
            birthDate ? ageOn(birthDate) : '?'
          }): hace falta el correo del tutor, porque la cuenta no puede ser suya.`,
        );
      } else {
        avisos.push(
          `Menor de 14: la cuenta será de ${guardianEmail} y ${firstName} quedará ` +
            'como ficha vinculada, sin acceso propio.',
        );
      }
      if (email) {
        avisos.push(
          'Se ignora el correo del menor: por debajo de 14 años no se le crea cuenta.',
        );
      }
    } else if (!emailValido(email)) {
      errores.push(`Correo no válido: "${email}".`);
    }

    const correoCuenta = requiereTutor ? guardianEmail : email;
    if (correoCuenta) {
      if (emailsExistentes.has(correoCuenta)) {
        if (requiereTutor) {
          avisos.push(
            `El tutor ${correoCuenta} ya tiene cuenta: la ficha colgará de ella.`,
          );
        } else {
          errores.push(`Ya existe una cuenta con el correo ${correoCuenta}.`);
        }
      }
      if (emailsEnElFichero.has(correoCuenta) && !requiereTutor) {
        errores.push(`El correo ${correoCuenta} está repetido dentro del fichero.`);
      }
      emailsEnElFichero.add(correoCuenta);
    }

    let clubId: string | null = null;
    if (clubName) {
      const encontrado = clubes.find((c) => clave(c.name) === clave(clubName));
      if (encontrado) clubId = encontrado.id;
      else avisos.push(`El club "${clubName}" no existe todavía: la ficha quedará sin club.`);
    }

    if (rfeeLicense) {
      const l = rfeeLicense.toLowerCase();
      if (licenciasExistentes.has(l)) {
        errores.push(`La licencia ${rfeeLicense} ya figura en otra ficha.`);
      }
      if (licenciasEnElFichero.has(l)) {
        errores.push(`La licencia ${rfeeLicense} está repetida dentro del fichero.`);
      }
      licenciasEnElFichero.add(l);
    }

    filas.push({
      linea: i + 1,
      firstName,
      lastName,
      email,
      role,
      clubName,
      clubId,
      birthDate,
      gender,
      weapons: armas,
      rfeeLicense,
      guardianEmail,
      guardianName,
      requiereTutor,
      errores,
      avisos,
    });
  }

  return {
    ok: true,
    filas,
    cabeceraDetectada: cabecera,
    separador,
    validas: filas.filter((f) => f.errores.length === 0).length,
    conErrores: filas.filter((f) => f.errores.length > 0).length,
  };
}

/**
 * Importa las filas válidas.
 *
 * Se vuelve a analizar el mismo texto en el servidor en lugar de fiarse de lo
 * que mande el navegador: una acción de servidor es un endpoint público y las
 * filas podrían venir manipuladas.
 */
export async function importarUsuarios(
  texto: string,
): Promise<ResultadoAccion & { detalle?: string[] }> {
  await requireRole('admin');

  const analisis = await analizarCsv(texto);
  if (!analisis.ok) return { ok: false, error: analisis.error };

  const validas = analisis.filas.filter((f) => f.errores.length === 0);
  if (validas.length === 0) {
    return {
      ok: false,
      error: 'Ninguna fila es válida, así que no se ha importado nada.',
    };
  }

  const detalle: string[] = [];
  let creadosPerfiles = 0;
  let creadosTiradores = 0;

  // Los tutores se cachean: dos hermanos comparten la misma cuenta.
  const tutores = new Map<string, string>();

  for (const fila of validas) {
    const correoCuenta = fila.requiereTutor ? fila.guardianEmail : fila.email;

    let profileId = tutores.get(correoCuenta) ?? null;

    if (!profileId) {
      const [existente] = await db
        .select({ id: userProfile.id })
        .from(userProfile)
        .where(eq(userProfile.email, correoCuenta))
        .limit(1);
      profileId = existente?.id ?? null;
    }

    if (!profileId) {
      const [creado] = await db
        .insert(userProfile)
        .values({
          email: correoCuenta,
          fullName: fila.requiereTutor
            ? fila.guardianName || `Tutor de ${fila.firstName} ${fila.lastName}`
            : `${fila.firstName} ${fila.lastName}`,
          role: fila.requiereTutor ? 'guardian' : (fila.role ?? 'athlete'),
          clubId: fila.clubId,
          icalToken: newIcalToken(),
          inviteStatus: 'pendiente',
          invitedAt: new Date(),
        })
        .returning({ id: userProfile.id });
      profileId = creado.id;
      creadosPerfiles += 1;
    }

    if (fila.requiereTutor) tutores.set(correoCuenta, profileId);

    if (fila.role !== 'athlete') continue;

    const [fichaCreada] = await db
      .insert(athlete)
      .values({
        userProfileId: fila.requiereTutor ? null : profileId,
        guardianProfileId: fila.requiereTutor ? profileId : null,
        firstName: fila.firstName,
        lastName: fila.lastName,
        birthDate: fila.birthDate!,
        gender: fila.gender!,
        clubId: fila.clubId,
        rfeeLicense: fila.rfeeLicense || null,
      })
      .returning({ id: athlete.id });

    creadosTiradores += 1;

    if (fila.weapons.length > 0) {
      await db
        .insert(athleteWeapon)
        .values(
          fila.weapons.map((arma, i) => ({
            athleteId: fichaCreada.id,
            weapon: arma,
            primary: i === 0,
          })),
        )
        .onConflictDoNothing();
    }

    if (fila.requiereTutor) {
      detalle.push(
        `${fila.firstName} ${fila.lastName}: ficha vinculada a la cuenta de ` +
          `${correoCuenta} (menor de 14 años).`,
      );
    }
  }

  revalidatePath('/admin/usuarios');

  return {
    ok: true,
    message:
      `Importadas ${validas.length} filas: ${creadosPerfiles} cuentas nuevas y ` +
      `${creadosTiradores} fichas de tirador.` +
      (analisis.conErrores > 0
        ? ` Se han dejado fuera ${analisis.conErrores} filas con errores.`
        : ''),
    detalle,
  };
}

/** Últimas altas, para comprobar de un vistazo que ha entrado lo que tocaba. */
export async function ultimasAltas() {
  await requireRole('admin');

  const perfiles = await db
    .select({
      id: userProfile.id,
      fullName: userProfile.fullName,
      email: userProfile.email,
      role: userProfile.role,
      inviteStatus: userProfile.inviteStatus,
      createdAt: userProfile.createdAt,
      clubName: club.name,
    })
    .from(userProfile)
    .leftJoin(club, eq(userProfile.clubId, club.id))
    .orderBy(asc(userProfile.createdAt))
    .limit(50);

  const ids = perfiles.map((p) => p.id);
  const fichas =
    ids.length === 0
      ? []
      : await db
          .select({
            id: athlete.id,
            firstName: athlete.firstName,
            lastName: athlete.lastName,
            birthDate: athlete.birthDate,
            userProfileId: athlete.userProfileId,
            guardianProfileId: athlete.guardianProfileId,
          })
          .from(athlete)
          .where(
            or(
              inArray(athlete.userProfileId, ids),
              inArray(athlete.guardianProfileId, ids),
            ),
          );

  return { perfiles, fichas };
}

/** Comprueba si unos ids de club existen. Usado por la interfaz al validar. */
export async function clubesPorId(ids: string[]) {
  await requireRole('admin');
  if (ids.length === 0) return [];
  return db.select().from(club).where(inArray(club.id, ids));
}
