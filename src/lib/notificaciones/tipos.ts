/**
 * Vocabulario de las notificaciones. Sin imports de servidor: lo leen la
 * página de ajustes (cliente), los generadores y las pruebas.
 */

export type TipoAviso = 'inscripciones' | 'seguidos' | 'perfil' | 'calendario';
export type TipoNotificacion = TipoAviso | 'prueba';
export type Canal = 'campana' | 'push';

export const TIPOS_AVISO: readonly TipoAviso[] = ['inscripciones', 'seguidos', 'perfil', 'calendario'];
export const CANALES: readonly Canal[] = ['campana', 'push'];

export type ClavePreferencia = `tipo:${TipoAviso}` | `canal:${Canal}`;

export const CLAVES_PREFERENCIA: readonly ClavePreferencia[] = [
  ...TIPOS_AVISO.map((t) => `tipo:${t}` as const),
  ...CANALES.map((c) => `canal:${c}` as const),
];

export function esClavePreferencia(valor: unknown): valor is ClavePreferencia {
  return typeof valor === 'string' && (CLAVES_PREFERENCIA as readonly string[]).includes(valor);
}

/** Sin fila guardada todo está encendido: se apaga a propósito, no se enciende. */
export type Preferencias = Record<ClavePreferencia, boolean>;

export const PREFERENCIAS_POR_DEFECTO: Preferencias = Object.fromEntries(
  CLAVES_PREFERENCIA.map((c) => [c, true]),
) as Preferencias;

/**
 * Lo que se enseña en Ajustes: nombre y una línea de 60 caracteres como
 * mucho que diga qué hace (`docs/diseno-sistema.md` § 6).
 */
export const TEXTO_TIPO: Record<TipoAviso, { nombre: string; explicacion: string }> = {
  inscripciones: {
    nombre: 'Tus inscripciones',
    explicacion: 'Resultados de las pruebas en las que estáis inscritos.',
  },
  seguidos: {
    nombre: 'Siguiendo',
    explicacion: 'Resultados nuevos de quien sigues.',
  },
  perfil: {
    nombre: 'Tu perfil',
    explicacion: 'Resultados, ranking y estado olímpico tuyos y de tus tiradores.',
  },
  calendario: {
    nombre: 'Tu calendario',
    explicacion: 'Competiciones nuevas y cierres de inscripción en 3 días.',
  },
};

export const TEXTO_CANAL: Record<Canal, { nombre: string; explicacion: string }> = {
  campana: {
    nombre: 'Campana',
    explicacion: 'Guarda los avisos en la campana de la aplicación.',
  },
  push: {
    nombre: 'Móvil',
    explicacion: 'Te avisa aunque tengas la aplicación cerrada.',
  },
};

/** Texto de la etiqueta de cada tipo en la bandeja. */
export const ETIQUETA_TIPO: Record<TipoNotificacion, string> = {
  inscripciones: 'Inscripción',
  seguidos: 'Siguiendo',
  perfil: 'Tu perfil',
  calendario: 'Calendario',
  prueba: 'Prueba',
};

/** Una dirección interna de la aplicación, sin esquema, host ni `//`. */
export function esRutaInterna(url: unknown): url is string {
  return typeof url === 'string' && url.length <= 700 && /^\/(?![/\\])[^\s]*$/.test(url);
}
