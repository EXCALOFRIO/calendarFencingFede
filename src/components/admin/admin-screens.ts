import {
  Activity,
  FileCheck2,
  FileSearch,
  Inbox,
  Link2,
  Medal,
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
 * El orden no es alfabético: va de lo que caduca (resultados sin emparejar y
 * filas en cuarentena, que bloquean el calendario) a lo que casi nunca se toca
 * (ajustes del equipo).
 *
 * -------------------------------------------------------------------------
 * «INSCRIPCIONES» NO ESTÁ EN ESTA LISTA, Y ES A PROPÓSITO
 * -------------------------------------------------------------------------
 * `/admin/inscripciones` sigue existiendo y sigue funcionando por URL, pero
 * se ha sacado del índice. El menú es donde la aplicación declara para qué
 * sirve, y esta ya no sirve para inscribirse: sirve para planificarse. La
 * bandeja además estaba construida alrededor de un club que validaba, y el
 * club dejó de ser un papel (`Role` ya no lo tiene).
 *
 * La razón para no borrarla está en la cabecera de
 * `src/app/(app)/admin/inscripciones/page.tsx`. Y `src/lib/entries/` se queda
 * entero: se oculta, no se destruye.
 */

/** Contadores que la portada calcula y enseña al lado de cada sección. */
export type ClaveContador = 'cuarentena' | 'emparejar' | 'fuentes' | 'usuarios';

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
  /*
    CONVOCATORIAS Y TIRADORES VIVEN AQUÍ DESDE QUE SALIERON DE LA BARRA.

    El usuario las quitó de la navegación —*«esas secciones fuera, no las
    entiendo»*— y tenía razón en que un tirador no necesita ir a una sección
    para enterarse de que está convocado: eso le sale solo, en «Mi estado»,
    con la banda de oro.

    Pero quien publica la convocatoria es la dirección técnica, y sin una
    puerta se quedaba sin poder convocar salvo escribiendo la URL a mano. Así
    que pasan a Gestión, que es donde están las cosas que se HACEN, no las que
    se miran. Fuera de la barra y a un clic.
  */
  {
    href: '/convocatorias',
    titulo: 'Convocatorias',
    resumen: 'Publicar una convocatoria de selección y ver quién ha confirmado.',
    icono: Medal,
  },
  {
    href: '/tiradores',
    titulo: 'Tiradores',
    resumen: 'Los tiradores de tus armas, con su puesto y su licencia.',
    icono: Users,
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

/**
 * Etiqueta corta para la tira de navegación, donde no cabe el título largo.
 *
 * `/admin/inscripciones` sigue aquí aunque no esté en `PANTALLAS_ADMIN`: si
 * alguien entra por URL, la tira tiene que saber cómo llamar a la pantalla en
 * la que está. Sin esto se pintaba la ruta en crudo.
 */
export const TITULO_CORTO: Record<string, string> = {
  '/admin': 'Portada',
  '/admin/emparejar': 'Emparejar',
  '/admin/cuarentena': 'Cuarentena',
  '/admin/salud': 'Ingestión',
  '/admin/extraccion': 'Extracción',
  '/admin/normativa': 'Normativa',
  '/admin/usuarios': 'Usuarios',
  '/admin/ajustes': 'Ajustes',
  '/admin/inscripciones': 'Inscripciones',
};

export const ICONO_PORTADA = FileCheck2;
