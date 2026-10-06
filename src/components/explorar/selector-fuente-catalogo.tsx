'use client';

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Radix no admite una opción con valor vacío; este centinela nunca llega a la URL. */
const TODAS = 'todas';
const ETIQUETA_TODAS = 'Todas';
const ETIQUETA_DESCONOCIDA = 'Otra fuente';

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
  // El texto va escrito: sin él, `SelectValue` sale vacío hasta que Radix
  // monta las opciones, y en el HTML del servidor no las monta nunca.
  const etiqueta =
    valor === TODAS
      ? ETIQUETA_TODAS
      : (fuentes.find((f) => f.valor === valor)?.etiqueta ?? ETIQUETA_DESCONOCIDA);
  return (
    <>
      <Select value={valor} onValueChange={setValor}>
        <SelectTrigger id={id} size="sm" className="min-h-10 w-auto min-w-28 rounded-full bg-card px-4 data-[size=sm]:h-10">
          <SelectValue>{etiqueta}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODAS}>{ETIQUETA_TODAS}</SelectItem>
          {fuentes.map((f) => (
            <SelectItem key={f.valor} value={f.valor}>
              {f.etiqueta}
            </SelectItem>
          ))}
          {desconocida ? <SelectItem value={desconocida}>{ETIQUETA_DESCONOCIDA}</SelectItem> : null}
        </SelectContent>
      </Select>
      <input type="hidden" name="fuente" value={valor === TODAS ? '' : valor} />
    </>
  );
}
