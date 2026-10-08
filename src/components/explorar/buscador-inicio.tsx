'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { destinoBusqueda } from '@/lib/sport/explorar/ambitos-url';
import { CRITERIOS_VACIOS, RUTA_BUSCAR, construirUrl } from '@/lib/sport/explorar/url';
import { BuscadorSocial } from './buscador-social';
import { CabeceraExplorar } from './cabecera-explorar';

/**
 * Campo de búsqueda de «Para ti»: el mismo buscador de perfiles en vivo que
 * Tiradores, encima del selector de ámbitos. Al escribir, los perfiles
 * sustituyen a los resultados de las personas seguidas (`children`); Intro
 * abre Tiradores con lo escrito, sustituyendo la entrada del historial.
 */
export function BuscadorInicio({ profileId, children }: { profileId?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [valor, setValor] = React.useState('');
  const [pendiente, empezar] = React.useTransition();
  return (
    <form
      action={RUTA_BUSCAR}
      method="get"
      role="search"
      aria-label="Buscar tiradores"
      aria-busy={pendiente}
      className="flex min-w-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        empezar(() => router.replace(destinoBusqueda('inicio', valor)));
      }}
    >
      <BuscadorSocial
        valor={valor}
        onChange={setValor}
        qUrl=""
        volverDe={(q) => construirUrl({ ...CRITERIOS_VACIOS, q })}
        profileId={profileId}
        pendiente={pendiente}
        conRecientes={false}
        herramientas={<CabeceraExplorar activa="inicio" />}
      >
        {children}
      </BuscadorSocial>
    </form>
  );
}
