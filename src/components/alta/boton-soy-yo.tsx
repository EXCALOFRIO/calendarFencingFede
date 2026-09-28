'use client';

import { Loader2, TriangleAlert, UserCheck } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/**
 * El botón con el que una persona dice que una ficha es la suya.
 *
 * Es lo único de esta pantalla que lleva JavaScript, y solo para una cosa:
 * quedarse en «Vinculando…» mientras el servidor trabaja. Sin eso, en una
 * conexión de móvil en un pabellón se pulsa tres veces —y esto es una acción
 * que escribe—. El formulario funciona igual sin JavaScript: `useFormStatus`
 * solo cambia lo que se pinta.
 */
export function BotonSoyYo() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" size="sm" className="w-fit" disabled={pending}>
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <UserCheck aria-hidden />
      )}
      {pending ? 'Vinculando…' : 'Sí, soy yo'}
    </Button>
  );
}

/**
 * Por qué no se pudo vincular.
 *
 * Vive con el botón porque son la misma conversación: se pulsa, y si no se
 * puede, se dice ahí mismo y con la razón concreta («esa ficha ya tiene
 * dueño», «tu cuenta ya tiene ficha»), no con un «ha habido un error».
 */
export function FalloAlVincular({ mensaje }: { mensaje: string }) {
  return (
    <p
      role="alert"
      className="medida flex items-start gap-2 text-sm text-danger"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{mensaje}</span>
    </p>
  );
}
