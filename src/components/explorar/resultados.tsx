import { SearchX, TriangleAlert, Users, X } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Button } from '@/components/ui/button';
import type { VistaExplorar } from '@/lib/sport/explorar/pantalla';
import type { DeportistaResumen } from '@/lib/sport/explorar/tipos';
import {
  RUTA_EXPLORAR,
  chipsActivos,
  construirUrl,
  hayCriterios,
  rutaFicha,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { GENDER_LABEL, WEAPON_LABEL } from '@/lib/utils';

/** Filtros activos como enlaces que los quitan uno a uno. */
export function ChipsActivos({ criterios }: { criterios: CriteriosExplorar }) {
  const chips = chipsActivos(criterios);
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros activos" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.clave}>
          <Link
            href={chip.quitar}
            prefetch={false}
            aria-label={`Quitar filtro ${chip.etiqueta}: ${chip.valor}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-secondary px-3 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="text-muted-foreground">{chip.etiqueta}</span>
            <span className="max-w-48 truncate font-medium">{chip.valor}</span>
            <X className="size-3.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Celda({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground md:sr-only">{etiqueta}</span>
      {children}
    </div>
  );
}

function FilaDeportista({ d }: { d: DeportistaResumen }) {
  const homonimo = d.mismoNombre > 1;
  return (
    <li>
      <Link
        href={rutaFicha(d.id)}
        prefetch={false}
        className="grid min-h-11 gap-x-4 gap-y-2 px-3 py-3 hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium break-words">{d.nombre}</span>
          {d.alias ? (
            <span className="text-xs text-muted-foreground">
              Coincide con el alias «{d.alias}»
            </span>
          ) : null}
          {homonimo ? (
            <span className="inline-flex items-start gap-1.5 text-xs text-warn">
              <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {d.mismoNombre} personas con este nombre: comprueba país, año y armas antes de abrir la ficha.
              </span>
            </span>
          ) : null}
        </span>

        <Celda etiqueta="País">
          {d.pais ? (
            <BanderaPais pais={d.pais} conNombre />
          ) : (
            <span className="text-sm text-muted-foreground">País no publicado</span>
          )}
          <span className="text-xs text-muted-foreground">
            {d.genero ? GENDER_LABEL[d.genero] : 'Género no publicado'}
            {homonimo && d.anioNacimiento !== null ? `, nacimiento ${d.anioNacimiento}` : ''}
          </span>
        </Celda>

        <Celda etiqueta="Armas">
          {d.armas.length > 0 ? (
            <span className="text-sm">{d.armas.map((a) => WEAPON_LABEL[a]).join(', ')}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Sin pruebas importadas</span>
          )}
        </Celda>

        <Celda etiqueta="Resultados importados">
          {d.resultadosImportados > 0 ? (
            <span className="flex items-baseline gap-1.5">
              <span className="cifra text-2xl leading-none">{d.resultadosImportados}</span>
              <span className="text-xs text-muted-foreground">
                {d.resultadosImportados === 1 ? 'clasificación' : 'clasificaciones'}
              </span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Ninguno importado</span>
          )}
        </Celda>
      </Link>
    </li>
  );
}

export function ListaDeportistas({
  items,
  siguiente,
  cursorActual,
  criterios,
}: {
  items: DeportistaResumen[];
  siguiente: string | null;
  cursorActual: string | undefined;
  criterios: CriteriosExplorar;
}) {
  return (
    <section aria-labelledby="explorar-resultados" className="flex flex-col gap-3">
      <h2 id="explorar-resultados" className="text-xl">
        Resultados
      </h2>
      <p role="status" className="text-sm text-muted-foreground">
        {items.length === 1 ? '1 deportista' : `${items.length} deportistas`} en esta página
        {siguiente ? ', hay más' : ''}.
      </p>

      <ul className="divide-y rounded-md border bg-card" aria-label="Deportistas encontrados">
        {items.map((d) => (
          <FilaDeportista key={d.id} d={d} />
        ))}
      </ul>

      <nav aria-label="Páginas de resultados" className="flex flex-wrap items-center gap-3">
        {cursorActual ? (
          <Button asChild variant="outline">
            <Link href={construirUrl(criterios)} prefetch={false}>
              Volver a la primera página
            </Link>
          </Button>
        ) : null}
        {siguiente ? (
          <Button asChild variant="outline">
            <Link href={construirUrl(criterios, siguiente)} prefetch={false} rel="next">
              Ver más deportistas
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">No hay más resultados con estos criterios.</p>
        )}
      </nav>

      <p className="text-xs text-muted-foreground medida">
        Los resultados importados son las clasificaciones finales ya cargadas de las fuentes oficiales.
        Que una persona tenga cero no significa que no haya competido: puede faltar por importar.
      </p>
    </section>
  );
}

function Aviso({
  icono,
  titulo,
  children,
  alerta = false,
}: {
  icono: React.ReactNode;
  titulo: string;
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
        <h2 className="text-xl">{titulo}</h2>
      </div>
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

export function EstadoSinLista({
  vista,
  criterios,
}: {
  vista: Exclude<VistaExplorar, { tipo: 'ok' } | { tipo: 'sin_sesion' }>;
  criterios: CriteriosExplorar;
}) {
  const reintentar = construirUrl(criterios);
  switch (vista.tipo) {
    case 'sin_criterio':
      return (
        <Aviso icono={<SearchX className="size-5 text-muted-foreground" aria-hidden />} titulo="Empieza por un nombre o un filtro">
          <p>
            {criterios.q
              ? 'Con una sola letra no hay búsqueda posible. Escribe al menos dos letras del nombre, o elige un arma, un torneo o una temporada.'
              : 'Escribe el nombre o el alias de una persona, o elige arma, categoría, torneo, fechas o país. Aparecen también quienes ya no compiten o no tienen cuenta.'}
          </p>
        </Aviso>
      );
    case 'entrada_invalida':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Algún filtro no es válido">
          <p>
            La búsqueda no se ha hecho porque un valor de la dirección no se entiende (un arma, una
            fecha o un intervalo al revés). Esto no significa que no haya resultados.
          </p>
          <Button asChild variant="outline">
            <Link href={RUTA_EXPLORAR} prefetch={false}>
              Empezar de nuevo
            </Link>
          </Button>
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="Esta página ya no corresponde a la búsqueda">
          <p>El enlace de página es de otra búsqueda o ha caducado. Vuelve a la primera página de esta búsqueda.</p>
          <Button asChild variant="outline">
            <Link href={reintentar} prefetch={false}>
              Volver a la primera página
            </Link>
          </Button>
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-warn" aria-hidden />} titulo="El buscador aún no está activo">
          <p>
            Los datos deportivos todavía no están preparados en esta instalación, así que no se ha
            podido consultar a nadie. No es que no haya coincidencias.
          </p>
        </Aviso>
      );
    case 'error':
      return (
        <Aviso alerta icono={<TriangleAlert className="size-5 text-danger" aria-hidden />} titulo="No se ha podido hacer la búsqueda">
          <p>
            Ha fallado la consulta, no es que no haya resultados. Inténtalo de nuevo; si sigue
            fallando, avisa a la dirección técnica.
          </p>
          <Button asChild variant="outline">
            <Link href={reintentar} prefetch={false}>
              Reintentar
            </Link>
          </Button>
        </Aviso>
      );
    default:
      return null;
  }
}

export function EstadoSinCoincidencias({ criterios }: { criterios: CriteriosExplorar }) {
  return (
    <Aviso icono={<SearchX className="size-5 text-muted-foreground" aria-hidden />} titulo="Nadie coincide con estos criterios">
      <p>
        Las búsquedas por nombre ignoran acentos y mayúsculas. Prueba con menos palabras, con
        otro apellido o quitando algún filtro.
      </p>
      {hayCriterios(criterios) ? (
        <Button asChild variant="outline">
          <Link href={RUTA_EXPLORAR} prefetch={false}>
            Quitar todos los filtros
          </Link>
        </Button>
      ) : null}
    </Aviso>
  );
}
