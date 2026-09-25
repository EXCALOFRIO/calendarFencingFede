'use client';

import './globals.css';

/**
 * ===========================================================================
 * ÚLTIMA RED: EL LAYOUT RAÍZ SE HA CAÍDO
 * ===========================================================================
 *
 * `global-error` sustituye al layout raíz entero, así que tiene que traer su
 * propio `<html>` y su propio `<body>`, y los estilos globales no le llegan
 * solos: por eso el `import` de arriba. Las tipografías sí se pierden —se
 * cargan con `next/font` en el layout que acaba de fallar—, y la hoja de
 * estilos deja como respaldo la sans del sistema. Es aceptable: esta
 * pantalla se ve una vez cada mucho y lo importante es que se lea.
 *
 * Aquí no se usan componentes de `src/components/ui` ni iconos: si lo que ha
 * reventado es el arranque de la aplicación, cuanto menos código haga falta
 * para pintar esto, más probable es que se pinte. Tampoco se enseña
 * `error.message`, que podría arrastrar detalles internos.
 *
 * Nota de Next 16: la recuperación es `retry()` —vuelve a pedir y a pintar—,
 * no el antiguo `reset()`.
 */
export default function ErrorGlobal({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="es" className="dark">
      <body className="antialiased">
        <title>Algo se ha roto · Calendario de Esgrima</title>
        <main className="mx-auto flex min-h-dvh w-full max-w-[1320px] flex-col items-start justify-center gap-3 px-4 py-16">
          <h1 className="text-2xl sm:text-3xl">La aplicación no ha arrancado</h1>
          <p className="medida text-sm text-muted-foreground">
            Ha fallado algo por nuestro lado. No se ha perdido nada de lo que
            tuvieras guardado: el calendario, tus inscripciones y tus datos
            siguen en su sitio. Prueba a cargarla otra vez.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Reintentar
            </button>
            <a
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-md border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Ir al calendario
            </a>
          </div>
          {error.digest ? (
            <p className="text-xs text-muted-foreground/70">
              Referencia del fallo: <span className="cifra">{error.digest}</span>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
