'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useFichaPropia } from '@/components/explorar/perfil/ficha-propia';
import { Marca } from '@/components/marca';
import { cabeceraDeRuta, hayBusqueda } from '@/components/navegacion-app';
import { CabeceraCompacta } from '@/components/sistema/cabecera-compacta';
import { AREA_TACTIL } from '@/components/sistema/tactil';
import { cn } from '@/lib/utils';

type Props = {
  /** La campana, pintada en el servidor con su contador. */
  campana: React.ReactNode;
  /** Aviso de datos sin actualizar: sólo en el Calendario. */
  aviso?: React.ReactNode;
};

/**
 * Cabecera compacta de 48 px de cada pantalla (`docs/diseno-sistema.md`
 * § 1.2), elegida por la ruta en `cabeceraDeRuta`. Vive en el layout para
 * que todas las pantallas la tengan aunque su página aún no la pinte; un
 * layout no se desmonta, y la cabecera se queda quieta durante la
 * transición porque lleva `view-transition-name: cabecera`.
 *
 * En escritorio la navegación va en la cabecera de 56 px del layout; esta
 * fila se queda debajo, sin pegarse, con el título y la flecha de volver.
 */
export function CabeceraApp(props: Props) {
  return (
    <Suspense fallback={<Cabecera {...props} conBusqueda={false} />}>
      <CabeceraViva {...props} />
    </Suspense>
  );
}

function CabeceraViva(props: Props) {
  return <Cabecera {...props} conBusqueda={hayBusqueda(useSearchParams())} />;
}

function Cabecera({ campana, aviso, conBusqueda }: Props & { conBusqueda: boolean }) {
  const pathname = usePathname() ?? '/';
  const c = cabeceraDeRuta(pathname, conBusqueda, useFichaPropia());
  const enCalendario = pathname === '/';

  let cabecera: React.ReactNode = null;
  if (c?.variante === 'raiz') {
    // La campana del escritorio está en la cabecera de 56 px: aquí sólo en el móvil.
    const acciones = c.campana ? <span className="flex lg:hidden">{campana}</span> : undefined;
    cabecera = c.marca ? (
      <CabeceraCompacta variante="raiz" titulo={null} inicio={<EnlaceMarca />} acciones={acciones} className="lg:hidden" />
    ) : (
      <CabeceraCompacta variante="raiz" titulo={c.titulo} acciones={acciones} className="lg:static" />
    );
  } else if (c) {
    cabecera = (
      <CabeceraCompacta
        variante="subpantalla"
        titulo={c.titulo}
        volverA={c.volverA}
        encabezado={c.encabezado ?? true}
        className="lg:static"
      />
    );
  } else {
    // Sin cabecera (la pantalla pinta su título), el contenido no puede quedar bajo la barra de estado del iPhone.
    cabecera = <div aria-hidden className="h-[env(safe-area-inset-top)] lg:hidden" />;
  }

  return (
    <>
      {cabecera}
      {enCalendario && aviso ? aviso : null}
    </>
  );
}

/** El logo con el nombre, sólo en la raíz del Calendario. */
function EnlaceMarca() {
  return (
    <Link href="/" className={cn('flex h-[36px] items-center gap-[8px] rounded-full pr-[6px] pl-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring', AREA_TACTIL)}>
      <Marca className="size-[26px]" />
      <span className="font-display text-[20px] leading-[24px] font-semibold tracking-tight">
        Calendar<span className="text-primary-text">Fencing</span>
      </span>
    </Link>
  );
}
