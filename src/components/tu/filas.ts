import type { Role } from '@/lib/auth/session';

/**
 * Filas de la pestaña «Tú» (`docs/diseno-sistema.md` § 1.1 y § 10.8). Cada
 * una abre una subpantalla. Lo que depende del papel vive aquí y no en la
 * barra, que es igual para todos:
 *
 *   tirador             perfil deportivo · Siguiendo · Mi estado ·
 *                       Convocatorias (si tiene alguna) · ajustes
 *   seleccionador       (perfil deportivo si tiene ficha) · Siguiendo ·
 *                       Convocatorias · Tiradores · ajustes
 *   dirección técnica   lo del seleccionador · Gestión
 *
 * Sin React, para probarlo solo.
 */
export type ClaveFila =
  | 'perfil-deportivo'
  | 'siguiendo'
  | 'estado'
  | 'convocatorias'
  | 'tiradores'
  | 'gestion'
  | 'notificaciones'
  | 'cuenta';

export type FilaTu = { clave: ClaveFila; etiqueta: string; href: string; detalle?: string };
export type SeccionTu = { clave: string; titulo: string | null; filas: FilaTu[] };

export type EntradaFilasTu = {
  role: Role;
  /** Ruta de la ficha propia confirmada, o `null` si la cuenta no la tiene vinculada. */
  fichaPropia: string | null;
  /** Convocatorias publicadas que afectan a los tiradores de la cuenta. */
  convocatorias: number;
};

export function seccionesDeTu({ role, fichaPropia, convocatorias: conv }: EntradaFilasTu): SeccionTu[] {
  const gestor = role === 'coach' || role === 'admin';
  const tirador = role === 'athlete';

  const propias: FilaTu[] = [];
  // Sin ficha vinculada, un tirador va a su cuenta, que es donde se vincula; a quien no compite no se le ofrece.
  if (fichaPropia) propias.push({ clave: 'perfil-deportivo', etiqueta: 'Mi perfil deportivo', href: fichaPropia });
  else if (tirador) propias.push({ clave: 'perfil-deportivo', etiqueta: 'Mi perfil deportivo', href: '/perfil', detalle: 'Sin vincular' });
  propias.push({ clave: 'siguiendo', etiqueta: 'Siguiendo', href: '/explorar/siguiendo' });
  if (tirador) propias.push({ clave: 'estado', etiqueta: 'Mi estado', href: '/estado' });

  const seleccion: FilaTu[] = [];
  if (gestor || conv > 0) {
    seleccion.push({
      clave: 'convocatorias',
      etiqueta: 'Convocatorias',
      href: '/convocatorias',
      ...(tirador && conv > 0 ? { detalle: conv.toLocaleString('es-ES') } : {}),
    });
  }
  if (gestor) seleccion.push({ clave: 'tiradores', etiqueta: 'Tiradores', href: '/tiradores' });
  if (role === 'admin') seleccion.push({ clave: 'gestion', etiqueta: 'Gestión', href: '/admin' });

  const ajustes: FilaTu[] = [
    { clave: 'notificaciones', etiqueta: 'Notificaciones', href: '/ajustes/notificaciones' },
    { clave: 'cuenta', etiqueta: 'Cuenta y calendarios', href: '/perfil' },
  ];

  return [
    { clave: 'tuyo', titulo: null, filas: propias },
    ...(seleccion.length > 0 ? [{ clave: 'seleccion', titulo: 'Selección', filas: seleccion }] : []),
    { clave: 'ajustes', titulo: 'Ajustes', filas: ajustes },
  ];
}
