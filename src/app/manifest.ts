import type { MetadataRoute } from 'next';

/**
 * ===========================================================================
 * EL MANIFIESTO: LO QUE HACE QUE SE PUEDA INSTALAR EN EL MÓVIL
 * ===========================================================================
 *
 * Sin esto, en Android no aparece «Instalar aplicación» en ningún sitio. En
 * iPhone «Añadir a pantalla de inicio» sí funcionaba ya —Safari se conforma
 * con `apple-mobile-web-app-capable` y el `apple-touch-icon`, que están en el
 * `layout.tsx` desde el principio—, pero sin manifiesto abría con la barra
 * de Safari encima y no como una aplicación.
 *
 * Es una ruta y no un fichero estático porque Next lo publica así
 * (`app/manifest.ts` → `/manifest.webmanifest`) y de paso queda tipado: un
 * manifiesto con una clave mal escrita no falla, simplemente **no instala**,
 * y eso se descubre tarde y a mano.
 *
 * ---------------------------------------------------------------------------
 * LAS DECISIONES QUE NO SON OBVIAS
 * ---------------------------------------------------------------------------
 * `start_url: '/'` y no `/entrar`. La aplicación arranca donde arranca para
 * todo el mundo, y si no hay sesión el propio servidor redirige a `/entrar`.
 * Apuntar el atajo a la pantalla de acceso significaría que quien ya ha
 * entrado —que es el caso normal, la sesión dura una semana— pasa por una
 * redirección de más cada vez que abre el icono.
 *
 * `display: 'standalone'` y no `fullscreen`: hace falta la barra de estado
 * con la hora y la batería. Esto es una herramienta que se mira de pie en un
 * pabellón, no un juego.
 *
 * Dos iconos por tamaño, uno normal y otro `maskable`. Android recorta el
 * icono con la forma del lanzador —círculo, gota, cuadrado redondeado— y un
 * icono normal pierde ahí las esquinas, que en el nuestro son el cuadrado
 * rojo de la marca. El `maskable` lleva el dibujo al 78 % sobre rojo a
 * sangre para que sobreviva a cualquier recorte; lo genera
 * `scripts/iconos-pwa.mjs`.
 *
 * `orientation` no se fija. Bloquear a vertical es lo que apetece —el
 * calendario está pensado en vertical— pero le quita al usuario una decisión
 * que es suya, y en horizontal la vista de tres meses se ve mejor.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CalendarFencing',
    /* Lo que cabe debajo del icono en la pantalla de inicio: doce caracteres. */
    short_name: 'CalendarF',
    description:
      'El calendario de la selección española de esgrima: RFEE, FIE y ' +
      'circuito europeo en un solo sitio, filtrado por tu arma, tu género y ' +
      'tu categoría, con los plazos y las convocatorias.',
    lang: 'es-ES',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    /* Los mismos del tema oscuro: `--background` y la barra de estado. */
    background_color: '#09090b',
    theme_color: '#09090b',
    categories: ['sports', 'productivity'],
    icons: [
      {
        src: '/iconos/icono-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/iconos/icono-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/iconos/icono-192-maskable.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/iconos/icono-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    /*
      Atajos al mantener pulsado el icono. Los dos sitios a los que se va, y
      no más: una lista larga de atajos es un menú que nadie lee.
    */
    shortcuts: [
      { name: 'Calendario', url: '/' },
      { name: 'Ranking', url: '/ranking' },
    ],
  };
}
