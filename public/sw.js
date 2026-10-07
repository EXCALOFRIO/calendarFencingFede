/*
 * ===========================================================================
 * EL TRABAJADOR DE SERVICIO, Y POR QUÉ HACE TAN POCO
 * ===========================================================================
 *
 * Existe por un motivo concreto: Chrome en Android **no ofrece instalar la
 * aplicación** si no hay uno registrado con un manejador de `fetch`. Con el
 * manifiesto solo no aparece el aviso de instalación. El segundo motivo son
 * las notificaciones push, al final del fichero.
 *
 * Y hace lo mínimo a propósito. Un trabajador de servicio es la forma más
 * fácil que hay de romper una aplicación de manera invisible: se queda con
 * una copia de una página, el usuario la ve vieja durante días y no hay
 * forma de que se entere. Aquí se manejan plazos de inscripción —«cierra en
 * 1 día»— y convocatorias. Servir eso de una caché es peor que no funcionar:
 * es equivocarse con confianza.
 *
 * Así que la regla es una sola y no admite excepciones:
 *
 *   SOLO SE GUARDAN FICHEROS CON HUELLA EN EL NOMBRE.
 *
 * Es decir, lo que hay bajo `/_next/static/`, las fuentes y las imágenes de
 * `/iconos/`, `/banderas/` y `/fotos/`. Todo eso lleva un hash en la ruta o
 * no cambia nunca, así que una copia guardada **no puede quedar obsoleta**:
 * si el contenido cambia, cambia la URL.
 *
 * Lo que NO se toca, y va siempre a la red:
 *
 *   - el HTML de las páginas,
 *   - `/api/**`, incluida la autenticación,
 *   - las acciones de servidor (cualquier POST),
 *   - el feed iCal, que lleva un token dentro.
 *
 * Consecuencia honesta: esto **no da modo sin conexión**. Sin cobertura la
 * aplicación no se abre, igual que antes. Da instalación, arranque más
 * rápido y menos peticiones repetidas por los assets. Prometer lo otro sería
 * prometer un calendario que enseña plazos de la semana pasada.
 */

const CACHE = 'calendarfencing-estaticos-v1';

/** Solo estas rutas, y todas son inmutables o con huella en el nombre. */
const GUARDABLES = [/^\/_next\/static\//, /^\/iconos\//, /^\/banderas\//, /^\/fotos\//];

self.addEventListener('install', (evento) => {
  // Sin precarga: no hay una lista de ficheros que se sepa de antemano, y
  // adivinarla es la forma de guardar cosas que no se usan.
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      // Fuera las cachés de versiones anteriores. Sin esto, cada cambio de
      // `CACHE` deja la anterior ocupando sitio para siempre.
      const nombres = await caches.keys();
      await Promise.all(
        nombres.filter((n) => n.startsWith('calendarfencing-') && n !== CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo GET. Un POST es una acción de servidor o un acceso: jamás de caché.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Solo lo nuestro. Las imágenes de la FIE se enlazan y no se rehospedan,
  // y tampoco se guardan aquí.
  if (url.origin !== self.location.origin) return;

  if (!GUARDABLES.some((r) => r.test(url.pathname))) return;

  evento.respondWith(
    (async () => {
      const guardado = await caches.match(peticion);
      if (guardado) return guardado;

      const respuesta = await fetch(peticion);
      // Solo se guardan las respuestas buenas y completas: guardar un 404 o
      // un 206 es servir ese 404 hasta que alguien cambie la versión.
      if (respuesta.ok && respuesta.status === 200) {
        const cache = await caches.open(CACHE);
        cache.put(peticion, respuesta.clone());
      }
      return respuesta;
    })(),
  );
});

/*
 * ===========================================================================
 * NOTIFICACIONES PUSH
 * ===========================================================================
 *
 * El servidor (`src/lib/notificaciones/push/`) manda un JSON cifrado
 * `{ titulo, cuerpo, url, etiqueta }`; el navegador lo descifra antes de
 * llegar aquí. `etiqueta` hace que un aviso actualizado sustituya al anterior
 * en vez de apilarse. `url` es SIEMPRE una ruta interna: si llega otra cosa,
 * se abre la bandeja.
 *
 * En iPhone esto solo funciona con la aplicación añadida a la pantalla de
 * inicio (iOS 16.4 o posterior), y Safari exige mostrar SIEMPRE una
 * notificación por cada push: por eso nunca se sale sin `showNotification`.
 */

const RUTA_BANDEJA = '/notificaciones';

function rutaSegura(url) {
  return typeof url === 'string' && /^\/(?![/\\])[^\s]*$/.test(url) ? url : RUTA_BANDEJA;
}

self.addEventListener('push', (evento) => {
  let datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch {
    datos = {};
  }
  const titulo = typeof datos.titulo === 'string' && datos.titulo ? datos.titulo : 'CalendarFencing';
  const opciones = {
    body: typeof datos.cuerpo === 'string' ? datos.cuerpo : '',
    tag: typeof datos.etiqueta === 'string' && datos.etiqueta ? datos.etiqueta : undefined,
    icon: '/iconos/icono-192.png',
    badge: '/iconos/icono-192.png',
    lang: 'es-ES',
    data: { url: rutaSegura(datos.url) },
  };
  evento.waitUntil(
    (async () => {
      await self.registration.showNotification(titulo, opciones);
      // Con la aplicación abierta, la campana se actualiza sin esperar a su sondeo.
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const v of ventanas) v.postMessage({ tipo: 'notificacion' });
    })(),
  );
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const destino = new URL(rutaSegura(evento.notification.data && evento.notification.data.url), self.location.origin).href;
  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reutiliza una ventana de la aplicación si hay una abierta, en vez de abrir otra.
      for (const v of ventanas) {
        if (new URL(v.url).origin === self.location.origin && 'navigate' in v) {
          await v.focus();
          return v.navigate(destino);
        }
      }
      return self.clients.openWindow(destino);
    })(),
  );
});
