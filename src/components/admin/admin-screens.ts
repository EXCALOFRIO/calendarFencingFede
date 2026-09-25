import {
  Activity,
  FileCheck2,
  FileSearch,
  Inbox,
  Link2,
  Scale,
  ShieldAlert,
  UserCog,
  Users,
} from 'lucide-react';

/**
 * Índice de la gestión.
 *
 * Una sola lista, en un solo sitio: la usa la portada del panel, la tira de
 * navegación de la cabecera y el buscador. Tener el índice repetido en tres
 * ficheros es como acaban apareciendo secciones que existen en el menú y no
 * en la portada.
 *
 * El orden no es alfabético: va de lo que caduca (inscripciones, que tienen
 * plazo) a lo que casi nunca se toca (ajustes del equipo).
 */

/** Contadores que la portada calcula y enseña al lado de cada sección. */
export type ClaveContador =
  | 'inscripciones'
  | 'cuarentena'
  | 'emparejar'
  | 'fuentes'
  | 'usuarios';

export type PantallaAdmin = {
  href: string;
  titulo: string;
  /** Una línea. Lo que se resuelve ahí, no lo que es. */
  resumen: string;
  icono: typeof Inbox;
  contador?: ClaveContador;
  /** Palabra del contador, en singular y plural. */
  unidad?: [string, string];
};

export const PANTALLAS_ADMIN: PantallaAdmin[] = [
  {
    href: '/admin/inscripciones',
    titulo: 'Inscripciones',
    resumen:
      'Bandeja federativa: lo que ya validó el club, esperando el visto bueno de la RFEE y el envío.',
    icono: Inbox,
    contador: 'inscripciones',
    unidad: ['esperando', 'esperando'],
  },
  {
    href: '/admin/emparejar',
    titulo: 'Emparejar resultados',
    resumen:
      'Resultados que llegaron sin licencia y no se han podido asignar a ningún tirador.',
    icono: Link2,
    contador: 'emparejar',
    unidad: ['sin emparejar', 'sin emparejar'],
  },
  {
    href: '/admin/cuarentena',
    titulo: 'Cuarentena',
    resumen: 'Filas que no validaron al leerlas de la fuente, con el motivo exacto.',
    icono: ShieldAlert,
    contador: 'cuarentena',
    unidad: ['pendiente', 'pendientes'],
  },
  {
    href: '/admin/salud',
    titulo: 'Salud de la ingestión',
    resumen: 'Última ejecución de cada fuente y botón para actualizar ahora mismo.',
    icono: Activity,
    contador: 'fuentes',
    unidad: ['fuente con retraso', 'fuentes con retraso'],
  },
  {
    href: '/admin/extraccion',
    titulo: 'Extracción de circulares',
    resumen:
      'Plazos, cuotas, horarios y sedes que un modelo ha sacado del PDF, cada uno con la frase del documento, para aprobarlos o rechazarlos.',
    icono: FileSearch,
  },
  {
    href: '/admin/normativa',
    titulo: 'Normativa',
    resumen:
      'Plazos y recargos, categorías de la temporada y reglas del ranking, cada valor con su documento.',
    icono: Scale,
  },
  {
    href: '/admin/usuarios',
    titulo: 'Usuarios',
    resumen: 'Alta de una persona e importación de un CSV con previsualización.',
    icono: Users,
    contador: 'usuarios',
    unidad: ['cuenta', 'cuentas'],
  },
  {
    href: '/admin/ajustes',
    titulo: 'Ajustes',
    resumen:
      'Quién es dirección técnica y quién lleva cada arma. Es lo que abre el panel.',
    icono: UserCog,
  },
];

/** Etiqueta corta para la tira de navegación, donde no cabe el título largo. */
export const TITULO_CORTO: Record<string, string> = {
  '/admin': 'Portada',
  '/admin/inscripciones': 'Inscripciones',
  '/admin/emparejar': 'Emparejar',
  '/admin/cuarentena': 'Cuarentena',
  '/admin/salud': 'Ingestión',
  '/admin/extraccion': 'Extracción',
  '/admin/normativa': 'Normativa',
  '/admin/usuarios': 'Usuarios',
  '/admin/ajustes': 'Ajustes',
};

export const ICONO_PORTADA = FileCheck2;
