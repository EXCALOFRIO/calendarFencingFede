'use client';

import { Search } from 'lucide-react';
import * as React from 'react';
import { BanderaPais } from '@/components/bandera';
import { Boton } from '@/components/sistema/boton';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import { buscarPaises, paisPorCodigo, PAISES, type Pais } from '@/lib/sport/explorar/paises';
import { cn } from '@/lib/utils';

/**
 * Piezas de filtro de Buscar (tiradores y competiciones): un chip que abre
 * una hoja con las opciones. Elegir aplica el filtro al momento y cierra la
 * hoja; no hay botón de «Aplicar» salvo en las fechas, que se escriben.
 */

export type OpcionFiltro = { valor: string; etiqueta: string };

/** Campo de texto de 40 px con letra de 16 (por debajo, iOS amplía la página al enfocar). */
export const CAMPO_BUSCAR =
  'h-[40px] min-h-[40px] w-full rounded-xl border border-transparent bg-secondary pr-[12px] pl-[38px] text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none';

export function ChipOpciones({
  etiqueta,
  valor,
  opciones,
  textoTodas,
  onElegir,
  disabled,
}: {
  /** Rótulo del chip sin filtro, y título de la hoja. */
  etiqueta: string;
  valor: string;
  opciones: readonly OpcionFiltro[];
  /** La opción que quita el filtro («Todas», «Todos»). */
  textoTodas: string;
  onElegir: (valor: string) => void;
  disabled?: boolean;
}) {
  const [abierta, setAbierta] = React.useState(false);
  const elegida = opciones.find((o) => o.valor === valor);
  const elegir = (v: string) => {
    setAbierta(false);
    if (v !== valor) onElegir(v);
  };
  return (
    <HojaInferior
      abierta={abierta}
      alCambiar={setAbierta}
      titulo={etiqueta}
      disparador={(
        <ChipFiltro tipo="menu" marcado={valor !== ''} disabled={disabled}>
          {valor === '' ? etiqueta : (elegida?.etiqueta ?? valor)}
        </ChipFiltro>
      )}
    >
      <FilaChips etiqueta={etiqueta} envolver className="py-[8px]">
        <ChipFiltro marcado={valor === ''} onClick={() => elegir('')}>{textoTodas}</ChipFiltro>
        {opciones.map((o) => (
          <ChipFiltro key={o.valor} marcado={o.valor === valor} onClick={() => elegir(o.valor)}>{o.etiqueta}</ChipFiltro>
        ))}
      </FilaChips>
    </HojaInferior>
  );
}

/** Fila de país tocable: bandera, nombre y código. Sirve para enlazar o para elegir. */
export function ContenidoPais({ pais }: { pais: Pais }) {
  return (
    <>
      <BanderaPais pais={pais.codigo} soloBandera className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{pais.nombre}</span>
      <span className="text-[12px] text-muted-foreground tabular-nums">{pais.codigo}</span>
    </>
  );
}

export const CLASE_FILA_PAIS =
  'flex min-h-[48px] w-full min-w-0 items-center gap-[12px] rounded-xl px-[8px] text-left outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring';

/** Chip «País» de los tiradores: la hoja busca por nombre o código y elige uno. */
export function ChipPais({ valor, onElegir, disabled }: { valor: string; onElegir: (codigo: string) => void; disabled?: boolean }) {
  const [abierta, setAbierta] = React.useState(false);
  const [texto, setTexto] = React.useState('');
  const lista = texto.trim() ? buscarPaises(texto, 40) : PAISES;
  const elegido = valor ? paisPorCodigo(valor) : null;
  const elegir = (codigo: string) => {
    setAbierta(false);
    setTexto('');
    if (codigo !== valor) onElegir(codigo);
  };
  return (
    <HojaInferior
      abierta={abierta}
      alCambiar={(a) => { setAbierta(a); if (!a) setTexto(''); }}
      titulo="País"
      disparador={(
        <ChipFiltro tipo="menu" marcado={valor !== ''} disabled={disabled}>
          {valor === '' ? 'País' : (elegido?.nombre ?? valor)}
        </ChipFiltro>
      )}
    >
      <div className="flex flex-col gap-[8px] pt-[4px]">
        <div className="relative">
          <label htmlFor="explorar-pais-buscar" className="sr-only">Buscar país</label>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <input
            id="explorar-pais-buscar"
            type="search"
            value={texto}
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            placeholder="España, ITA…"
            className={CAMPO_BUSCAR}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <ul aria-label="Países" className="flex flex-col">
          {valor ? (
            <li>
              <button type="button" className={cn(CLASE_FILA_PAIS, 'text-primary-text')} onClick={() => elegir('')}>
                <span className="text-[14px] font-medium">Todos</span>
              </button>
            </li>
          ) : null}
          {lista.map((p) => (
            <li key={p.codigo}>
              <button type="button" aria-pressed={p.codigo === valor} className={cn(CLASE_FILA_PAIS, p.codigo === valor && 'bg-secondary')} onClick={() => elegir(p.codigo)}>
                <ContenidoPais pais={p} />
              </button>
            </li>
          ))}
          {lista.length === 0 ? <li className="px-[8px] py-[12px] text-[14px] text-muted-foreground">Ningún país</li> : null}
        </ul>
      </div>
    </HojaInferior>
  );
}

