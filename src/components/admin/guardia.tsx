import { Lock } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { type Role, requireRole, type SessionProfile } from '@/lib/auth/session';

/**
 * Frontera de permisos de las pantallas de gestión y de «Tiradores».
 *
 * `requireRole` LANZA cuando el rol no encaja. Si nadie lo recoge, Next lo
 * convierte en un 500 y la persona se encuentra una pantalla de error genérica
 * que no explica nada: parece que la aplicación está rota cuando lo que pasa
 * es que esa sección no es para ella.
 *
 * Aquí se recoge y se devuelve el motivo tal cual lo escribe `requireRole`,
 * que ya está redactado para leerse. La pantalla responde 200 con una
 * explicación, no 500.
 *
 * Vive en `components/admin` y lo usa también `/tiradores` a propósito: la
 * regla tiene que ser exactamente la misma en las dos zonas, y duplicarla es
 * la forma de que un día dejen de coincidir.
 */
export type Acceso =
  | { ok: true; perfil: SessionProfile }
  | { ok: false; motivo: string; autenticado: boolean };

export async function exigirRol(...roles: Role[]): Promise<Acceso> {
  try {
    return { ok: true, perfil: await requireRole(...roles) };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);

    if (mensaje === 'NO_AUTENTICADO') {
      return {
        ok: false,
        autenticado: false,
        motivo: 'Tu sesión ha caducado. Vuelve a entrar con tu correo.',
      };
    }

    return { ok: false, autenticado: true, motivo: mensaje };
  }
}

/**
 * Lo que ve quien no tiene permiso.
 *
 * Dice qué pasa, por qué y qué hacer ahora. No pide perdón ni dibuja un
 * candado gigante: la persona no ha hecho nada mal, simplemente ha llegado a
 * una sección que no es suya.
 */
export function SinAcceso({
  titulo,
  motivo,
  autenticado = true,
}: {
  titulo: string;
  motivo: string;
  autenticado?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-3 py-16">
      <Lock className="size-6 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl sm:text-3xl">{titulo}</h1>
      <p className="medida text-sm text-muted-foreground">{motivo}</p>
      <p className="medida text-sm text-muted-foreground">
        {autenticado
          ? 'Si crees que deberías ver esta sección, pídeselo a la dirección técnica: ' +
            'da de alta los permisos desde Gestión › Ajustes.'
          : 'Entra otra vez y vuelve a intentarlo.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" asChild>
          <Link href="/">Volver al calendario</Link>
        </Button>
        {autenticado ? null : (
          <Button asChild>
            <Link href="/entrar">Entrar</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
