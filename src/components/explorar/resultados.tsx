import { ChevronRight, Medal, SearchX, TriangleAlert, Trophy, Users, X } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import type { VistaExplorar } from '@/lib/sport/explorar/pantalla';
import type { DeportistaResumen } from '@/lib/sport/explorar/tipos';
import { TRAYECTORIA_VACIA, type TrayectoriaPersona } from '@/lib/sport/explorar/tipos-busqueda';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import {
  RUTA_EXPLORAR,
  chipsActivos,
  construirUrl,
  hayCriterios,
  rutaFicha,
  type CriteriosExplorar,
} from '@/lib/sport/explorar/url';
import { GENDER_LABEL, WEAPON_LABEL, cn, titular } from '@/lib/utils';
import { AvatarAnillo } from './avatar-anillo';
import { Aclaracion, Celda, Nota, fechaLegible } from './piezas';

/** Filtros activos como enlaces que los quitan uno a uno. */
export function ChipsActivos({ criterios }: { criterios: CriteriosExplorar }) {
  const chips = chipsActivos(criterios);
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros activos" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.clave} className="min-w-0 max-w-full">
          <Link
            href={chip.quitar}
            prefetch={false}
            aria-label={`Quitar filtro ${chip.etiqueta}: ${chip.valor}${chip.fechaInvalida ? ' (fecha no válida)' : ''}`}
            className={cn(
              'inline-flex min-h-11 max-w-full flex-wrap items-center gap-1.5 rounded-full border bg-secondary px-3 text-sm hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              chip.fechaInvalida && 'border-danger/40',
            )}
          >
            <span className="text-muted-foreground">{chip.etiqueta}</span>
            <span className="max-w-48 min-w-0 py-1 font-medium break-words">{chip.valor}</span>
            {chip.fechaInvalida ? <span className="text-xs text-danger">no válida</span> : null}
            <X className="size-3.5 shrink-0" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const METALES = [
  { clave: 'oros', etiqueta: 'Oro', plural: 'Oros' },
  { clave: 'platas', etiqueta: 'Plata', plural: 'Platas' },
  { clave: 'bronces', etiqueta: 'Bronce', plural: 'Bronces' },
] as const;

/** Medallas individuales con texto: el color de la medalla no es la única señal. */
function Medallero({ t }: { t: TrayectoriaPersona }) {
  const metales = METALES.filter((m) => t[m.clave] > 0);
  if (metales.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className="sr-only">Medallas individuales: </span>
      {metales.map((m) => (
        <Badge key={m.clave} variant="outline" className="gap-1 px-2 py-0.5 text-xs">
          <Medal className="size-3 text-muted-foreground" aria-hidden />
          <span className="cifra">{t[m.clave]}</span>
          <span>{t[m.clave] === 1 ? m.etiqueta : m.plural}</span>
        </Badge>
      ))}
    </span>
  );
}

type FilaBuscada = DeportistaResumen & { trayectoria?: TrayectoriaPersona };

function FilaDeportista({ d, volver }: { d: FilaBuscada; volver: string }) {
  const homonimo = d.mismoNombre > 1;
  const t = d.trayectoria ?? TRAYECTORIA_VACIA;
  return (
    <li>
      {/* Las marcas `data-*` son las de las filas del buscador: su contenedor
          (BuscadorSocial) apunta la ficha abierta en Recientes y recorre las
          filas con las flechas. */}
      <Link
        href={rutaFichaConRetorno(d.id, volver)}
        prefetch={false}
        data-fila-perfil=""
        data-persona={d.id}
        data-nombre={d.nombre}
        data-pais={d.pais ?? ''}
        className="group grid min-h-11 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1.4fr)_auto] md:items-center md:gap-x-5"
      >
        <AvatarAnillo nombre={nombreVisible(d.nombre)} tamano="md" apagado={d.resultadosImportados === 0} className="self-start" />

        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="text-base leading-tight font-semibold break-words">{nombreVisible(d.nombre)}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {d.pais ? <BanderaPais pais={d.pais} conNombre /> : <span>País no publicado</span>}
            <span>
              {d.genero ? GENDER_LABEL[d.genero] : 'Género no publicado'}
              {homonimo && d.anioNacimiento !== null ? `, nacimiento ${d.anioNacimiento}` : ''}
            </span>
          </span>
          {d.armas.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              <span className="sr-only">Armas: </span>
              {d.armas.map((a) => (
                <Badge key={a} variant="secondary">{WEAPON_LABEL[a]}</Badge>
              ))}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Sin pruebas importadas</span>
          )}
          {d.alias ? (
            <span className="text-xs text-muted-foreground">Coincide con el alias «{d.alias}»</span>
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

        <span className="col-span-2 flex min-w-0 flex-col gap-2 md:col-span-1">
          {t.ultima ? (
            <Celda etiqueta="Última competición">
              <span className="text-sm leading-snug break-words">{titular(t.ultima.torneo)}</span>
              {t.ultima.fecha ? (
                <span className="text-xs text-muted-foreground">{fechaLegible(t.ultima.fecha)}</span>
              ) : null}
            </Celda>
          ) : null}
          {t.mejorPuesto !== null || t.oros + t.platas + t.bronces > 0 ? (
            <span className="flex flex-wrap items-center gap-2">
              {t.mejorPuesto !== null ? (
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <Trophy className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">Mejor resultado</span>
                  <span className="cifra font-semibold">{t.mejorPuesto}.º</span>
                </span>
              ) : null}
              <Medallero t={t} />
            </span>
          ) : null}
        </span>

        <span className="col-span-2 flex items-baseline gap-1.5 border-t pt-3 md:col-span-1 md:flex-col md:items-end md:gap-0.5 md:border-t-0 md:pt-0 md:text-right">
          {d.resultadosImportados > 0 ? (
            <>
              <span className="cifra text-3xl leading-none">{d.resultadosImportados}</span>
              <span className="text-xs text-muted-foreground">
                {d.resultadosImportados === 1 ? 'clasificación' : 'clasificaciones'}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Ninguno importado</span>
          )}
          <ChevronRight className="ml-auto size-4 self-center text-muted-foreground group-hover:text-foreground md:hidden" aria-hidden />
        </span>
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
  items: FilaBuscada[];
  siguiente: string | null;
  cursorActual: string | undefined;
  criterios: CriteriosExplorar;
}) {
  // La ficha vuelve a esta misma página de esta misma búsqueda, no a la lista desnuda.
  const volver = construirUrl(criterios, cursorActual);
  return (
    <section aria-labelledby="explorar-resultados" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-3">
        <h2 id="explorar-resultados" className="text-2xl sm:text-3xl">Deportistas</h2>
        <p role="status" className="text-sm text-muted-foreground">
          {items.length === 1 ? '1 deportista' : `${items.length} deportistas`} en esta página
          {siguiente ? ', hay más' : ''}.
        </p>
      </div>

      <ul className="divide-y overflow-hidden rounded-md border bg-card" aria-label="Deportistas encontrados">
        {items.map((d) => (
          <FilaDeportista key={d.id} d={d} volver={volver} />
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

      <Aclaracion titulo="Sobre las clasificaciones importadas">
        <Nota>
          Los resultados importados son las clasificaciones finales ya cargadas de las fuentes oficiales.
          Que una persona tenga cero no significa que no haya competido: puede faltar por importar.
        </Nota>
      </Aclaracion>
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
              : 'Busca por nombre o alias, o elige un filtro. Puedes consultar también a deportistas sin cuenta o retirados.'}
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
