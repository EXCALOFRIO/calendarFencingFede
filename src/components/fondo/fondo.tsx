import { cn } from '@/lib/utils';

/**
 * El fondo con textura, cuando no puede ir en el propio elemento.
 *
 * -------------------------------------------------------------------------
 * PRIMERO: ¿NECESITAS ESTE COMPONENTE?
 * -------------------------------------------------------------------------
 *
 * Casi nunca. Las clases `.fondo-pantalla`, `.fondo-cabecera` y
 * `.fondo-panel` de `globals.css` se ponen en el elemento que ya tienes y
 * no hacen falta ni un `div` de más ni `z-index`:
 *
 *     <div className="fondo-cabecera tinte-fie rounded-md bg-card p-4">
 *
 * Eso es lo normal y es lo que hay que usar. Son `background-image`, que el
 * navegador pinta siempre por debajo del contenido del elemento, así que
 * **no pueden tapar una letra** por construcción.
 *
 * Este componente es para los dos casos en que aquello no vale:
 *
 * 1. El elemento ya usa su `background-image` para otra cosa —el cartel de
 *    la FIE, la foto de la sede— y la textura tiene que ir encima de la
 *    foto y debajo del texto.
 * 2. La textura tiene que salirse del hueco del elemento (sangrar).
 *
 * -------------------------------------------------------------------------
 * CÓMO SE USA
 * -------------------------------------------------------------------------
 *
 *     <div className="relative isolate overflow-hidden rounded-md bg-card">
 *       <Fondo variante="cabecera" tinte="fie" />
 *       …el contenido…
 *     </div>
 *
 * Las tres palabras del padre no son decorativas:
 *
 * - `relative`  para que el `inset-0` se mida contra él.
 * - `isolate`   crea contexto de apilamiento, y con eso el `-z-10` de este
 *               div se queda **detrás del contenido y delante del fondo del
 *               padre**. Sin `isolate` el `-z-10` sube al contexto de la
 *               raíz y desaparece debajo de la página.
 * - `overflow-hidden` para que la cuña no se salga del radio.
 *
 * El `div` es `aria-hidden` y `pointer-events-none`: no es contenido y no
 * se puede tocar. Nada de `alt`, nada que anunciar.
 */
export type VarianteFondo = 'pantalla' | 'cabecera' | 'panel';
export type TinteFondo = 'marca' | 'rfee' | 'fie' | 'efc' | 'aut' | 'oro';

/**
 * Los nombres van escritos enteros, no montados con plantilla.
 *
 * Así se encuentran con `grep` desde cualquiera de las dos puntas —clase en
 * `globals.css`, uso aquí— y ningún rastreador de clases se los puede
 * perder. Son diez líneas que ahorran el fallo de «el fondo no sale y no sé
 * por qué».
 */
const CLASE_VARIANTE: Record<VarianteFondo, string> = {
  pantalla: 'fondo-pantalla',
  cabecera: 'fondo-cabecera',
  panel: 'fondo-panel',
};

const CLASE_TINTE: Record<TinteFondo, string> = {
  marca: 'tinte-marca',
  rfee: 'tinte-rfee',
  fie: 'tinte-fie',
  efc: 'tinte-efc',
  aut: 'tinte-aut',
  oro: 'tinte-oro',
};

export function Fondo({
  variante = 'cabecera',
  tinte,
  className,
}: {
  variante?: VarianteFondo;
  /** Procedencia del dato (`rfee`, `fie`, `efc`, `aut`), la marca o el oro
   *  de las convocatorias. Sin tinte, la textura va en grafito. */
  tinte?: TinteFondo;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 -z-10',
        CLASE_VARIANTE[variante],
        tinte ? CLASE_TINTE[tinte] : null,
        className,
      )}
    />
  );
}
