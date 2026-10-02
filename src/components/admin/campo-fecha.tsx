'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { esFechaIsoReal, formatDateEs } from '@/lib/utils';

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
 * acciones de servidor. Un texto que no es una fecha real sale como vacío,
 * salvo que el caller pida `conservarInvalido`: entonces sale el texto tal
 * cual, para que no se confunda con un campo dejado en blanco a propósito.
 */
export function CampoFecha({
  id,
  etiqueta,
  valorIso,
  onChange,
  ayuda,
  conservarInvalido = false,
}: {
  id: string;
  etiqueta: string;
  valorIso: string;
  onChange: (iso: string) => void;
  ayuda?: string;
  conservarInvalido?: boolean;
}) {
  const [texto, setTexto] = React.useState(() => textoDeCampo(valorIso));
  const ultimoEmitido = React.useRef(valorIso);

  // Si el formulario se rellena desde fuera (editar una fila), el campo sigue.
  // Lo que el propio campo acaba de emitir no cuenta: reescribirlo borraría el
  // texto a medio teclear cuando todavía no es una fecha.
  React.useEffect(() => {
    if (valorIso === ultimoEmitido.current) return;
    ultimoEmitido.current = valorIso;
    setTexto(textoDeCampo(valorIso));
  }, [valorIso]);

  const iso = aIso(texto);
  const vacio = texto.trim().length === 0;
  const invalido = !vacio && iso === null;
  const idAyuda = `${id}-ayuda`;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        value={texto}
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        aria-invalid={invalido}
        aria-describedby={idAyuda}
        onChange={(e) => {
          const emitido = valorEmitido(e.target.value, conservarInvalido);
          ultimoEmitido.current = emitido;
          setTexto(e.target.value);
          onChange(emitido);
        }}
      />
      <p
        id={idAyuda}
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return esFechaIsoReal(limpio) ? limpio : null;

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

/** Lo que el campo comunica al caller para un texto dado. */
export function valorEmitido(texto: string, conservarInvalido: boolean): string {
  const iso = aIso(texto);
  if (iso) return iso;
  return conservarInvalido && texto.trim().length > 0 ? texto : '';
}

/**
 * Texto con que se pinta un valor recibido del caller. Una fecha real se
 * muestra como `dd/mm/aaaa`; cualquier otra cosa se enseña tal cual para que
 * el usuario vea qué es lo que está mal en lugar de verlo reescrito.
 */
export function textoDeCampo(valor: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(valor) && esFechaIsoReal(valor.slice(0, 10))) return deIso(valor);
  return valor;
}

/** `aaaa-mm-dd` -> `dd/mm/aaaa`, para rellenar el campo al editar. */
export function deIso(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
