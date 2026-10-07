'use client';

import * as React from 'react';
import { InvitacionInstalacion } from './pwa/invitacion';

/**
 * Registra el trabajador de servicio de push y ofrece instalación discreta.
 *
 * Va en el `layout` y espera a `load`: registrarlo durante la carga le
 * quita ancho de banda a lo que el usuario está esperando ver.
 *
 * Sin `catch` ruidoso a propósito. Si el navegador no lo soporta, o está en
 * una pestaña privada, o el fichero no se sirve, la aplicación funciona
 * exactamente igual. La instalación depende del navegador y del manifiesto,
 * no de que el SW tenga una caché. Eso no merece un error
 * en la consola de todo el mundo.
 */
export function Instalable() {
  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const registrar = () => {
      void navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      }).catch(() => {});
    };

    if (document.readyState === 'complete') registrar();
    else {
      window.addEventListener('load', registrar, { once: true });
      return () => window.removeEventListener('load', registrar);
    }
  }, []);

  return <InvitacionInstalacion />;
}
