import { Star, TriangleAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import type { FavoritoResumen } from '@/lib/sport/explorar/favoritos';
import { RUTA_FAVORITOS, construirUrlFavoritos } from '@/lib/sport/explorar/favoritos-url';
import type { EstadoFavoritoVista, VistaFavoritos } from '@/lib/sport/explorar/favoritos-pantalla';
import { RUTA_EXPLORAR } from '@/lib/sport/explorar/url';
import { GENDER_LABEL, WEAPON_LABEL, cn } from '@/lib/utils';
import { BotonFavorito, ID_ENCABEZADO_FAVORITOS } from './boton-favorito';

/**
 * Lista propia de favoritos y piezas de acceso. Un favorito es sólo un acceso
 * rápido a una ficha: nada de esto avisa, sigue a nadie ni enseña ranking
 * interno. La lista sólo recibe el resumen deportivo público de cada persona.
 */

const ENLACE =
  'inline-flex min-h-11 items-center gap-1.5 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

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
  return (
    <li className="flex flex-col gap-3 px-3 py-3 md:flex-row md:items-center md:justify-between md:gap-6">
      <Link
        href={rutaFichaConRetorno(d.id, volver)}
        prefetch={false}
        className="flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-md hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="font-medium break-words">{d.nombre}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {d.pais ? <BanderaPais pais={d.pais} conNombre /> : <span>País no publicado</span>}
          <span>
            {d.genero ? GENDER_LABEL[d.genero] : 'Género no publicado'}
            {homonimo && d.anioNacimiento !== null ? `, nacimiento ${d.anioNacimiento}` : ''}
          </span>
          <span>
            {d.armas.length > 0 ? d.armas.map((a) => WEAPON_LABEL[a]).join(', ') : 'Sin pruebas importadas'}
          </span>
          <span>
            {d.resultadosImportados > 0
              ? `${d.resultadosImportados} ${d.resultadosImportados === 1 ? 'clasificación' : 'clasificaciones'}`
              : 'Ninguna clasificación importada'}
          </span>
        </span>
        {homonimo ? (
          <span className="inline-flex items-start gap-1.5 text-xs text-warn">
            <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{d.mismoNombre} personas con este nombre: comprueba país, año y armas.</span>
          </span>
        ) : null}
      </Link>
      <BotonFavorito personaId={d.id} nombre={d.nombre} inicial variante="lista" />
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
    <section aria-labelledby={ID_ENCABEZADO_FAVORITOS} className="flex flex-col gap-3">
      <h2 id={ID_ENCABEZADO_FAVORITOS} tabIndex={-1} className="text-xl focus:outline-none">
        Guardados
      </h2>
      <p role="status" className="text-sm text-muted-foreground">
        {items.length === 1 ? '1 deportista' : `${items.length} deportistas`} en esta página
        {siguiente ? ', hay más' : ''}.
      </p>

      <ul className="divide-y rounded-md border bg-card" aria-label="Deportistas guardados">
        {items.map((d) => (
          <FilaFavorito key={d.id} d={d} volver={volver} />
        ))}
      </ul>

      <nav aria-label="Páginas de favoritos" className="flex flex-wrap items-center gap-3">
        {cursorActual ? (
          <Button asChild variant="outline">
            <Link href={RUTA_FAVORITOS} prefetch={false}>
              Volver a la primera página
            </Link>
          </Button>
        ) : null}
        {siguiente ? (
          <Button asChild variant="outline">
            <Link href={construirUrlFavoritos(siguiente)} prefetch={false} rel="next">
              Ver más favoritos
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">No hay más favoritos.</p>
        )}
      </nav>

      <p className="medida text-xs text-muted-foreground">
        La lista es privada y sólo la ves tú. Guardar a alguien no le avisa ni te avisa de lo que haga:
        es un acceso rápido a su ficha.
      </p>
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
      className="flex flex-col items-start gap-2 rounded-md border bg-card px-4 py-5"
    >
      <div className="flex items-center gap-2">
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
      Buscar en Explorar
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
        <Aviso icono={<Star className="size-5 text-muted-foreground" aria-hidden />} titulo="Esta página ya no tiene favoritos">
          <p>Es posible que hayas quitado a quien estaba aquí. El resto de la lista sigue guardado.</p>
          <Button asChild variant="outline">
            <Link href={RUTA_FAVORITOS} prefetch={false}>
              Volver a la primera página
            </Link>
          </Button>
        </Aviso>
      ) : (
        <Aviso icono={<Star className="size-5 text-muted-foreground" aria-hidden />} titulo="Aún no has guardado a nadie">
          <p>
            Abre la ficha de un deportista, con o sin cuenta, activo o retirado, y pulsa «Guardar en
            favoritos» para volver a ella desde aquí. Es un acceso rápido privado: no envía avisos.
          </p>
          {IR_A_EXPLORAR}
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Esta página ya no corresponde a tu lista">
          <p>El enlace de página ha caducado o es de otra lista. Tus favoritos no se han tocado.</p>
          <Button asChild variant="outline">
            <Link href={RUTA_FAVORITOS} prefetch={false}>
              Volver a la primera página
            </Link>
          </Button>
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Favoritos aún no está activo">
          <p>
            Los datos deportivos todavía no están preparados en esta instalación, así que no se ha
            podido leer tu lista. No significa que esté vacía.
          </p>
        </Aviso>
      );
    case 'entrada_invalida':
    case 'error':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-danger" aria-hidden />} titulo="No se ha podido abrir tu lista">
          <p>Ha fallado la consulta; no significa que no tengas favoritos. Inténtalo de nuevo.</p>
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
      return <BotonFavorito key={estado.personaId} personaId={estado.personaId} nombre={nombre} inicial={estado.favorito} />;
    case 'no_disponible':
      return <p className="medida text-xs text-muted-foreground">Favoritos aún no está activo en esta instalación.</p>;
    case 'error':
      return (
        <div role="alert" className="flex flex-col items-start gap-1 text-sm text-danger">
          <p className="medida">No se ha podido comprobar si {nombre} está en tus favoritos.</p>
          <Link href={reintentar} prefetch={false} className={ENLACE}>
            Reintentar
          </Link>
        </div>
      );
    default:
      return null;
  }
}
