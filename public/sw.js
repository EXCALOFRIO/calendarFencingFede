/*
 * ===========================================================================
 * EL TRABAJADOR DE SERVICIO, Y POR QUÉ HACE TAN POCO
 * ===========================================================================
 *
 * Conserva push sin interceptar peticiones. Los navegadores modernos no
 * necesitan un manejador fetch para instalar una PWA.
 *
 * La caché HTTP normal ya reutiliza los estáticos según sus cabeceras.
 * No duplicamos esa política en Cache Storage: las fotos/iconos sin hash
 * podían quedarse obsoletos y la caché anterior no tenía límite.
 *
 * Nunca almacenamos HTML, RSC, API, feeds con token ni datos de sesión.
 * Instalar añade acceso desde el inicio y apertura standalone; no acelera
 * CPU/red ni ofrece funcionamiento sin conexión.
 */

self.addEventListener('install', (evento) => {
  // Sin precarga: no hay una lista de ficheros que se sepa de antemano, y
  // adivinarla es la forma de guardar cosas que no se usan.
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      // Retira únicamente nuestras antiguas cachés de estáticos.
      // No toca cookies, localStorage, otras cachés ni suscripciones push.
      const nombres = await caches.keys();
      await Promise.all(
        nombres.filter((n) => n.startsWith('calendarfencing-estaticos-')).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
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
