import { PgDialect } from 'drizzle-orm/pg-core';
import type { SessionProfile } from '@/lib/auth/session';
import type { ContextoExplorador } from '@/lib/sport/explorar/contexto';

/**
 * Contexto CONTROLADO del explorador: registra el SQL y los parámetros que
 * genera Drizzle y responde con filas fijadas por el caso. No hay PostgreSQL,
 * Neon ni sesión reales: demuestra guardas, forma de las consultas, cursores y
 * DTO, no el resultado de ejecutar el SQL en la base.
 */
export type Sentencia = { text: string; params: unknown[] };

type Respuesta = { cuando: RegExp; filas: unknown[] | ((s: Sentencia) => unknown[]) };

export const ABIERTO = { identidad: true, referencias: true };

export const perfil = (sobre: Partial<SessionProfile> = {}): SessionProfile => ({
  authUserId: 'auth-1',
  email: 'cuenta@example.test',
  profileId: '00000000-0000-4000-8000-0000000000a1',
  fullName: 'Cuenta de prueba',
  role: 'athlete',
  clubId: null,
  clubName: null,
  icalToken: 'token-privado',
  weapons: [],
  ...sobre,
});

export function crearContexto(
  opciones: {
    perfil?: SessionProfile | null;
    respuestas?: Respuesta[];
    esquema?: { identidad: boolean; referencias: boolean };
    propietario?: Partial<ContextoExplorador['propietario']>;
  } = {},
) {
  const sentencias: Sentencia[] = [];
  const dialecto = new PgDialect();
  const respuestas = opciones.respuestas ?? [];

  const ctx: ContextoExplorador = {
    db: {
      execute: ((consulta: never) => {
        const { sql, params } = dialecto.sqlToQuery(consulta);
        const sentencia = { text: sql, params };
        sentencias.push(sentencia);
        const r = respuestas.find((x) => x.cuando.test(sql));
        const filas = r ? (typeof r.filas === 'function' ? r.filas(sentencia) : r.filas) : [];
        return Promise.resolve({ rows: filas });
      }) as never,
    },
    perfil: async () => (opciones.perfil === undefined ? perfil() : opciones.perfil),
    esquema: async () => opciones.esquema ?? ABIERTO,
    hoy: () => '2026-10-02',
    propietario: {
      atletasDeCuenta: async () => [],
      personasEnlazadas: async () => [],
      fichasFiePorAtleta: async () => [],
      evidencia: {
        esquema: async () => opciones.esquema ?? ABIERTO,
        atletasPorLicencia: async () => [],
        fichasFie: async () => [],
        externos: async () => [],
        personas: async () => new Map(),
      },
      ...opciones.propietario,
    },
  };
  return { ctx, sentencias, texto: () => sentencias.map((s) => s.text).join('\n;\n') };
}

/** Respuestas para `resolverPersona`: una persona sin fusiones, o el grupo dado. */
export function personaSimple(id: string, grupo: string[] = [id]): Respuesta[] {
  return [
    { cuando: /WITH RECURSIVE cadena/, filas: [{ id }] },
    { cuando: /WITH RECURSIVE grupo/, filas: grupo.map((g) => ({ id: g })) },
  ];
}

export const UUID_A = '11111111-1111-4111-8111-111111111111';
export const UUID_B = '22222222-2222-4222-8222-222222222222';
export const UUID_C = '33333333-3333-4333-8333-333333333333';

/** Nada de esto puede aparecer nunca en un DTO del explorador. */
export const CLAVES_PRIVADAS = [
  'email',
  'correo',
  'consent',
  'consentSignedAt',
  'guardian',
  'tutor',
  'birthDate',
  'fechaNacimiento',
  'athleteId',
  'userProfileId',
  'profileId',
  'icalToken',
  'rfeeLicense',
  'fieLicense',
  'licencia',
  'rankingInterno',
  'snapshot',
  'totalPoints',
  'photo',
  'foto',
];

export function clavesDe(valor: unknown, salida = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((v) => clavesDe(v, salida));
  else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      salida.add(k);
      clavesDe(v, salida);
    }
  }
  return salida;
}
