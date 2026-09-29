'use client';

import * as React from 'react';

/**
 * Registra el trabajador de servicio, que es lo que hace que Android ofrezca
 * instalar la aplicación.
 *
 * No pinta nada. Va en el `layout` para que se registre en cuanto se abre
 * cualquier pantalla, y espera a `load`: registrarlo durante la carga le
 * quita ancho de banda a lo que el usuario está esperando ver.
 *
 * Sin `catch` ruidoso a propósito. Si el navegador no lo soporta, o está en
 * una pestaña privada, o el fichero no se sirve, la aplicación funciona
 * exactamente igual — solo que no se puede instalar. Eso no merece un error
 * en la consola de todo el mundo.
 */
export function Instalable() {
  React.useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const registrar = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };

    if (document.readyState === 'complete') registrar();
    else {
      window.addEventListener('load', registrar, { once: true });
      return () => window.removeEventListener('load', registrar);
    }
  }, []);

  return null;
}
