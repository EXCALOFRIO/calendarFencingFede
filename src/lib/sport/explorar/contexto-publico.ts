import { db } from '@/db';
import type { SessionProfile } from '@/lib/auth/session';
import { esquemaDeportivo } from '@/lib/sport/esquema-db';
import type { ContextoExplorador } from './contexto';
import type { DepsPropietario } from './propietario';
import { indiceExplorarDisponible } from './indice-db';

/**
 * Contexto de los cargadores de la caché compartida (`cache-pantallas.ts`).
 *
 * Lo que se calcula con él lo verá cualquier cuenta, así que no lleva la
 * sesión de nadie: la guarda de sesión se hace con el contexto real ANTES de
 * entrar en la caché, y aquí `perfil()` responde con un lector anónimo sin
 * identidad (para que las lecturas comunes pasen su `exigirPerfil`) y todo lo
 * que depende de la cuenta (`propietario`: «es mío», fichas propias) falla.
 */
export const LECTOR_PUBLICO: Readonly<SessionProfile> = Object.freeze({
  authUserId: '',
  email: '',
  profileId: '',
  fullName: '',
  role: 'athlete',
  clubId: null,
  clubName: null,
  icalToken: '',
  weapons: Object.freeze([]) as unknown as SessionProfile['weapons'],
});

const ERROR_CUENTA = 'CONTEXTO_PUBLICO_SIN_CUENTA';

async function sinCuenta(): Promise<never> {
  throw new Error(ERROR_CUENTA);
}

const PROPIETARIO_VETADO: DepsPropietario = {
  atletasDeCuenta: sinCuenta,
  personasEnlazadas: sinCuenta,
  fichasFiePorAtleta: sinCuenta,
  evidencia: new Proxy({} as DepsPropietario['evidencia'], { get: () => sinCuenta }),
};

type Base = Pick<ContextoExplorador, 'db' | 'esquema' | 'indiceExplorar'>;

const REAL: Base = { db, esquema: esquemaDeportivo, indiceExplorar: indiceExplorarDisponible };

/** `hoy` es parte de la clave de quien lo usa: el valor cacheado no puede depender de otro día. */
export function contextoPublico(hoy: string, base: Base = REAL): ContextoExplorador {
  return {
    ...base,
    perfil: async () => LECTOR_PUBLICO as SessionProfile,
    propietario: PROPIETARIO_VETADO,
    hoy: () => hoy,
  };
}
