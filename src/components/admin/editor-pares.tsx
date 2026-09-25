'use client';

import { Plus, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Editor de pares clave → número.
 *
 * Los coeficientes por circuito y la tabla de puesto a puntos se guardan como
 * JSON, pero NO se escriben como JSON: una llave mal cerrada en un textarea
 * deja el ranking de toda una temporada sin calcular, y el error se descubre
 * semanas después. Aquí cada par es un campo y lo que viaja al servidor es
 * JSON generado, no tecleado.
 */
export type Par = { clave: string; valor: string };

export function paresDesde(mapa: Record<string, number>): Par[] {
  return Object.entries(mapa).map(([clave, valor]) => ({
    clave,
    valor: String(valor),
  }));
}

export function paresAJson(pares: Par[]): string {
  const salida: Record<string, number> = {};
  for (const p of pares) {
    const clave = p.clave.trim();
    if (!clave) continue;
    const n = Number(p.valor.replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    salida[clave] = n;
  }
  return JSON.stringify(salida);
}

export function EditorPares({
  etiqueta,
  ayuda,
  pares,
  onChange,
  clavesSugeridas,
  etiquetaClave,
  etiquetaValor,
  claveNumerica = false,
}: {
  etiqueta: string;
  ayuda: string;
  pares: Par[];
  onChange: (pares: Par[]) => void;
  /** Lista cerrada de claves (circuitos). Si no se pasa, la clave es libre. */
  clavesSugeridas?: { valor: string; etiqueta: string }[];
  etiquetaClave: string;
  etiquetaValor: string;
  claveNumerica?: boolean;
}) {
  const cambiar = (i: number, cambio: Partial<Par>) => {
    onChange(pares.map((p, j) => (i === j ? { ...p, ...cambio } : p)));
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{etiqueta}</legend>
      <p className="medida text-xs text-muted-foreground">{ayuda}</p>

      {pares.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Todavía no hay ninguno. Añade el primero con el botón de abajo.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pares.map((par, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {clavesSugeridas ? (
                <Select
                  value={par.clave}
                  onValueChange={(valor) => cambiar(i, { clave: valor })}
                >
                  <SelectTrigger
                    className="h-8 flex-1"
                    aria-label={`${etiquetaClave} ${i + 1}`}
                  >
                    <SelectValue placeholder={etiquetaClave} />
                  </SelectTrigger>
                  <SelectContent>
                    {clavesSugeridas.map((c) => (
                      <SelectItem key={c.valor} value={c.valor}>
                        {c.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={par.clave}
                  inputMode={claveNumerica ? 'numeric' : 'text'}
                  onChange={(e) => cambiar(i, { clave: e.target.value })}
                  placeholder={etiquetaClave}
                  aria-label={`${etiquetaClave} ${i + 1}`}
                  className="h-8 w-24"
                />
              )}

              <Input
                value={par.valor}
                inputMode="decimal"
                onChange={(e) => cambiar(i, { valor: e.target.value })}
                placeholder={etiquetaValor}
                aria-label={`${etiquetaValor} ${i + 1}`}
                className="h-8 w-24"
              />

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Quitar ${par.clave || `el par ${i + 1}`}`}
                onClick={() => onChange(pares.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...pares, { clave: '', valor: '' }])}
        >
          <Plus /> Añadir
        </Button>
        <Label className="text-xs font-normal text-muted-foreground">
          {pares.length} {pares.length === 1 ? 'valor' : 'valores'}
        </Label>
      </div>
    </fieldset>
  );
}
