import { Search, Star, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Boton } from '@/components/sistema/boton';
import { CabeceraSeccion, VerMas } from '@/components/sistema/cabecera-seccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import type { FavoritoResumen } from '@/lib/sport/explorar/favoritos';
import { RUTA_FAVORITOS, construirUrlFavoritos } from '@/lib/sport/explorar/favoritos-url';
import type { EstadoFavoritoVista, VistaFavoritos } from '@/lib/sport/explorar/favoritos-pantalla';
import { NOMBRE_SECCION } from '@/lib/sport/explorar/nombre-seccion';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { cn } from '@/lib/utils';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { BotonFavorito, ID_ENCABEZADO_FAVORITOS } from './boton-favorito';
import { datoCorto } from './buscador-social-fila';

/**
 * Lista propia de favoritos y piezas de acceso. Un favorito es sólo un acceso
 * rápido a una ficha: nada de esto avisa, sigue a nadie ni enseña ranking
 * interno. La lista sólo recibe el resumen deportivo público de cada persona.
 */

const ENLACE =
  'inline-flex min-h-[44px] items-center gap-2 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';

/** Entrada a la lista desde Explorar o el perfil, sin ocupar sitio en la barra. */
export function EnlaceFavoritos({ className }: { className?: string }) {
  return (
    <Link href={RUTA_FAVORITOS} prefetch={false} className={cn(ENLACE, className)}>
      <Star className="size-4" aria-hidden />
      Mis favoritos
    </Link>
  );
}

/** Avatar, bandera y nombre como en el resto de filas de persona; debajo, el homónimo o un dato corto. */
function FilaFavorito({ d, volver }: { d: FavoritoResumen; volver: string }) {
  const homonimo = d.mismoNombre > 1;
  const visible = nombreVisible(d.nombre) || d.nombre;
  const dato = datoCorto({ armas: d.armas, resultados: d.resultadosImportados });
  const meta = homonimo ? (
    <span className="text-warn" title={`${d.mismoNombre} personas con este nombre`}>
      {d.anioNacimiento !== null ? `n. ${d.anioNacimiento}` : 'Homónimo'}
      <span className="sr-only">: hay {d.mismoNombre} personas con este nombre</span>
    </span>
  ) : dato;
  return (
    <li className="min-w-0">
      <FilaPersona
        persona={{ id: d.id, nombre: visible, pais: d.pais }}
        href={rutaFichaConRetorno(d.id, volver)}
        meta={meta}
        insignias={<BotonFavorito personaId={d.id} nombre={d.nombre} inicial lectura={d} variante="lista" />}
      />
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
    <section aria-labelledby={ID_ENCABEZADO_FAVORITOS} className="flex min-w-0 flex-col lg:max-w-2xl">
      <CabeceraSeccion
        id={ID_ENCABEZADO_FAVORITOS}
        titulo="Guardados"
        accion={(
          <p role="status" className="text-xs text-muted-foreground">
            {items.length === 1 ? '1 tirador' : `${items.length} tiradores`}
            {siguiente ? ', hay más' : ''}
          </p>
        )}
      />

      <ul className="flex min-w-0 flex-col" aria-label="Tiradores guardados">
        {items.map((d) => (
          <FilaFavorito key={d.id} d={d} volver={volver} />
        ))}
      </ul>

      <nav aria-label="Páginas de favoritos" className="flex min-w-0 flex-col items-center gap-2 pt-1">
        {siguiente ? <VerMas href={construirUrlFavoritos(siguiente)} detalle="guardados" /> : null}
        {cursorActual ? (
          <Link href={RUTA_FAVORITOS} prefetch={false} className={cn(ENLACE, 'self-center')}>
            Primera página
          </Link>
        ) : null}
      </nav>
    </section>
  );
}

function Accion({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Boton asChild variante="contorno">
      <Link href={href} prefetch={false}>{children}</Link>
    </Boton>
  );
}

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
        <EstadoVacio icono={Star} titulo="Página vacía" accion={<Accion href={RUTA_FAVORITOS}>Primera página</Accion>} />
      ) : (
        <EstadoVacio
          icono={Star}
          titulo="Aún no has guardado a nadie"
          accion={(
            <Boton asChild variante="contorno">
              <Link href={RUTA_EXPLORAR} prefetch={false}>
                <Search aria-hidden />
                {NOMBRE_SECCION}
              </Link>
            </Boton>
          )}
        />
      );
    case 'cursor_invalido':
      return <EstadoVacio tipo="error" icono={TriangleAlert} titulo="Página caducada" accion={<Accion href={RUTA_FAVORITOS}>Primera página</Accion>} />;
    case 'no_disponible':
      return <EstadoVacio tipo="error" icono={TriangleAlert} titulo="Favoritos aún no está activo" descripcion="Aún no está activo en esta instalación." />;
    case 'entrada_invalida':
    case 'error':
      return <EstadoVacio tipo="error" icono={TriangleAlert} titulo="No se ha podido abrir tu lista" accion={<Accion href={reintentar}>Reintentar</Accion>} />;
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
