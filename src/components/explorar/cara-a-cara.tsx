import { SearchX, TriangleAlert, Users, X } from 'lucide-react';
import Link from 'next/link';
import { BanderaPais } from '@/components/bandera';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { CoberturaCaraACara } from '@/lib/sport/explorar/cara-a-cara';
import { etiquetaRonda } from '@/lib/sport/explorar/ediciones-asaltos';
import { inicialesVisibles } from '@/lib/sport/nombre-visible';
import {
  chipsCaraACara,
  construirUrlCaraACara,
  rutaCaraACara,
  urlElegirRival,
  urlVistaDelRival,
  type CriteriosCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-url';
import type {
  DatosCaraACara,
  OtrosVista,
  PersonaCaraACara,
  RivalesVista,
  VistaCaraACara,
} from '@/lib/sport/explorar/cara-a-cara-pantalla';
import { etiquetaFase } from '@/lib/sport/explorar/etiquetas';
import type { AsaltoDto, DeportistaResumen } from '@/lib/sport/explorar/tipos';
import { etiquetaTemporada, rutaFicha } from '@/lib/sport/explorar/url';
import { CATEGORY_LABEL, GENDER_LABEL, WEAPON_LABEL, cn, titular } from '@/lib/utils';
import { Aclaracion, Bloque, Celda, Dato, EnlaceFuente, Nota, fechaLegible } from './piezas';

/**
 * Cara a cara individual. Sólo lleva lo que traen los DTO de `cara-a-cara.ts`:
 * asaltos individuales con marcador publicado entre dos personas confirmadas,
 * orientados a la persona consultada. Ningún texto afirma que dos personas
 * «nunca se enfrentaron»: un conjunto vacío sólo describe lo importado.
 */

const ENLACE_CLASES =
  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset';

/* ------------------------------------------------------------------ cobertura */

export type TextoCobertura = { titulo: string; texto: string; aviso: boolean };

/**
 * Qué se puede decir de las pruebas comunes. «Verificado» es por prueba y
 * fuente (asaltos leídos por completo), nunca la carrera entera; «sin pruebas
 * comunes» es ausencia de dato importado, no ausencia de enfrentamiento.
 */
export function textoCobertura(c: CoberturaCaraACara, hayAsaltos: boolean): TextoCobertura {
  const pruebas = (n: number) => `${n} ${n === 1 ? 'prueba' : 'pruebas'}`;
  switch (c.estado) {
    case 'sin_pruebas_comunes':
      return {
        titulo: 'Sin pruebas comunes importadas',
        texto: hayAsaltos
          ? 'Hay asaltos importados pero ninguna prueba común en la lista de cobertura; trata el balance como parcial.'
          : 'No hay ninguna prueba individual importada en la que figuren las dos con estos filtros. Eso no significa que no se hayan enfrentado: puede faltar una temporada, una fuente o su procesado.',
        aviso: true,
      };
    case 'pendiente':
      return {
        titulo: 'Asaltos pendientes de leer',
        texto: `Comparten ${pruebas(c.pruebasComunes)}, pero sus asaltos todavía no se han leído. No hay datos, y tampoco ausencia de enfrentamientos.`,
        aviso: true,
      };
    case 'parcial':
      return {
        titulo: 'Cobertura parcial',
        texto: `Comparten ${pruebas(c.pruebasComunes)} y ${pruebas(c.pruebasSinVerificar)} de ellas tienen los asaltos sin leer, incompletos o con errores${c.pendientesTruncado ? ' (la lista de abajo está recortada)' : ''}. El balance puede estar incompleto.`,
        aviso: true,
      };
    case 'verificado':
      return {
        titulo: 'Asaltos leídos por completo',
        texto: `Los asaltos de las ${pruebas(c.pruebasComunes)} comunes importadas se han leído por completo. Describe sólo esas pruebas con estos filtros: no promete que estén todas las temporadas ni todas las fuentes.`,
        aviso: false,
      };
  }
}

const ESTADO_PRUEBA: Record<string, string> = {
  pendiente: 'Asaltos sin leer todavía',
  parcial: 'Lectura incompleta o con errores',
};

export function CoberturaCaraACaraVista({
  cobertura,
  hayAsaltos,
}: {
  cobertura: CoberturaCaraACara;
  hayAsaltos: boolean;
}) {
  const t = textoCobertura(cobertura, hayAsaltos);
  return (
    <Bloque id="h2h-cobertura" titulo="Qué cubre este cara a cara" nivel="pagina">
      <div
        role="status"
        className={cn('flex items-start gap-2 rounded-md border bg-card px-4 py-3 text-sm', t.aviso && 'border-warn/40')}
      >
        {t.aviso ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden /> : null}
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t.titulo}</p>
          <p className="medida text-muted-foreground">{t.texto}</p>
        </div>
      </div>

      {cobertura.pruebasComunes > 0 ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y bg-card p-4 lg:grid-cols-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Pruebas comunes importadas</dt>
            <dd className="cifra text-2xl leading-none">{cobertura.pruebasComunes}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Con asaltos entre ambas</dt>
            <dd className="cifra text-2xl leading-none">{cobertura.pruebasConAsaltos}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Sin asaltos publicados por la fuente</dt>
            <dd className="cifra text-2xl leading-none">{cobertura.pruebasSinAsaltosPublicados}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Sin verificar</dt>
            <dd className="cifra text-2xl leading-none">{cobertura.pruebasSinVerificar}</dd>
          </div>
        </dl>
      ) : null}

      {cobertura.pruebasSinAsaltosPublicados > 0 ? (
        <Nota>
          En las pruebas sin asaltos publicados la fuente sólo da la clasificación final: de ahí no
          se puede deducir si se enfrentaron ni quién ganó.
        </Nota>
      ) : null}

      {cobertura.pendientes.length > 0 ? (
        <ul className="divide-y rounded-md border bg-card" aria-label="Pruebas comunes sin verificar">
          {cobertura.pendientes.map((p) => (
            <li key={p.id} className="grid gap-x-4 gap-y-1 px-3 py-3 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,2fr)] md:items-center">
              <span className="font-medium break-words">{titular(p.torneo)}</span>
              <span className="text-xs text-muted-foreground">
                {WEAPON_LABEL[p.arma]} {GENDER_LABEL[p.genero].toLowerCase()}, {etiquetaTemporada(p.temporada)}
              </span>
              <span className="text-sm">{ESTADO_PRUEBA[p.estado] ?? p.estado}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Bloque>
  );
}

/* -------------------------------------------------------------------- balance */

export function BalanceCaraACara({ datos }: { datos: DatosCaraACara }) {
  const { yo, rival } = datos.personas;
  const r = datos.resumen;
  if (r.asaltos === 0) {
    return (
      <Bloque id="h2h-balance" titulo="Balance" nivel="pagina">
        <p role="status" className="medida text-sm text-muted-foreground">
          Ningún asalto individual con marcador publicado entre {titular(yo.nombre)} y{' '}
          {titular(rival.nombre)} está importado con estos filtros. No se muestra un balance porque
          la falta de datos no equivale a un empate a cero: mira abajo qué cubre la lectura.
        </p>
      </Bloque>
    );
  }
  const decididos = r.victorias + r.derrotas;
  return (
    <Bloque id="h2h-balance" titulo="Balance" nivel="pagina">
      {decididos > 0 ? (
        <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-muted">
          <span className="bg-ok" style={{ width: `${(r.victorias / decididos) * 100}%` }} />
          <span className="bg-danger" style={{ width: `${(r.derrotas / decididos) * 100}%` }} />
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-lg border bg-card p-4 sm:p-6 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-2">
          <dt className="text-xs text-muted-foreground break-words">Victorias de {titular(yo.nombre)}</dt>
          <dd className="cifra text-5xl leading-none">{r.victorias}</dd>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <dt className="text-xs text-muted-foreground break-words">Victorias de {titular(rival.nombre)}</dt>
          <dd className="cifra text-5xl leading-none">{r.derrotas}</dd>
        </div>
        {r.sinDecidir > 0 ? (
          <div className="flex min-w-0 flex-col gap-2">
            <dt className="text-xs text-muted-foreground">Marcador igualado, sin ganador</dt>
            <dd className="cifra text-5xl leading-none">{r.sinDecidir}</dd>
          </div>
        ) : null}
        <div className="col-span-2 flex min-w-0 flex-col gap-2 lg:col-span-1">
          <dt className="text-xs text-muted-foreground">Tantos de {titular(yo.nombre)} y del rival</dt>
          <dd className="cifra flex flex-wrap items-baseline gap-x-2 text-5xl leading-none">
            {r.tantosFavor}
            <span className="text-muted-foreground"> a </span>
            {r.tantosContra}
          </dd>
        </div>
      </dl>
      <Aclaracion titulo={`Balance de ${r.asaltos} ${r.asaltos === 1 ? 'asalto importado' : 'asaltos importados'}`}>
        <Nota>
          Cuenta {r.asaltos} {r.asaltos === 1 ? 'asalto individual' : 'asaltos individuales'} con
          marcador publicado e importados con estos filtros, cada uno una sola vez aunque la matriz
          de la poule lo publique desde las dos perspectivas. No es el balance de toda su carrera.
        </Nota>
      </Aclaracion>
    </Bloque>
  );
}

/* ---------------------------------------------------------------------- asaltos */

/** Pastilla V/D: la letra y el texto oculto dicen el resultado, el color sólo lo acompaña. */
function PastillaResultado({
  victoria,
  className,
  decorativa = false,
}: {
  victoria: boolean;
  className?: string;
  /** Cuando el resultado ya va escrito al lado, la pastilla no se vuelve a leer. */
  decorativa?: boolean;
}) {
  return (
    <span
      aria-hidden={decorativa || undefined}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-background',
        victoria ? 'bg-ok' : 'bg-danger',
        className,
      )}
    >
      <span aria-hidden>{victoria ? 'V' : 'D'}</span>
      {decorativa ? null : <span className="sr-only">{victoria ? 'Victoria' : 'Derrota'}</span>}
    </span>
  );
}

function FilaAsalto({ a, yo, rival }: { a: AsaltoDto; yo: PersonaCaraACara; rival: PersonaCaraACara }) {
  const victoria = a.resultado === 'victoria';
  const ronda = a.rondaPublicada ? etiquetaRonda(a.fase, a.rondaPublicada) : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-4 py-4 md:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)]">
      <PastillaResultado victoria={victoria} decorativa className="size-9 text-sm" />
      <Celda etiqueta="Marcador">
        <span className="flex items-baseline gap-2">
          <span className="cifra text-4xl leading-none">{a.marcador.mios}</span>
          <span className="text-xs text-muted-foreground">frente a</span>
          <span className="cifra text-4xl leading-none text-muted-foreground">{a.marcador.rival}</span>
        </span>
        <span className="text-xs break-words">
          <span className={victoria ? 'font-medium text-ok' : 'font-medium text-danger'}>
            {victoria ? 'Victoria' : 'Derrota'}
          </span>{' '}
          de {titular(yo.nombre)} sobre {titular(rival.nombre)}
        </span>
      </Celda>
      <Celda etiqueta="Fase y ronda" className="col-start-2 md:col-start-auto">
        <Dato>
          {etiquetaFase(a.fase)}
          {ronda ? <span className="text-muted-foreground"> · {ronda}</span> : null}
        </Dato>
        {a.rondaPublicada ? (
          <span className="text-xs text-muted-foreground break-words">Ronda publicada: «{a.rondaPublicada}»</span>
        ) : (
          <span className="text-xs text-muted-foreground">Ronda no publicada</span>
        )}
      </Celda>
      <Celda etiqueta="Fuente" className="col-start-2 md:col-start-auto">
        <EnlaceFuente url={a.enlace} etiqueta="Abrir en la fuente" />
      </Celda>
    </li>
  );
}

type GrupoAsaltos = { clave: string; primero: AsaltoDto; asaltos: AsaltoDto[] };

/** Agrupa asaltos seguidos de la misma prueba; el orden (más reciente primero) no se toca. */
function agruparPorPrueba(items: readonly AsaltoDto[]): GrupoAsaltos[] {
  const grupos: GrupoAsaltos[] = [];
  for (const a of items) {
    const clave = `${a.torneo.id}|${a.prueba.id}`;
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.clave === clave) ultimo.asaltos.push(a);
    else grupos.push({ clave, primero: a, asaltos: [a] });
  }
  return grupos;
}

