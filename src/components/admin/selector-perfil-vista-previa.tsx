'use client';

import * as React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/**
 * Perfil que se previsualiza. El formulario es una acción de servidor que lee
 * `profileId` del FormData, así que el valor viaja en un campo oculto con ese
 * nombre, como hacía el `<select>` nativo.
 */
export function SelectorPerfilVistaPrevia({
  id,
  perfiles,
  autoFocus = false,
}: {
  id: string;
  perfiles: readonly { id: string; fullName: string }[];
  autoFocus?: boolean;
}) {
  const [valor, setValor] = React.useState(perfiles[0]?.id ?? '');
  // Written out: until Radix mounts the options, `SelectValue` would be empty in the server HTML.
  const etiqueta = perfiles.find((p) => p.id === valor)?.fullName ?? '';
  return (
    <>
      <Select value={valor} onValueChange={setValor}>
        <SelectTrigger id={id} autoFocus={autoFocus} className="w-full min-w-0">
          <SelectValue>{etiqueta}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {perfiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <input type="hidden" name="profileId" value={valor} />
    </>
  );
}
