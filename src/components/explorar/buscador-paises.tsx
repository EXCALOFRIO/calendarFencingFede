'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { TIPO_TRANSICION } from '@/components/sistema/navegacion';
import { buscarPaises, PAISES, rutaPais, type Pais } from '@/lib/sport/explorar/paises';
import { cn } from '@/lib/utils';
import { CAMPO_BUSCAR, CLASE_FILA_PAIS, ContenidoPais } from './buscador-filtros';

const AVANZAR = [TIPO_TRANSICION.avanzar];

/** Fila de un país que abre su pantalla. */
export function FilaPais({ pais, className }: { pais: Pais; className?: string }) {
  return (
    <li>
      <Link href={rutaPais(pais.codigo)} prefetch={false} transitionTypes={AVANZAR} className={cn(CLASE_FILA_PAIS, className)}>
        <ContenidoPais pais={pais} />
      </Link>
    </li>
  );
}

/**
 * Pestaña Países de Buscar: un campo que filtra al escribir (nombre en
 * castellano u otro idioma, código del COI, con erratas) y la lista de
 * países. Sin filtros: un país no tiene arma ni categoría propias. Todo pasa
 * en el navegador: la lista es fija y no consulta la base.
 */
export function BuscadorPaises({ qInicial = '' }: { qInicial?: string }) {
  const entrada = React.useRef<HTMLInputElement>(null);
  const [texto, setTexto] = React.useState(qInicial);
  const lista = texto.trim() ? buscarPaises(texto, PAISES.length) : PAISES;
  return (
    <div className="flex min-w-0 flex-col gap-3 lg:max-w-2xl">
      <form role="search" aria-label="Buscar países" className="relative w-full" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="paises-q" className="sr-only">Buscar países</label>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground" />
        <input
          ref={entrada}
          id="paises-q"
          type="search"
          value={texto}
          maxLength={40}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="España, ITA…"
          aria-controls="paises-lista"
          className={cn(CAMPO_BUSCAR, 'pr-[40px]')}
          onChange={(e) => setTexto(e.target.value)}
        />
        {texto ? (
          <button
            type="button"
            aria-label="Borrar búsqueda"
            className="absolute top-1/2 right-0 flex size-[44px] -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
            onClick={() => { setTexto(''); entrada.current?.focus(); }}
          >
            <X className="size-[18px]" aria-hidden />
          </button>
        ) : null}
      </form>
      <p role="status" className="sr-only">{`${lista.length} ${lista.length === 1 ? 'país' : 'países'}`}</p>
      {lista.length ? (
        <ul id="paises-lista" aria-label="Países" className="flex flex-col">
          {lista.map((p) => <FilaPais key={p.codigo} pais={p} />)}
        </ul>
      ) : (
        <p className="px-[8px] py-[12px] text-[14px] text-muted-foreground">Ningún país se parece a «{texto.trim()}».</p>
      )}
    </div>
  );
}