function GrupoDePrueba({ g, yo, rival }: { g: GrupoAsaltos; yo: PersonaCaraACara; rival: PersonaCaraACara }) {
  const a = g.primero;
  const categoria = CATEGORY_LABEL[a.prueba.categoria.codigo as keyof typeof CATEGORY_LABEL] ?? a.prueba.categoria.codigo;
  const ganados = g.asaltos.filter((x) => x.resultado === 'victoria').length;
  return (
    <li className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b bg-secondary/60 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold break-words">{titular(a.torneo.nombre)}</span>
          <span className="text-xs text-muted-foreground break-words">
            {WEAPON_LABEL[a.prueba.arma]} {GENDER_LABEL[a.prueba.genero].toLowerCase()}, {categoria}
            {a.prueba.categoria.raw ? ` («${a.prueba.categoria.raw}»)` : ''}
          </span>
        </div>
        <div className="flex flex-col items-start gap-0.5 text-sm sm:items-end">
          {a.fecha ? (
            <Dato>{fechaLegible(a.fecha)}</Dato>
          ) : (
            <span className="text-sm text-muted-foreground">Fecha no publicada</span>
          )}
          <span className="text-xs text-muted-foreground">{etiquetaTemporada(a.temporada)}</span>
        </div>
        {g.asaltos.length > 1 ? (
          <span className="w-full text-xs text-muted-foreground">
            {g.asaltos.length} asaltos en esta prueba: {ganados} {ganados === 1 ? 'ganado' : 'ganados'} por{' '}
            {titular(yo.nombre)}
          </span>
        ) : null}
      </div>
      <ul className="divide-y">
        {g.asaltos.map((x) => (
          <FilaAsalto key={x.id} a={x} yo={yo} rival={rival} />
        ))}
      </ul>
    </li>
  );
}

