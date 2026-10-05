'use client';

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Radix no admite una opción con valor vacío; este centinela nunca llega a la URL. */
const TODAS = 'todas';

/**
 * Selector de fuente del catálogo. El formulario es GET y sin JavaScript de
 * envío, así que el valor viaja en un campo oculto con el mismo `name` que
 * tenía el `<select>` nativo: «todas» se envía vacío, como antes.
 */
export function SelectorFuenteCatalogo({
  id,
  valorInicial,
  fuentes,
  desconocida,
}: {
  id: string;
  valorInicial: string;
  fuentes: readonly { valor: string; etiqueta: string }[];
  /** Fuente de la URL que no está en la lista: se conserva para no ampliar la búsqueda sin avisar. */
  desconocida: string | null;
}) {
  const [valor, setValor] = React.useState(valorInicial === '' ? TODAS : valorInicial);
  return (
    <>
      <Select value={valor} onValueChange={setValor}>
        <SelectTrigger id={id} className="min-h-11 w-full bg-secondary">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODAS}>Todas las fuentes</SelectItem>
          {fuentes.map((f) => (
            <SelectItem key={f.valor} value={f.valor}>
              {f.etiqueta}
            </SelectItem>
          ))}
          {desconocida ? <SelectItem value={desconocida}>Fuente no reconocida</SelectItem> : null}
        </SelectContent>
      </Select>
      <input type="hidden" name="fuente" value={valor === TODAS ? '' : valor} />
    </>
  );
}
