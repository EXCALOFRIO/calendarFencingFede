'use client';

import { MarcaArma } from '@/components/calendario/iconos-arma';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ARMAS } from '@/lib/ambito';
import type { Weapon } from '@/lib/auth/session';
import { WEAPON_LABEL } from '@/lib/utils';

/**
 * El filtro de arma de «Selección».
 *
 * `ToggleGroup type="multiple"` con `variant="outline"`, que es la convención
 * de la sección 9.1 de `REFERENCIAS.md` para la selección múltiple: lo marcado
 * se indica con **superficie y borde**, nunca con el relleno de acento, que
 * está reservado a la acción principal de la pantalla (aquí, publicar una
 * convocatoria). Es el mismo control y el mismo aspecto que la fila de filtros
 * del calendario, a propósito: la misma pregunta se contesta igual en todas las
 * pantallas.
 *
 * El dibujo del arma va a 22 px, que es el umbral por debajo del cual `MarcaArma`
 * cambia a la abreviatura, y al lado el nombre entero. En un filtro el nombre
 * entero gana a `FLO`: no es una barra estrecha del calendario, es un control
 * que se lee una vez y se deja puesto.
 *
 * Y el color nunca es la única señal: hay superficie, borde, `aria-checked` de
 * Radix y el nombre del arma escrito.
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
      <ToggleGroup
        type="multiple"
        variant="outline"
        value={armas}
        /*
          Sin armas marcadas no se filtra nada, en vez de dejar la pantalla en
          blanco: desmarcar las tres es «quiero verlo todo», no «no quiero ver
          nada». Es lo mismo que hace el calendario.
        */
        onValueChange={(v) => onCambiar(v as Weapon[])}
        spacing={2}
        className="flex-wrap"
        aria-label="Armas que se enseñan"
      >
        {ARMAS.map((arma) => (
          <ToggleGroupItem key={arma} value={arma} className="h-11 gap-2 px-3">
            <MarcaArma armas={[arma]} px={22} />
            {WEAPON_LABEL[arma]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

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