export function AsaltosCaraACara({
  datos,
  criterios,
}: {
  datos: DatosCaraACara;
  criterios: CriteriosCaraACara;
}) {
  const { yo, rival } = datos.personas;
  const base = { ...criterios, cursor: '' };
  return (
    <Bloque id="h2h-asaltos" titulo="Asaltos" nivel="pagina">
      <Aclaracion titulo={`Marcador desde ${titular(yo.nombre)}`}>
        <Nota>
          Del más reciente al más antiguo. El marcador está visto desde {titular(yo.nombre)}. La ronda
          es la clave que publica la fuente; si no la publica, no se completa.
        </Nota>
      </Aclaracion>
      {datos.items.length === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">
          {datos.resumen.asaltos > 0
            ? 'Todos los asaltos importados con estos filtros terminaron con el marcador igualado, así que no hay ganador que listar.'
            : 'No hay asaltos importados que listar con estos filtros.'}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-4" aria-label="Asaltos entre las dos personas, por prueba">
            {agruparPorPrueba(datos.items).map((g) => (
              <GrupoDePrueba key={`${g.clave}|${g.primero.id}`} g={g} yo={yo} rival={rival} />
            ))}
          </ul>
          <nav aria-label="Páginas de asaltos" className="flex flex-wrap items-center gap-3">
            {criterios.cursor ? (
              <Button asChild variant="outline">
                <Link href={construirUrlCaraACara(yo.id, base, 'h2h-asaltos')} prefetch={false}>
                  Volver a los más recientes
                </Link>
              </Button>
            ) : null}
            {datos.siguiente ? (
              <Button asChild variant="outline">
                <Link
                  href={construirUrlCaraACara(yo.id, { ...base, cursor: datos.siguiente }, 'h2h-asaltos')}
                  prefetch={false}
                  rel="next"
                >
                  Ver asaltos anteriores
                </Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">No hay más asaltos importados con estos filtros.</p>
            )}
          </nav>
        </>
      )}
    </Bloque>
  );
}

