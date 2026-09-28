'use client';

import { Search, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Buscador de una lista: icono en el móvil, campo en el escritorio.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ NO ES UN CAMPO SIEMPRE VISIBLE
 * -------------------------------------------------------------------------
 * `REFERENCIAS.md` § 9.2 lo dice sin matices: «En móvil, el icono; nunca un
 * campo que ocupe una fila entera». Y está medido: en `/tiradores` los
 * controles son el conmutador de vista, las tres armas y el buscador, y en un
 * iPhone de 393 px el campo no cabe al lado de nada —necesita 128 px y las
 * armas con sus recuentos se llevan 280—, así que se llevaba un renglón
 * entero de 44 px para algo que se usa de vez en cuando. Se intentó primero
 * con `flex-1 basis-32` y en la captura seguía saliendo en su propia fila:
 * cuando no cabe, no cabe.
 *
 * Así que en móvil es un botón de icono que ABRE el campo, y el campo solo
 * existe mientras se busca, que es cuando merece el sitio. A partir de `sm`
 * hay ancho de sobra y se enseña siempre, porque ahí esconderlo solo añade un
 * clic.
 *
 * El valor no se pierde al cerrar: se vacía a propósito. Un buscador cerrado
 * con un filtro activo invisible es la forma más rápida de que alguien jure
 * que le faltan tiradores.
 */
export function Buscador({
  valor,
  onCambio,
  etiqueta,
  marcador,
}: {
  valor: string;
  onCambio: (valor: string) => void;
  /** Para el lector de pantalla: «Buscar tirador o club». */
  etiqueta: string;
  /** Lo que se lee dentro del campo: «Buscar tirador». */
  marcador: string;
}) {
  const [abierto, setAbierto] = React.useState(false);
  const campo = React.useRef<HTMLInputElement | null>(null);

  // Al abrir se enfoca: si hay que tocar el icono y luego el campo, el icono
  // no ha ahorrado nada.
  React.useEffect(() => {
    if (abierto) campo.current?.focus();
  }, [abierto]);

  const cerrar = () => {
    onCambio('');
    setAbierto(false);
  };

  return (
    <>
      {/* Móvil: el icono. Desaparece en cuanto el campo está abierto. */}
      {!abierto ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="sm:hidden"
          onClick={() => setAbierto(true)}
          aria-label={etiqueta}
        >
          <Search />
        </Button>
      ) : null}

      {/*
        El campo. En móvil solo cuando está abierto; en `sm` siempre.
        `basis-full` cuando está abierto en móvil es lo correcto: si ya has
        decidido buscar, el campo se merece el renglón.
      */}
      <div
        className={`relative min-w-0 items-center gap-1 sm:flex sm:basis-56 ${
          abierto ? 'flex basis-full' : 'hidden'
        }`}
      >
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
          aria-hidden
        />
        <Input
          ref={campo}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') cerrar();
          }}
          placeholder={marcador}
          aria-label={etiqueta}
          className="h-8 pl-8"
        />
        {/* Cerrar solo en móvil: en escritorio el campo vive ahí. */}
        {abierto ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 sm:hidden"
            onClick={cerrar}
            aria-label="Cerrar la búsqueda"
          >
            <X />
          </Button>
        ) : null}
      </div>
    </>
  );
}
