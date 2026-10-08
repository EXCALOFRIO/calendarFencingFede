'use client';

import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { Button } from '@/components/ui/button';
import { ARMAS } from '@/lib/ambito';
import type { Weapon } from '@/lib/auth/session';
import { rotuloArma } from '@/lib/sport/rotulos';

/**
 * El filtro de arma de «Selección»: chips que se encienden y se apagan, los
 * mismos de los filtros del resto de la aplicación. Sin armas marcadas no se
 * filtra nada: desmarcar las tres es «quiero verlo todo», no «no quiero ver
 * nada».
 */
export function FiltroArmas({
  armas,
  onCambiar,
  /** Con qué armas se abrió la pantalla, para poder volver a ellas. */
  arranque,
  /**
   * El atajo de «ver todas» se apaga cuando el filtro ha dejado la lista vacía:
   * ahí el estado vacío ya ofrece el mismo botón con el mismo texto, y dos
   * botones idénticos a cuatro centímetros se leen como un descuido. Visto en
   * `capturas/nuevo-coach-iphone-convocatorias.png`.
   */
  conAtajo = true,
}: {
  armas: Weapon[];
  onCambiar: (armas: Weapon[]) => void;
  arranque: Weapon[];
  conAtajo?: boolean;
}) {
  const enSuArma =
    armas.length === arranque.length && arranque.every((a) => armas.includes(a));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FilaChips etiqueta="Armas que se enseñan">
        {ARMAS.map((arma) => {
          const marcada = armas.includes(arma);
          return (
            <ChipFiltro
              key={arma}
              marcado={marcada}
              onClick={() => onCambiar(marcada ? armas.filter((a) => a !== arma) : ARMAS.filter((a) => a === arma || armas.includes(a)))}
            >
              {rotuloArma(arma)}
            </ChipFiltro>
          );
        })}
      </FilaChips>

      {/*
        Navegación entre dos vistas, así que botón fantasma: ni relleno de
        acento ni borde. Solo aparece cuando hay a dónde ir; para la dirección
        técnica, que arranca con las tres, «ver todas» no significa nada.
      */}
      {conAtajo && arranque.length < ARMAS.length ? (
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          onClick={() => onCambiar(enSuArma ? [...ARMAS] : arranque)}
        >
          {enSuArma ? 'Ver todas las armas' : 'Volver a lo mío'}
        </Button>
      ) : null}
    </div>
  );
}
