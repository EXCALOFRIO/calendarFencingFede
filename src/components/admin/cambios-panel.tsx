'use client';

import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { marcarCancelada } from '@/app/(app)/admin/salud/actions';
import type { SospechaCambio } from '@/app/(app)/admin/consultas';
import { Boton } from '@/components/sistema/boton';
import { EstadoVacio } from '@/components/sistema/estado-vacio';

const ROTULO: Record<SospechaCambio['tipo'], string> = {
  RETIRADA_FIE: 'Retirada por la FIE',
  SIN_RASTRO_FIE: 'Sin rastro en la FIE',
  DESAPARECIDA: 'Desapareció de su fuente',
  FECHA_DISTINTA: 'Fecha distinta en la FIE',
};

/**
 * Los cambios que la ingesta sospecha pero no decide: cancelaciones,
 * torneos movidos, competiciones que se evaporaron de una fuente y no de
 * otra. Palma dejó claro el hueco — Skermo seguía listándola con la FIE
 * ya fuera— y esta bandeja es donde se ve antes de que lo cuente WhatsApp.
 * Proponer sí, marcar no: cancelarla es un clic de una persona.
 */
export function CambiosPanel({ sospechas }: { sospechas: SospechaCambio[] }) {
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [resueltas, setResueltas] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);

  if (sospechas.length === 0) {
    return (
      <EstadoVacio
        titulo="Nada sospechoso"
        descripcion="Ningún torneo futuro retirado por la FIE, sin rastro en ella, desaparecido de su fuente o con la fecha movida."
      />
    );
  }

  const marcar = async (eventId: string) => {
    setOcupado(eventId);
    setError(null);
    const r = await marcarCancelada(eventId, true);
    setOcupado(null);
    if (r.ok) setResueltas((s) => new Set(s).add(eventId));
    else setError(r.error);
  };

  const pendientes = sospechas.filter((s) => !resueltas.has(s.eventId));

  return (
    <ul className="min-w-0 divide-y divide-border overflow-hidden rounded-xl border bg-card">
      {pendientes.length === 0 ? (
        <li className="px-4 py-3 text-sm text-muted-foreground">Todo revisado.</li>
      ) : null}
      {pendientes.map((s) => (
        <li key={`${s.tipo}-${s.eventId}`} className="flex min-w-0 flex-col gap-1 px-3 py-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <BanderaPais pais={s.pais} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.nombre}</span>
            <Boton
              variante="secundario"
              tamano="sm"
              disabled={ocupado === s.eventId}
              onClick={() => void marcar(s.eventId)}
            >
              {ocupado === s.eventId ? 'Marcando…' : 'Marcar cancelada'}
            </Boton>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{ROTULO[s.tipo]}.</span>{' '}
            {s.ciudad ? `${s.ciudad} · ` : ''}{s.inicio}{s.fin !== s.inicio ? ` → ${s.fin}` : ''}.{' '}
            {s.detalle}{' '}
            {s.sourceUrl ? (
              <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                Fuente ↗
              </a>
            ) : null}
          </div>
        </li>
      ))}
      {error ? <li className="px-4 py-2 text-sm text-destructive">{error}</li> : null}
    </ul>
  );
}
