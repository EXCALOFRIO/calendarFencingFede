import { cn } from '@/lib/utils';

/**
 * Acrílico: el material para un panel que flota sobre una imagen.
 *
 * -------------------------------------------------------------------------
 * QUÉ ES Y QUÉ NO
 * -------------------------------------------------------------------------
 *
 * El usuario, viendo la pantalla de acceso: *«cuidado, no te pases de
 * transparencia, que queda medio raro… mete como más acrílico difuminado
 * para evitar ese efecto muy transparente raro»*.
 *
 * Transparencia a secas (`bg-black/40`) deja ver el fondo **nítido**: el
 * texto compite con lo que hay detrás y el panel se lee como un agujero.
 * Acrílico es desenfoque + tinte alto + canto de luz + grano, y entonces el
 * panel se lee como **una lámina de vidrio esmerilado**. La receta entera
 * está en `.acrilico`, en `globals.css`, con los números medidos.
 *
 * -------------------------------------------------------------------------
 * DÓNDE SÍ
 * -------------------------------------------------------------------------
 *
 * Solo donde detrás hay **una imagen**:
 *
 * - la tarjeta de acceso encima de las fotos de competición,
 * - la cabecera de la ficha de torneo encima de la foto de la sede,
 * - una barra fija que se superpone al contenido al desplazarse.
 *
 * DÓNDE NO, y esto importa lo mismo:
 *
 * - **las barras del calendario**: son cientos, cada región con
 *   `backdrop-filter` es una capa compuesta, y detrás no hay imagen que
 *   desenfocar. Ahí va color sólido (`COLOR_ORGANISMO[x].superficie`).
 * - tarjetas sobre fondo plano: si detrás no hay nada, el acrílico solo
 *   cuesta pintarlo. `bg-card` y listo.
 *
 * Presupuesto: **seis superficies acrílicas por pantalla**. Medido con
 * Playwright (iPhone 14 Pro, CPU a 1/4) no encontré techo —48 paneles de
 * 420 px siguieron a 60 fps—, así que el seis es disciplina de diseño, no un
 * acantilado: repartir vidrio por toda la interfaz es el tic de «generado
 * por IA» que `UI.md` prohíbe en la sección 3 bis.
 *
 * -------------------------------------------------------------------------
 * EL TEXTO DE ENCIMA
 * -------------------------------------------------------------------------
 *
 * La clase ya sube su propio `--muted-foreground`, así que
 * `text-muted-foreground` vale sin pensarlo (5,5:1 sobre una foto clara,
 * medido). Lo que **no** vale encima del acrílico es el rojo como texto:
 * `text-primary-text` se queda en 2,7:1 sobre una foto clara. El rojo, ahí,
 * va de relleno: `bg-primary` con texto blanco, 5,9:1.
 */
export function Acrilico({
  children,
  className,
  ...resto
}: React.ComponentProps<'div'>) {
  return (
    <div className={cn('acrilico rounded-lg', className)} {...resto}>
      {children}
    </div>
  );
}
