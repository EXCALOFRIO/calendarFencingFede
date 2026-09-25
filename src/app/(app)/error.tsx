'use client';

import { KeyRound, Lock, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * ===========================================================================
 * FRONTERA DE ERROR DE LA APLICACIÓN
 * ===========================================================================
 *
 * Hasta ahora no había ninguna: `requireRole()` lanzaba y el navegador se
 * comía un **HTTP 500 en crudo**, con la pila de Next de fondo. Para alguien
 * que solo ha tocado un enlace que le enseñaba la propia aplicación, eso no
 * es un error, es una avería.
 *
 * Tres desenlaces distintos, porque lo que hay que hacer es distinto:
 *
 * 1. **La sesión ha caducado** → hay que volver a entrar.
 * 2. **La pantalla no es para esta cuenta** → reintentar no arregla nada; lo
 *    único útil es volver al calendario y, si toca, pedir el permiso.
 * 3. **Se ha roto algo** → reintentar tiene sentido, a veces es la base de
 *    datos que ha tardado de más.
 *
 * Lo que NUNCA se pinta aquí es `error.message`. En desarrollo trae el texto
 * del servidor y podría arrastrar detalles internos o datos de una persona.
 * Se usa solo para decidir cuál de los tres casos es, y se queda dentro.
 *
 * Aviso para quien venga después: en producción Next sustituye el mensaje de
 * los componentes de servidor por uno genérico, así que el caso 2 solo se
 * reconoce con seguridad en desarrollo. Por eso, en las secciones que sí
 * están restringidas por papel, el texto genérico también nombra la falta de
 * permiso como posible causa en vez de dar por hecho una avería. Lo limpio
 * sería que `requireRole()` lanzase un error con un código propio, pero
 * `src/lib/auth/session.ts` no es de este encargo.
 */

/** Secciones con el acceso restringido, y a quién pertenecen. */
const RESTRINGIDAS: [prefijo: string, dequien: string][] = [
  ['/admin', 'la dirección técnica'],
  ['/tiradores', 'los seleccionadores y la dirección técnica'],
];

function restriccion(pathname: string): string | null {
  return RESTRINGIDAS.find(([prefijo]) => pathname.startsWith(prefijo))?.[1] ?? null;
}

export default function ErrorAplicacion({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const pathname = usePathname();
  const dequien = restriccion(pathname);

  const mensaje = error.message ?? '';
  const caducada = /NO_AUTENTICADO/.test(mensaje);
  const sinPermiso = /Esta pantalla es para/.test(mensaje);

  if (caducada) {
    return (
      <Marco
        icono={<KeyRound className="size-6 text-muted-foreground" aria-hidden />}
        titulo="Tu sesión ha caducado"
        texto="Por seguridad, la sesión se cierra sola al cabo de unos días. Vuelve a entrar y sigues donde estabas."
      >
        <Button asChild>
          <Link href="/entrar">Entrar de nuevo</Link>
        </Button>
      </Marco>
    );
  }

  if (sinPermiso) {
    return (
      <Marco
        icono={<Lock className="size-6 text-muted-foreground" aria-hidden />}
        titulo="Esta pantalla no es para tu cuenta"
        texto={
          dequien
            ? `Aquí solo entra ${dequien}. Si tu papel ha cambiado, pídelo a la dirección técnica y lo ajusta en Gestión.`
            : 'Tu cuenta no tiene acceso a esta parte. Si crees que debería tenerlo, pídeselo a la dirección técnica.'
        }
      >
        <Button asChild>
          <Link href="/">Volver al calendario</Link>
        </Button>
      </Marco>
    );
  }

  return (
    <Marco
      icono={<TriangleAlert className="size-6 text-warn" aria-hidden />}
      titulo="No hemos podido abrir esta pantalla"
      texto={
        dequien
          ? `O tu cuenta no tiene acceso a esta parte —aquí solo entra ${dequien}— o ha fallado algo al cargarla. El calendario sigue funcionando.`
          : 'Ha fallado algo por nuestro lado, no por el tuyo. Nada de lo que hayas hecho se ha perdido: el calendario y tus inscripciones siguen ahí.'
      }
      referencia={error.digest}
    >
      <Button onClick={() => retry()}>Reintentar</Button>
      <Button variant="outline" asChild>
        <Link href="/">Volver al calendario</Link>
      </Button>
    </Marco>
  );
}

/**
 * Mismo esqueleto para los tres casos: icono, titular, dos líneas y las
 * salidas. Se parece a `EnObra` y a los estados vacíos a propósito —una
 * pantalla que no ha podido cargar no tiene por qué parecer de otra
 * aplicación.
 */
function Marco({
  icono,
  titulo,
  texto,
  referencia,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  texto: string;
  referencia?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-16">
      {icono}
      <h1 className="text-2xl">{titulo}</h1>
      <p className="medida text-sm text-muted-foreground">{texto}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
      {referencia ? (
        <p className="text-xs text-muted-foreground/70">
          Referencia del fallo: <span className="cifra">{referencia}</span>
        </p>
      ) : null}
    </div>
  );
}