/* --------------------------------------------------------------------- cabecera */

export function CabeceraCaraACara({
  datos,
  criterios,
}: {
  datos: DatosCaraACara;
  criterios: CriteriosCaraACara;
}) {
  const { yo, rival } = datos.personas;
  const enlace = cn(
    'inline-flex min-h-11 items-center text-sm text-primary-text underline-offset-4 hover:underline',
    ENLACE_CLASES,
  );
  // La cabecera también se pinta sólo con las personas (sin resumen ni asaltos).
  const r = datos.resumen;
  const conBalance = Boolean(r && r.asaltos > 0);
  // Los últimos asaltos sólo son los últimos en la primera página.
  const ultimos = !criterios.cursor ? (datos.items ?? []).slice(0, 5) : [];
  return (
    <header className="flex min-w-0 flex-col gap-5 overflow-hidden rounded-xl border bg-card px-4 py-5 sm:px-6 sm:py-6">
      <h1 className="text-3xl leading-tight sm:text-4xl">Cara a cara</h1>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-3 gap-y-4 sm:gap-x-6">
        <dl className="flex min-w-0 flex-col items-start gap-1">
          <dt className="text-xs text-muted-foreground">Visto desde</dt>
          <dd className="flex min-w-0 flex-col items-start gap-2">
            <Avatar className="size-12 sm:size-16">
              <AvatarFallback className="text-base sm:text-lg">{inicialesVisibles(yo.nombre)}</AvatarFallback>
            </Avatar>
            <span className="font-display text-xl leading-tight break-words sm:text-3xl">{titular(yo.nombre)}</span>
            {yo.pais ? <BanderaPais pais={yo.pais} conNombre /> : null}
          </dd>
        </dl>
        <div aria-hidden className="flex flex-col items-center gap-1 self-center pt-5">
          {conBalance && r ? (
            <>
              <span className="cifra flex items-baseline gap-1.5 text-4xl leading-none sm:gap-3 sm:text-6xl">
                <span className={r.victorias >= r.derrotas ? 'text-foreground' : 'text-muted-foreground'}>{r.victorias}</span>
                <span className="text-2xl text-muted-foreground sm:text-4xl">–</span>
                <span className={r.derrotas >= r.victorias ? 'text-foreground' : 'text-muted-foreground'}>{r.derrotas}</span>
              </span>
              <span className="text-center text-xs text-muted-foreground">
                tocados <span className="cifra">{r.tantosFavor}</span>–<span className="cifra">{r.tantosContra}</span>
              </span>
            </>
          ) : (
            <span className="font-display text-2xl text-muted-foreground sm:text-3xl">vs</span>
          )}
        </div>
        <dl className="flex min-w-0 flex-col items-end gap-1 text-right">
          <dt className="text-xs text-muted-foreground">Rival</dt>
          <dd className="flex min-w-0 flex-col items-end gap-2">
            <Avatar className="size-12 sm:size-16">
              <AvatarFallback className="text-base sm:text-lg">{inicialesVisibles(rival.nombre)}</AvatarFallback>
            </Avatar>
            <span className="font-display text-xl leading-tight break-words sm:text-3xl">{titular(rival.nombre)}</span>
            {rival.pais ? <BanderaPais pais={rival.pais} conNombre /> : null}
          </dd>
        </dl>
      </div>
      {conBalance && r ? (
        <p className="sr-only">
          {r.victorias} {r.victorias === 1 ? 'victoria' : 'victorias'} y {r.derrotas}{' '}
          {r.derrotas === 1 ? 'derrota' : 'derrotas'} de {titular(yo.nombre)}, {r.tantosFavor} tocados a favor y{' '}
          {r.tantosContra} en contra, en los asaltos importados con estos filtros.
        </p>
      ) : null}
      {ultimos.length > 0 ? (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t pt-4">
          <span className="text-xs text-muted-foreground">Últimos asaltos, del más reciente:</span>
          <ol className="flex gap-1.5">
            {ultimos.map((a) => (
              <li key={a.id}>
                <PastillaResultado victoria={a.resultado === 'victoria'} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <nav aria-label="Enlaces del cara a cara" className="flex flex-wrap gap-x-5 gap-y-1">
        <Link href={rutaFicha(yo.id)} prefetch={false} className={enlace} aria-label={`Ficha de ${titular(yo.nombre)}`}>
          Ficha consultada
        </Link>
        <Link href={rutaFicha(rival.id)} prefetch={false} className={enlace} aria-label={`Ficha de ${titular(rival.nombre)}`}>
          Ficha del rival
        </Link>
        <Link href={urlVistaDelRival(yo.id, rival.id, criterios)} prefetch={false} className={enlace} aria-label={`Verlo desde ${titular(rival.nombre)}`}>
          Invertir perspectiva
        </Link>
        <Link
          href={construirUrlCaraACara(yo.id, { temporada: criterios.temporada, arma: criterios.arma, fase: criterios.fase })}
          prefetch={false}
          className={enlace}
        >
          Cambiar de rival
        </Link>
      </nav>
    </header>
  );
}

export function CaraACaraCompleto({
  datos,
  criterios,
}: {
  datos: DatosCaraACara;
  criterios: CriteriosCaraACara;
}) {
  return (
    <div className="flex flex-col gap-6">
      <BalanceCaraACara datos={datos} />
      <CoberturaCaraACaraVista cobertura={datos.cobertura} hayAsaltos={datos.resumen.asaltos > 0} />
      <AsaltosCaraACara datos={datos} criterios={criterios} />
      <Aclaracion titulo="Qué se incluye en el cara a cara">
        <Nota>
          Sólo cuentan asaltos individuales entre dos personas confirmadas con el marcador
          publicado. Los resultados finales, los BYE, los encuentros por equipos y los relevos no
          suman victorias ni derrotas.
        </Nota>
      </Aclaracion>
    </div>
  );
}

/* ----------------------------------------------------------------- elegir rival */

function FilaPersona({
  href,
  nombre,
  pais,
  detalle,
  aviso,
}: {
  href: string;
  nombre: string;
  pais: string | null;
  detalle: React.ReactNode;
  aviso?: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        className={cn(
          'grid min-h-11 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-4 hover:bg-accent focus-visible:bg-accent md:grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)] md:items-center',
          ENLACE_CLASES,
        )}
      >
        <Avatar className="row-span-3 size-10 md:row-span-1">
          <AvatarFallback>{inicialesVisibles(nombre)}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-medium break-words">{titular(nombre)}</span>
          {aviso}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          {pais ? (
            <BanderaPais pais={pais} conNombre />
          ) : (
            <span className="text-sm text-muted-foreground">País no publicado</span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">{detalle}</span>
      </Link>
    </li>
  );
}

function OtrosCoincidentes({
  otros,
  persona,
  excluidos,
  criterios,
}: {
  otros: OtrosVista;
  persona: PersonaCaraACara;
  excluidos: ReadonlySet<string>;
  criterios: CriteriosCaraACara;
}) {
  if (otros.tipo === 'error') {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <span className="medida">
          No se ha podido buscar a otras personas indexadas por ese nombre. Ha fallado la consulta; no es
          que no haya coincidencias.
        </span>
      </p>
    );
  }
  const items = otros.items.filter((d: DeportistaResumen) => d.id !== persona.id && !excluidos.has(d.id));
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 id="h2h-otros" className="text-lg">
        Otras personas indexadas que coinciden
      </h3>
      {/* La lista confirmada filtra por nombre canónico y esta búsqueda también casa alias: que una persona
          no figure arriba no prueba que no tenga asaltos con la consultada, ni siquiera con la lista leída. */}
      <Nota>
        Son personas indexadas que coinciden con el nombre o un alias. No se afirma que tengan o no asaltos
        con {titular(persona.nombre)}: su cobertura se determina al abrirlo, y ahí se muestra qué cubre la
        lectura, no un balance.
      </Nota>
      <ul aria-labelledby="h2h-otros" className="divide-y rounded-md border bg-card">
        {items.map((d) => (
          <FilaPersona
            key={d.id}
            href={urlElegirRival(persona.id, d.id, criterios)}
            nombre={d.nombre}
            pais={d.pais}
            aviso={
              d.mismoNombre > 1 ? (
                <span className="inline-flex items-start gap-1.5 text-xs text-warn">
                  <Users className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{d.mismoNombre} personas con este nombre: comprueba país, año y armas.</span>
                </span>
              ) : d.alias ? (
                <span className="text-xs text-muted-foreground">Coincide con el alias «{d.alias}»</span>
              ) : undefined
            }
            detalle={
              <>
                <span className="text-sm">
                  {d.armas.length > 0 ? d.armas.map((a) => WEAPON_LABEL[a]).join(', ') : 'Sin pruebas importadas'}
                </span>
                {d.anioNacimiento !== null && d.mismoNombre > 1 ? (
                  <span className="text-xs text-muted-foreground">Nacimiento {d.anioNacimiento}</span>
                ) : null}
              </>
            }
          />
        ))}
      </ul>
    </div>
  );
}

const MENSAJES_RIVALES: Record<'cursor_invalido' | 'entrada_invalida' | 'no_disponible' | 'error', string> = {
  cursor_invalido:
    'Esta página de rivales es de otra búsqueda o ha caducado. Vuelve a la primera página.',
  entrada_invalida:
    'Algún valor de la dirección no se entiende (por ejemplo la temporada), así que no se ha listado a nadie. No significa que no haya rivales.',
  no_disponible:
    'Los datos deportivos todavía no están preparados en esta instalación. No significa que no haya rivales.',
  error: 'Ha fallado la consulta; no es que no haya rivales. Inténtalo de nuevo.',
};

export function ElegirRival({
  persona,
  rivales,
  otros,
  criterios,
}: {
  persona: PersonaCaraACara;
  rivales: RivalesVista;
  otros: OtrosVista | null;
  criterios: CriteriosCaraACara;
}) {
  const base = { ...criterios, cursor: '' };
  const idsRivales = new Set(rivales.tipo === 'ok' ? rivales.items.map((r) => r.id) : []);
  return (
    <div className="flex flex-col gap-6">
      <Bloque id="h2h-rivales" titulo="Rivales con asaltos confirmados" nivel="pagina">
        <Nota>
          Personas con las que {titular(persona.nombre)} tiene al menos un asalto individual con marcador
          publicado ya importado, por orden alfabético.
          {criterios.temporada ? ` Sólo de ${etiquetaTemporada(criterios.temporada)}.` : ''}
        </Nota>
        {rivales.tipo === 'ok' ? (
          rivales.sinResultados ? (
            <p role="status" className="medida text-sm text-muted-foreground">
              {criterios.q || criterios.temporada
                ? 'Ningún rival con asaltos importados coincide con estos criterios. '
                : 'Todavía no hay asaltos individuales importados de esta persona. '}
              Puede faltar por importar; no significa que no haya competido. Busca por nombre para abrir el
              cara a cara con cualquier persona y ver qué cubre.
            </p>
          ) : (
            <>
              <ul className="divide-y rounded-md border bg-card" aria-label="Rivales con asaltos confirmados">
                {rivales.items.map((r) => (
                  <FilaPersona
                    key={r.id}
                    href={urlElegirRival(persona.id, r.id, criterios)}
                    nombre={r.nombre}
                    pais={r.pais}
                    detalle={
                      <span className="flex items-baseline gap-1.5">
                        <span className="cifra text-2xl leading-none">{r.asaltos}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.asaltos === 1 ? 'asalto importado' : 'asaltos importados'}
                        </span>
                      </span>
                    }
                  />
                ))}
              </ul>
              <nav aria-label="Páginas de rivales" className="flex flex-wrap items-center gap-3">
                {criterios.cursor ? (
                  <Button asChild variant="outline">
                    <Link href={construirUrlCaraACara(persona.id, base)} prefetch={false}>
                      Volver a la primera página
                    </Link>
                  </Button>
                ) : null}
                {rivales.siguiente ? (
                  <Button asChild variant="outline">
                    <Link
                      href={construirUrlCaraACara(persona.id, { ...base, cursor: rivales.siguiente })}
                      prefetch={false}
                      rel="next"
                    >
                      Ver más rivales
                    </Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay más rivales con estos criterios.</p>
                )}
              </nav>
            </>
          )
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-md border bg-card px-4 py-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <div className="flex flex-col items-start gap-2">
              <p className="medida">{MENSAJES_RIVALES[rivales.tipo]}</p>
              {rivales.tipo === 'cursor_invalido' ? (
                <Button asChild variant="outline">
                  <Link href={construirUrlCaraACara(persona.id, base)} prefetch={false}>
                    Volver a la primera página
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Bloque>

      {otros ? (
        <OtrosCoincidentes
          otros={otros}
          persona={persona}
          excluidos={idsRivales}
          criterios={criterios}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- chips */

/** Filtros activos como enlaces que los quitan uno a uno. */
export function ChipsCaraACara({
  personaId,
  criterios,
}: {
  personaId: string;
  criterios: CriteriosCaraACara;
}) {
  const chips = chipsCaraACara(personaId, criterios);
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros activos" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <li key={chip.clave} className="min-w-0 max-w-full">
          <Link
            href={chip.quitar}
            prefetch={false}
            aria-label={`Quitar filtro ${chip.etiqueta}: ${chip.valor}`}
            className={cn(
              'inline-flex min-h-11 max-w-full flex-wrap items-center gap-1.5 rounded-full border bg-secondary px-3 text-sm hover:bg-accent',
              ENLACE_CLASES,
            )}
          >
            <span className="text-muted-foreground">{chip.etiqueta}</span>
            <span className="max-w-48 min-w-0 py-1 font-medium break-words">{chip.valor}</span>
            <X className="size-3.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------- estados */

function Aviso({
  titulo,
  children,
  alerta = false,
}: {
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
        {alerta ? (
          <TriangleAlert className="size-5 text-warn" aria-hidden />
        ) : (
          <SearchX className="size-5 text-muted-foreground" aria-hidden />
        )}
        <h2 className="text-xl">{titulo}</h2>
      </div>
      <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground medida">{children}</div>
    </section>
  );
}

export function EstadoCaraACara({
  vista,
  personaId,
  criterios,
}: {
  vista: Exclude<VistaCaraACara, { tipo: 'ok' } | { tipo: 'elegir' } | { tipo: 'sin_sesion' }>;
  personaId: string | null;
  criterios: CriteriosCaraACara;
}) {
  const buscar = (
    <Button asChild variant="outline">
      <Link href="/explorar" prefetch={false}>
        Buscar en Explorar
      </Link>
    </Button>
  );
  const empezar = personaId ? (
    <Button asChild variant="outline">
      <Link href={rutaCaraACara(personaId)} prefetch={false}>
        Empezar de nuevo
      </Link>
    </Button>
  ) : (
    buscar
  );
  switch (vista.tipo) {
    case 'entrada_invalida':
      return (
        <Aviso alerta titulo="El enlace no es válido">
          <p>
            Alguno de los valores de la dirección no se entiende (una persona, una temporada, un arma o
            una fase), por eso no se ha hecho el cara a cara. Esto no significa que no haya asaltos.
          </p>
          {empezar}
        </Aviso>
      );
    case 'cursor_invalido':
      return (
        <Aviso alerta titulo="Esta página ya no corresponde a la consulta">
          <p>El enlace de página es de otro cara a cara o de otros filtros. Vuelve a los asaltos más recientes.</p>
          {personaId ? (
            <Button asChild variant="outline">
              <Link href={construirUrlCaraACara(personaId, { ...criterios, cursor: '' })} prefetch={false}>
                Volver a los más recientes
              </Link>
            </Button>
          ) : null}
        </Aviso>
      );
    case 'no_encontrada':
      return (
        <Aviso titulo="No se encuentra a una de las personas">
          <p>No hay ninguna persona deportiva con ese identificador. Puede que el enlace sea antiguo.</p>
          {buscar}
        </Aviso>
      );
    case 'misma_persona':
      return (
        <Aviso titulo="Es la misma persona">
          <p>
            Las dos direcciones apuntan a la misma persona (puede ser una ficha fusionada con otra). Elige
            un rival distinto.
          </p>
          {empezar}
        </Aviso>
      );
    case 'no_disponible':
      return (
        <Aviso alerta titulo="El cara a cara aún no está activo">
          <p>
            Los datos deportivos todavía no están preparados en esta instalación. No es que no haya
            asaltos.
          </p>
        </Aviso>
      );
    default:
      return (
        <Aviso alerta titulo="No se ha podido abrir el cara a cara">
          <p>
            Ha fallado la consulta; no es que no haya asaltos. Inténtalo de nuevo; si sigue fallando,
            avisa a la dirección técnica.
          </p>
          {empezar}
        </Aviso>
      );
  }
}
