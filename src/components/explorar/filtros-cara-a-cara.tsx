'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  construirUrlCaraACara,
  FASE_FILTRO,
  type CriteriosCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-url';
import type { OpcionTemporada } from '@/lib/sport/explorar/url';
import { ARMAS, CampoSelect, agruparTemporadas } from './formulario-filtros';

/**
 * Filtros del cara a cara. El borrador vive en el estado del formulario y
 * sólo al aplicar se escribe en la URL con `router.push`: Atrás vuelve a la
 * consulta anterior y cada cambio empieza en la primera página. La página
 * remonta este componente (`key`) cuando cambia la URL.
 */
export function FiltrosCaraACara({
  personaId,
  criterios,
  temporadas,
}: {
  personaId: string;
  criterios: CriteriosCaraACara;
  temporadas: OpcionTemporada[];
}) {
  const router = useRouter();
  const [pendiente, empezar] = React.useTransition();
  const [borrador, setBorrador] = React.useState(criterios);
  const eligiendo = criterios.rival === '';
  const qCorta = eligiendo && borrador.q.trim().length === 1;

  const poner = (parcial: Partial<CriteriosCaraACara>) =>
    setBorrador((actual) => ({ ...actual, ...parcial }));

  const { sueltas, grupos } = agruparTemporadas(temporadas, borrador.temporada);

  return (
    <form
      role="search"
      aria-label={eligiendo ? 'Buscar rival' : 'Filtros del cara a cara'}
      aria-busy={pendiente}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (qCorta) return;
        empezar(() =>
          router.push(construirUrlCaraACara(personaId, { ...borrador, cursor: '', q: borrador.q.trim() })),
        );
      }}
    >
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
        {eligiendo ? (
          <div className="col-span-2 flex min-w-0 flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="h2h-q">Nombre del rival</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="h2h-q"
                type="search"
                value={borrador.q}
                maxLength={80}
                autoComplete="off"
                placeholder="Apellido, nombre o alias"
                className="pl-8"
                aria-invalid={qCorta}
                aria-describedby="h2h-q-ayuda"
                onChange={(e) => poner({ q: e.target.value })}
              />
            </div>
            <p id="h2h-q-ayuda" className={qCorta ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}>
              {qCorta
                ? 'Escribe al menos dos letras del nombre.'
                : 'Filtra los rivales con asaltos y busca a cualquier otra persona indexada.'}
            </p>
          </div>
        ) : null}

        <CampoSelect
          id="h2h-temporada"
          etiqueta="Temporada"
          valor={borrador.temporada}
          opciones={sueltas}
          grupos={grupos}
          textoVacio="Todas"
          onChange={(temporada) => poner({ temporada })}
        />

        {eligiendo ? null : (
          <>
            <CampoSelect
              id="h2h-arma"
              etiqueta="Arma"
              valor={borrador.arma}
              opciones={ARMAS}
              textoVacio="Todas"
              onChange={(arma) => poner({ arma })}
            />
            <CampoSelect
              id="h2h-fase"
              etiqueta="Fase"
              valor={borrador.fase}
              opciones={FASE_FILTRO.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta }))}
              textoVacio="Poule y eliminación"
              onChange={(fase) => poner({ fase })}
            />
          </>
        )}

        <Button type="submit" disabled={pendiente} className="col-span-2 md:col-span-1">
          {pendiente ? 'Aplicando…' : eligiendo ? 'Buscar' : 'Aplicar'}
        </Button>
      </div>
    </form>
  );
}
