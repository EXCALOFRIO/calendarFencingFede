'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateEs } from '@/lib/utils';

/**
 * Campo de fecha.
 *
 * No se usa `<input type="date">` a propósito: cada navegador pinta el suyo,
 * en el móvil abre una rueda del sistema que no respeta el tema y en
 * escritorio el formato depende del idioma del sistema operativo, no del de
 * la aplicación. Aquí se escribe en el formato que usa la gente en España
 * (dd/mm/aaaa) y debajo se confirma en palabras lo que se ha entendido, que
 * es lo que de verdad evita guardar el 3 de abril creyendo que es el 4 de
 * marzo.
 *
 * Hacia fuera siempre habla en ISO (`aaaa-mm-dd`), que es lo que esperan las
 * acciones de servidor.
 */
export function CampoFecha({
  id,
  etiqueta,
  valorIso,
  onChange,
  ayuda,
}: {
  id: string;
  etiqueta: string;
  valorIso: string;
  onChange: (iso: string) => void;
  ayuda?: string;
}) {
  const [texto, setTexto] = React.useState(() => deIso(valorIso));

  // Si el formulario se rellena desde fuera (editar una fila), el campo sigue.
  React.useEffect(() => {
    setTexto(deIso(valorIso));
  }, [valorIso]);

  const iso = aIso(texto);
  const vacio = texto.trim().length === 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        value={texto}
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        aria-invalid={!vacio && iso === null}
        onChange={(e) => {
          setTexto(e.target.value);
          onChange(aIso(e.target.value) ?? '');
        }}
      />
      <p
        className={
          !vacio && iso === null ? 'text-xs text-danger' : 'text-xs text-muted-foreground'
        }
      >
        {vacio
          ? (ayuda ?? 'Déjalo en blanco si no aplica.')
          : iso
            ? formatDateEs(iso)
            : 'No se entiende esa fecha. Escríbela como 03/10/2026.'}
      </p>
    </div>
  );
}

/** `dd/mm/aaaa` (también con guiones o puntos) -> `aaaa-mm-dd`, o null. */
export function aIso(texto: string): string | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return limpio;

  const partes = limpio.split(/[/\-.]/).map((p) => p.trim());
  if (partes.length !== 3) return null;

  const [d, m, a] = partes.map(Number);
  if (!d || !m || !a || m > 12 || d > 31 || partes[2].length !== 4) return null;

  const iso = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Comprobación real: el 31/02 pasa los rangos y no existe.
  const prueba = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(prueba.getTime()) || prueba.getUTCDate() !== d) return null;
  return iso;
}

/** `aaaa-mm-dd` -> `dd/mm/aaaa`, para rellenar el campo al editar. */
export function deIso(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