export type Anios = { desde: string; hasta: string };

/** Rótulo del chip de fechas: «2018–2024», «Desde 2018», «Hasta 2010» o «Fechas». */
export function rotuloAnios({ desde, hasta }: Anios): string {
  if (desde && hasta) return desde === hasta ? desde : `${desde}–${hasta}`;
  if (desde) return `Desde ${desde}`;
  if (hasta) return `Hasta ${hasta}`;
  return 'Fechas';
}

const ANIO_RE = /^(19|20)\d{2}$/;

/** Atajos de la hoja de fechas, contados desde el año en curso. */
export function atajosAnios(anioActual: number): { etiqueta: string; anios: Anios }[] {
  return [
    { etiqueta: 'Este año', anios: { desde: String(anioActual), hasta: String(anioActual) } },
    { etiqueta: 'Últimos 3 años', anios: { desde: String(anioActual - 2), hasta: String(anioActual) } },
    { etiqueta: 'Últimos 10 años', anios: { desde: String(anioActual - 9), hasta: String(anioActual) } },
    { etiqueta: `Antes de ${anioActual - 9}`, anios: { desde: '', hasta: String(anioActual - 10) } },
  ];
}

/** Chip de fechas de las competiciones: atajos o un intervalo de años escrito. */
export function ChipAnios({
  valor,
  anioActual,
  onElegir,
  disabled,
}: {
  valor: Anios;
  anioActual: number;
  onElegir: (anios: Anios) => void;
  disabled?: boolean;
}) {
  const [abierta, setAbierta] = React.useState(false);
  const [borrador, setBorrador] = React.useState<Anios>(valor);
  const activo = Boolean(valor.desde || valor.hasta);
  const valido = (v: string) => v === '' || ANIO_RE.test(v);
  const error = !valido(borrador.desde) || !valido(borrador.hasta)
    ? 'Escribe años de cuatro cifras.'
    : borrador.desde && borrador.hasta && borrador.desde > borrador.hasta ? '«Desde» va antes que «Hasta».' : null;
  const elegir = (anios: Anios) => {
    setAbierta(false);
    if (anios.desde !== valor.desde || anios.hasta !== valor.hasta) onElegir(anios);
  };
  const campo = (clave: keyof Anios, rotulo: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
      <label htmlFor={`catalogo-${clave}`} className="text-[13px] font-medium">{rotulo}</label>
      <input
        id={`catalogo-${clave}`}
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        placeholder={clave === 'desde' ? '2018' : String(anioActual)}
        value={borrador[clave]}
        aria-invalid={!valido(borrador[clave]) || undefined}
        onChange={(e) => setBorrador((b) => ({ ...b, [clave]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
        className="h-[40px] w-full rounded-xl border border-transparent bg-accent px-[12px] text-[16px] tabular-nums outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
      />
    </div>
  );
  return (
    <HojaInferior
      abierta={abierta}
      alCambiar={(a) => { setAbierta(a); if (a) setBorrador(valor); }}
      titulo="Fechas"
      disparador={(
        <ChipFiltro tipo="menu" marcado={activo} disabled={disabled}>{rotuloAnios(valor)}</ChipFiltro>
      )}
      pie={(
        <Boton variante="claro" tamano="lg" ancho="completo" disabled={Boolean(error)} onClick={() => elegir(borrador)}>
          Aplicar
        </Boton>
      )}
    >
      <div className="flex flex-col gap-[16px] pt-[4px]">
        <FilaChips etiqueta="Atajos de fechas" envolver className="py-[4px]">
          <ChipFiltro marcado={!activo} onClick={() => elegir({ desde: '', hasta: '' })}>Todas</ChipFiltro>
          {atajosAnios(anioActual).map((a) => (
            <ChipFiltro
              key={a.etiqueta}
              marcado={a.anios.desde === valor.desde && a.anios.hasta === valor.hasta}
              onClick={() => elegir(a.anios)}
            >
              {a.etiqueta}
            </ChipFiltro>
          ))}
        </FilaChips>
        <div className="flex gap-[12px]">
          {campo('desde', 'Desde')}
          {campo('hasta', 'Hasta')}
        </div>
        {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </HojaInferior>
  );
}
