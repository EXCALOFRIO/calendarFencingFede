import { Search, Star, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import type { FavoritoResumen } from '@/lib/sport/explorar/favoritos';
import { RUTA_FAVORITOS, construirUrlFavoritos } from '@/lib/sport/explorar/favoritos-url';
import type { EstadoFavoritoVista, VistaFavoritos } from '@/lib/sport/explorar/favoritos-pantalla';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { cn } from '@/lib/utils';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { BotonFavorito, ID_ENCABEZADO_FAVORITOS } from './boton-favorito';
import { FotoDeportista } from './foto-deportista';
import { CLASE_VER_MAS, datoCorto } from './buscador-social-fila';

/**
 * Lista propia de favoritos y piezas de acceso. Un favorito es sólo un acceso
 * rápido a una ficha: nada de esto avisa, sigue a nadie ni enseña ranking
 * interno. La lista sólo recibe el resumen deportivo público de cada persona.
 */

const ENLACE =
  'inline-flex min-h-[44px] items-center gap-1.5 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/** Entrada a la lista desde Explorar o el perfil, sin ocupar sitio en la barra. */
export function EnlaceFavoritos({ className }: { className?: string }) {
  return (
    <Link href={RUTA_FAVORITOS} prefetch={false} className={cn(ENLACE, className)}>
      <Star className="size-4" aria-hidden />
      Mis favoritos
    </Link>
  );
}

function FilaFavorito({ d, volver }: { d: FavoritoResumen; volver: string }) {
  const homonimo = d.mismoNombre > 1;
  const visible = nombreVisible(d.nombre) || d.nombre;
  const dato = datoCorto({ armas: d.armas, resultados: d.resultadosImportados });
  return (
    <li className="flex min-w-0 items-center gap-2 px-3 sm:px-4">
      <Link
        href={rutaFichaConRetorno(d.id, volver)}
        prefetch={false}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-sm py-1 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <FotoDeportista personaId={d.id} nombre={visible} tamano="lista" apagado={d.resultadosImportados === 0} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[0.9375rem] leading-tight font-semibold">{visible}</span>
          {d.pais || dato || homonimo ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs leading-none whitespace-nowrap text-muted-foreground">
              {d.pais ? <BanderaPais pais={d.pais} className="shrink-0" /> : null}
              {homonimo ? (
                <span className="min-w-0 truncate text-warn" title={`${d.mismoNombre} personas con este nombre`}>
                  {d.anioNacimiento !== null ? `n. ${d.anioNacimiento}` : 'Homónimo'}
                  <span className="sr-only">: hay {d.mismoNombre} personas con este nombre</span>
                </span>
              ) : dato ? (
                <span className="min-w-0 truncate">{dato}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </Link>
      <BotonFavorito personaId={d.id} nombre={d.nombre} inicial lectura={d} variante="lista" />
    </li>
  );
}

export function ListaFavoritos({
  items,
  siguiente,
  cursorActual,
}: {
  items: FavoritoResumen[];
  siguiente: string | null;
  cursorActual: string | undefined;
}) {
  // La ficha vuelve a esta misma página de la lista, no a la primera.
  const volver = construirUrlFavoritos(cursorActual);
  return (
    <section aria-labelledby={ID_ENCABEZADO_FAVORITOS} className="flex min-w-0 flex-col gap-2 lg:max-w-2xl">
      <div className="flex min-h-[44px] items-center justify-between gap-3">
        <h2 id={ID_ENCABEZADO_FAVORITOS} tabIndex={-1} className="text-base font-semibold tracking-normal focus:outline-none">
          Guardados
        </h2>
        <p role="status" className="text-xs text-muted-foreground">
          {items.length === 1 ? '1 tirador' : `${items.length} tiradores`}
          {siguiente ? ', hay más' : ''}
        </p>
      </div>

      <ul className="flex min-w-0 flex-col divide-y overflow-hidden rounded-2xl border bg-card" aria-label="Deportistas guardados">
        {items.map((d) => (
          <FilaFavorito key={d.id} d={d} volver={volver} />
        ))}
      </ul>

      <nav aria-label="Páginas de favoritos" className="flex min-w-0 flex-col items-center gap-2 pt-1">
        {siguiente ? (
          <Button asChild variant="secondary" className={cn(CLASE_VER_MAS, 'self-center')}>
            <Link href={construirUrlFavoritos(siguiente)} prefetch={false} rel="next">
              Ver más
            </Link>
          </Button>
        ) : null}
        {cursorActual ? (
          <Link href={RUTA_FAVORITOS} prefetch={false} className={cn(ENLACE, 'self-center')}>
            Primera página
          </Link>
        ) : null}
      </nav>
    </section>
  );
}

function Aviso({
  titulo,
  icono,
  children,
  alerta = false,
}: {
  titulo: string;
  icono: React.ReactNode;
  children: React.ReactNode;
  alerta?: boolean;
}) {
  return (
    <section
      role={alerta ? 'alert' : 'status'}
      className="flex min-w-0 flex-col items-start gap-2 rounded-2xl border bg-card px-4 py-5 lg:max-w-2xl"
    >
      <div className="flex min-w-0 items-center gap-2">
        {icono}
        <h2 id={ID_ENCABEZADO_FAVORITOS} tabIndex={-1} className="text-xl focus:outline-none">
          {titulo}
        </h2>
      </div>
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

const IR_A_EXPLORAR = (
  <Button asChild variant="outline">
    <Link href={RUTA_EXPLORAR} prefetch={false}>
      <Search aria-hidden />
      {NOMBRE_SECCION}
    </Link>
  </Button>
);

/** Todo lo que no es una página con deportistas: vacío y errores, siempre distintos. */
export function EstadoFavoritos({
  vista,
  cursorActual,
}: {
  vista: Exclude<VistaFavoritos, { tipo: 'sin_sesion' }>;
  cursorActual: string | undefined;
}) {
  const reintentar = construirUrlFavoritos(cursorActual);
  switch (vista.tipo) {
    case 'ok':
      return cursorActual ? (
        <Aviso icono={<Star className="size-5 text-muted-foreground" aria-hidden />} titulo="Página vacía">
          <Button asChild variant="outline">
            <Link href={RUTA_FAVORITOS} prefetch={false}>
              Primera página
            </Link>
          </Button>
        </Aviso>
      ) : (
        <Aviso icono={<Star className="size-5 text-muted-foreground" aria-hidden />} titulo="Aún no has guardado a nadie">
          {IR_A_EXPLORAR}
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Página caducada">
          <Button asChild variant="outline">
            <Link href={RUTA_FAVORITOS} prefetch={false}>
              Primera página
            </Link>
          </Button>
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Favoritos aún no está activo">
          <p>Aún no está activo en esta instalación.</p>
        </Aviso>
      );
    case 'entrada_invalida':
    case 'error':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-danger" aria-hidden />} titulo="No se ha podido abrir tu lista">
          <Button asChild variant="outline">
            <Link href={reintentar} prefetch={false}>
              Reintentar
            </Link>
          </Button>
        </Aviso>
      );
  }
}

/**
 * Control de la cabecera de una ficha. Si no se pudo leer si ya está guardada,
 * se dice y se ofrece reintentar, en lugar de enseñar un «Sin guardar»
 * inventado que invitaría a guardar encima de un estado desconocido.
 */
export function ControlFavoritoFicha({
  estado,
  nombre,
  reintentar,
}: {
  estado: EstadoFavoritoVista;
  nombre: string;
  reintentar: string;
}) {
  switch (estado.tipo) {
    case 'ok':
      return <BotonFavorito key={estado.personaId} personaId={estado.personaId} nombre={nombre} inicial={estado.favorito} lectura={estado} variante="perfil" />;
    case 'no_disponible':
      return <p className="medida text-xs text-muted-foreground">Seguir aún no está activo en esta instalación.</p>;
    case 'error':
      return (
        <div role="alert" className="flex flex-col items-start gap-1 text-sm text-danger">
          <p className="medida">No se ha podido comprobar si sigues a {nombre}.</p>
          <Link href={reintentar} prefetch={false} className={ENLACE}>
            Reintentar
          </Link>
        </div>
      );
    default:
      return null;
  }
}
