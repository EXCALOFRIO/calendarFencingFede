import { Ban, ExternalLink, FileText, FileX2, Layers, Search, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { requireProfile } from '@/lib/auth/session';
import {
  type FilaDocumento,
  type VersionAnterior,
  datosDeDocumentos,
} from '@/lib/documentos/consultas';
import { formatDateEs, titularDocumento } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Normativa' };

/** Cuántas circulares se pintan de golpe. Ver más añade otro tanto. */
const PASO = 30;
const TOPE = 300;

/**
 * La RFEE numera sus circulares `12-26`: la doce de la temporada 26. Se parte
 * en dos para que el número quede como cifra y el año debajo, igual que el día
 * y el mes en el calendario. Si viene en otro formato, se deja entero.
 */
function partirCircular(n: string): [string, string | null] {
  const m = /^\s*(\d{1,3})\s*[-/]\s*(\d{2,4})\s*$/.exec(n);
  return m ? [m[1], m[2]] : [n.trim(), null];
}

/**
 * Normativa: circulares y reglamentos de la RFEE.
 *
 * ------------------------------------------------------------------------
 * QUÉ CAMBIÓ Y POR QUÉ
 * ------------------------------------------------------------------------
 * Antes esta pantalla listaba las 278 circulares y las presentaba TODAS como
 * igual de válidas. Con eso, alguien podía abrir la «NORMATIVA COMPETICIONES
 * EQUIPOS 2026-2027_V1» sin enterarse de que existe una _V3, o seguir el
 * protocolo de equipaje que una circular posterior CANCELÓ. Un dato dudoso
 * visible es mejor que un dato malo publicado, y una norma derogada enseñada
 * como vigente es un dato malo publicado.
 *
 * Ahora la lista es lo que MANDA: 199 de las 278. Debajo de cada circular que
 * tiene historia cuelgan sus versiones anteriores, en pequeño y con su fecha,
 * para poder ver qué decía antes sin abrir nada ni navegar a ningún sitio. Eso
 * era la petición literal: «poder ver lo que había antes… de alguna forma
 * sencilla… bien integrado todo».
 *
 * Tres decisiones de presentación que no son obvias:
 *
 *  · LO CANCELADO SE SIGUE VIENDO, apagado y con la palabra «cancelada». No
 *    tiene sustituta a la que mandar a nadie, así que ocultarlo haría que quien
 *    la busque no la encuentre y siga creyendo que vale.
 *  · LAS VERSIONES ANTERIORES NO SE ESCONDEN DETRÁS DE UN CLIC. El usuario
 *    rechaza los submenús («nada de muchos menús ni submenús, todo en un
 *    vistazo»), y son dos o tres líneas de once píxeles: cabe.
 *  · BUSCAR ENSEÑA TODO, EN PLANO. Quien teclea «12-23» quiere esa circular
 *    concreta; si está superada, lo que necesita es que se le diga y que se le
 *    enlace la que manda, no que desaparezca del buscador.
 *
 * El color nunca comunica solo: cada estado lleva su palabra y su icono.
 */
export default async function DocumentosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; n?: string; todas?: string }>;
}) {
  await requireProfile();
  const { q, n, todas } = await searchParams;
  const termino = q?.trim();
  const verTodas = todas === '1';

  const pedidos = Number.parseInt(n ?? '', 10);
  const limite = Math.min(
    Number.isFinite(pedidos) && pedidos > 0 ? pedidos : PASO,
    TOPE,
  );

  const datos = await datosDeDocumentos({ termino, limite, todas: verTodas });

  const quedan = datos.total - datos.filas.length;
  const siguiente = new URLSearchParams();
  if (termino) siguiente.set('q', termino);
  if (verTodas) siguiente.set('todas', '1');
  siguiente.set('n', String(Math.min(limite + PASO, TOPE)));

  const fueraDeJuego = datos.superadas + datos.duplicadas;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/*
          El filete debajo del titular, igual que en el calendario y que en
          `Cabecera`: la estructura de esta aplicación son bandas separadas por
          filetes de un píxel, y sin él el título flotaba sobre la textura.
        */}
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-filete pb-3">
          <h1 className="text-2xl sm:text-3xl">Normativa</h1>
          <p className="text-xs text-muted-foreground">
            <span className="cifra text-base text-foreground">{datos.total}</span>{' '}
            {termino
              ? `${datos.total === 1 ? 'coincide' : 'coinciden'} con «${termino}»`
              : verTodas
                ? 'circulares publicadas por la RFEE, incluidas las superadas'
                : 'circulares en vigor de la RFEE'}
          </p>
        </header>

        {/*
          La búsqueda es la herramienta principal de esta pantalla, así que va
          arriba del todo. Al enviar se pierde el parámetro `n` a propósito —una
          búsqueda nueva empieza por las 30 primeras—, y por eso no está en el
          formulario. `todas` sí viaja: si alguien está mirando la lista
          completa, buscar no debería sacarlo de ahí.
        */}
        <form method="get" className="flex max-w-xl items-center gap-2">
          {verTodas ? <input type="hidden" name="todas" value="1" /> : null}
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <Input
              name="q"
              defaultValue={termino}
              placeholder="Buscar circular, título o temporada"
              type="search"
              aria-label="Buscar en la normativa"
              className="h-11 pl-8 sm:h-9"
            />
          </div>
          <button type="submit" className="sr-only">
            Buscar
          </button>
          {termino ? (
            <Button variant="ghost" size="sm" asChild className="h-11 sm:h-9">
              <Link href={verTodas ? '/documentos?todas=1' : '/documentos'}>
                <X aria-hidden />
                Quitar
              </Link>
            </Button>
          ) : null}
        </form>

        {/*
          UNA LÍNEA DE TEXTO CORRIDO, NO UNA REJILLA DE TRES TROZOS.

          Dice cuántas circulares no se están enseñando y da la única forma de
          verlas: un enlace en la fila de controles, no un submenú.

          Estaba como `flex flex-wrap` con el icono, la frase y el enlace como
          tres elementos, y medido en un iPhone se partía en cuatro renglones:
          el icono solo en el primero, la frase en dos y el enlace en el
          cuarto. 250 px de mueble antes de la primera circular. Con todo
          dentro de un párrafo normal —icono `inline` incluido— son dos
          renglones y se lee como una frase, que es lo que es.
        */}
        {!termino && fueraDeJuego > 0 ? (
          <p className="medida text-xs text-muted-foreground">
            <Layers className="mr-1.5 inline size-3.5 align-[-0.15em]" aria-hidden />
            <span className="cifra text-sm text-foreground">{fueraDeJuego}</span> han
            quedado atrás porque hay una versión posterior.{' '}
            <Link
              href={verTodas ? '/documentos' : '/documentos?todas=1'}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {verTodas ? 'Enseñar solo lo que manda' : 'Enseñarlas también'}
            </Link>
          </p>
        ) : null}

        {datos.sinCalcular ? (
          <p className="medida text-xs text-warn">
            Todavía no se ha calculado qué circulares están en vigor, así que la
            lista sale sin marcar. Se recalcula solo en la siguiente carga desde
            esgrima.es.
          </p>
        ) : null}
      </div>

      {datos.filas.length === 0 ? (
        <div className="flex flex-col items-start gap-1 border-t py-10">
          <FileText className="size-5 text-muted-foreground" aria-hidden />
          <p className="mt-1 text-sm font-medium">
            {termino ? 'Ninguna circular coincide' : 'Todavía no hay circulares'}
          </p>
          <p className="medida text-xs text-muted-foreground">
            {termino
              ? 'Solo se indexa lo que la RFEE publica en esgrima.es. Prueba con el número de circular o con la temporada.'
              : 'Se cargan una vez al día desde esgrima.es. Pide a un administrador que lance la carga.'}
          </p>
          {termino ? (
            <Button variant="outline" size="sm" asChild className="mt-3">
              <Link href="/documentos">Ver todas las circulares</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-card">
          {datos.filas.map((d) => (
            <li key={d.id}>
              <Circular fila={d} />
              {/*
                Las versiones anteriores, colgadas de la que manda. Van DENTRO
                del mismo `li` y fuera del enlace, porque cada una tiene su
                propio enlace a su propio PDF: un enlace dentro de otro es
                marcado inválido y el teclado no sabe recorrerlo.
              */}
              {d.familia && datos.anteriores[d.familia]?.length ? (
                <Anteriores lista={datos.anteriores[d.familia]} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {quedan > 0 ? (
        <Button variant="outline" asChild className="h-11 w-full">
          <Link href={`/documentos?${siguiente.toString()}`} scroll={false}>
            Ver {Math.min(quedan, PASO)} más
          </Link>
        </Button>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-filete pt-3">
        {/*
          LOS 32 PDF CAÍDOS, DICHOS UNA VEZ Y CON LA CIFRA.

          Cada fila afectada ya lleva su aviso, pero quien se topa con dos
          botones muertos seguidos necesita saber que no es cosa de la
          aplicación. Con el número delante se entiende de golpe que es un
          problema del origen y cuánto de la lista abarca.
        */}
        {datos.conPdfRoto > 0 ? (
          <p className="medida flex items-start gap-2 text-xs text-warn">
            <FileX2 className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              <span className="cifra text-sm">{datos.conPdfRoto}</span> de las{' '}
              <span className="cifra text-sm">{datos.totalAbsoluto}</span> circulares
              tienen el PDF caído: el enlace que publica la RFEE apunta a un fichero
              que ella misma ha borrado. Esas filas se enseñan igual —el número y el
              título sirven para pedirla— pero no se pueden abrir, así que no se
              enlazan en vez de llevarte a un error.
            </span>
          </p>
        ) : null}

        <p className="medida text-xs text-muted-foreground/70">
          Los PDF se enlazan al original de esgrima.es, no se copian. Qué versión
          manda se deduce del título y de la fecha que publica la federación, no
          del contenido del documento: si una circular deroga otra sin decirlo en
          el título, aquí seguirán saliendo las dos.
        </p>
      </div>
    </div>
  );
}

/**
 * Una circular de la lista principal.
 *
 * -------------------------------------------------------------------------
 * LAS 32 QUE DAN 404 NO SE ENLAZAN
 * -------------------------------------------------------------------------
 * De las 278 circulares, **32 tienen el PDF caído en la propia web de la
 * RFEE**: el enlace que ella publica apunta a un fichero que ya ha borrado.
 * Estaban como cualquier otra, así que tocarlas abría una pestaña con el 404
 * de esgrima.es. Eso es lo peor de los tres finales posibles, porque el
 * usuario no sabe si ha fallado la RFEE, la aplicación o su conexión.
 *
 * Así que la fila **deja de ser un enlace** y se queda como fila muerta con la
 * palabra «el PDF ya no está en esgrima.es» donde estaría el icono de abrir.
 * No se esconde: la circular existió, su número y su título son datos útiles
 * para buscarla por otro camino, y ocultarla haría creer que no existe.
 *
 * Lo que NO se hace es rehospedar el PDF. Aunque aquí la excusa sería buena
 * —el original se ha perdido—, la regla del proyecto es que los documentos de
 * terceros se enlazan a su origen y no se copian al repositorio.
 */
function Circular({ fila }: { fila: FilaDocumento }) {
  const [numero, anio] = fila.circularNumber
    ? partirCircular(fila.circularNumber)
    : [null, null];

  const cancelada = fila.estado === 'cancelada';
  const apagada = cancelada || fila.estado === 'superada' || fila.estado === 'duplicada';

  /*
    Sin PDF no hay enlace: un `<div>`. No vale un `<a>` con `aria-disabled`,
    porque el teclado lo sigue recorriendo y el navegador lo sigue abriendo.
  */
  const Contenedor = fila.pdfRoto ? 'div' : 'a';
  const propiedadesDeEnlace = fila.pdfRoto
    ? {}
    : { href: fila.pdfUrl, target: '_blank', rel: 'noreferrer' };

  return (
    <Contenedor
      {...propiedadesDeEnlace}
      className={`group grid grid-cols-[2rem_minmax(0,1fr)_1rem] items-start gap-3 px-3 py-2.5 transition-colors sm:grid-cols-[2rem_minmax(0,1fr)_9rem_1rem] sm:items-center ${
        fila.pdfRoto ? 'opacity-55' : 'hover:bg-accent/40'
      } ${apagada ? 'opacity-60' : ''}`}
    >
      {/*
        El número de circular es por lo que se pregunta: "mírate la 12". Va
        delante y en grande. Cuando el fichero no lo trae no se inventa: se pone
        el icono de documento y ya.
      */}
      <span className="w-8 shrink-0 pt-0.5 text-center">
        {numero ? (
          <>
            <span className="cifra block text-lg text-foreground">{numero}</span>
            {anio ? (
              <span className="block text-[11px] text-muted-foreground/70">{anio}</span>
            ) : null}
          </>
        ) : (
          /*
            Sin número de circular.
            Antes había aquí un icono de documento con el significado metido en
            un `aria-label`: un icono haciendo de dato, y encima el mismo icono
            que en esta pantalla significa «esto es un PDF» y «no hay
            circulares». Un guion corto ocupa el hueco y dice lo que hay —nada—
            sin pretender ser un dato.
          */
          <span className="cifra block text-lg text-muted-foreground/60" aria-hidden>
            —
          </span>
        )}
      </span>

      <span className="min-w-0">
        <span
          className={`line-clamp-2 text-sm font-medium sm:truncate ${
            cancelada ? 'line-through decoration-danger/60' : ''
          }`}
        >
          {titularDocumento(fila.title)}
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {/* En el móvil la fecha va aquí; donde hay sitio se va a su columna. */}
          <span className="text-muted-foreground sm:hidden">
            {formatDateEs(fila.publishedAt)}
          </span>

          {/*
            El estado. Lleva SIEMPRE la palabra además del color, que es la
            regla del contrato de interfaz: el color no comunica solo.
          */}
          {cancelada ? (
            <span className="inline-flex items-center gap-1 text-danger">
              <Ban className="size-3" aria-hidden />
              cancelada
            </span>
          ) : null}

          {fila.estado === 'superada' ? (
            <span className="text-muted-foreground">superada</span>
          ) : null}

          {fila.estado === 'duplicada' ? (
            <span className="text-muted-foreground">copia exacta de otra</span>
          ) : null}

          {/*
            NO se pinta la etiqueta de versión («V3», «completa», «bis») al lado
            del título: ya la lleva el título, porque sale de su propio nombre
            de fichero. Se probó y quedaba «Normativa Competiciones Equipos
            2026-2027 V3» seguido de una pastilla «V3». Lo que sí aporta es
            cuántas versiones hay, que no está en ninguna parte del título.
          */}
          {fila.versionesEnFamilia > 1 && fila.estado === 'vigente' ? (
            <span className="text-muted-foreground">
              <span className="cifra">{fila.versionesEnFamilia}</span> versiones
            </span>
          ) : null}

          {/*
            Aviso de que la circular toca dinero o plazos. Solo texto: se probó
            también con un filete de color a la izquierda de la fila y salía en
            cuatro de cada cinco circulares, o sea que no distinguía nada y
            dejaba la lista rayada de amarillo.
          */}
          {fila.mentionsFees ? (
            <span className="text-warn">toca importes o plazos</span>
          ) : null}

          {/*
            El aviso va AQUÍ, en la línea de estado de la circular, y no solo
            como icono a la derecha: el icono lo ve quien lo busca, la palabra
            la lee quien pasa. Y dice de quién es el fallo, que es la parte
            que importa.
          */}
          {fila.pdfRoto ? (
            <span className="inline-flex items-center gap-1 text-warn">
              <FileX2 className="size-3 shrink-0" aria-hidden />
              el PDF ya no está en esgrima.es
            </span>
          ) : null}
        </span>

        {/*
          A dónde ir en su lugar. Es la mitad de lo que pidió el usuario, y por
          eso va en su propia línea y con el título de la que manda escrito, no
          detrás de un «ver más».
        */}
        {fila.sustituidaPor ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {cancelada ? 'Cancelada por' : 'Sustituida por'}{' '}
            <span className="text-foreground">
              {titularDocumento(fila.sustituidaPor.title)}
            </span>
            , del {formatDateEs(fila.sustituidaPor.publishedAt)}
          </span>
        ) : null}
      </span>

      <span className="hidden text-right sm:block">
        <span className="block text-xs text-muted-foreground">
          {formatDateEs(fila.publishedAt)}
        </span>
        {fila.seasonLabel ? (
          <span className="block text-[11px] text-muted-foreground/70">
            {fila.seasonLabel}
          </span>
        ) : null}
      </span>

      {fila.pdfRoto ? (
        <>
          <FileX2 className="size-4 shrink-0 text-warn" aria-hidden />
          <span className="sr-only">
            La RFEE ha borrado este PDF de su web: no se puede abrir.
          </span>
        </>
      ) : (
        <>
          <ExternalLink
            className="size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
            aria-hidden
          />
          <span className="sr-only">Abre el PDF en otra pestaña</span>
        </>
      )}
    </Contenedor>
  );
}

/**
 * Las versiones anteriores de una circular.
 *
 * Una línea por versión, apagada y alineada con el título de arriba. No es una
 * tarjeta ni un desplegable: es el mismo recurso que usa el resto de la
 * aplicación —una banda subordinada separada por un filete— y se lee de un
 * vistazo, que es lo que se pedía.
 */
function Anteriores({ lista }: { lista: VersionAnterior[] }) {
  return (
    <ul className="border-t border-border/50 bg-muted/30 px-3 pb-2 pt-1.5 sm:pl-[3.75rem]">
      {/*
        Rótulo en sentence case y no en MAYÚSCULAS espaciadas: el contrato de
        interfaz las prohíbe explícitamente («Rótulos en MAYÚSCULAS espaciadas
        encima de cada título» es uno de los cinco rasgos de «generado por IA»
        que el usuario rechazó).
      */}
      <li className="mb-1 text-[11px] text-muted-foreground/70">Lo que decía antes</li>
      {lista.map((v) => {
        /* Mismo criterio que arriba: sin PDF no hay enlace. */
        const Contenedor = v.pdfRoto ? 'span' : 'a';
        const propiedadesDeEnlace = v.pdfRoto
          ? {}
          : { href: v.pdfUrl, target: '_blank', rel: 'noreferrer' };

        return (
          <li key={v.id}>
            {/*
              La fecha va PRIMERO y como cifra: es lo único que distingue de
              verdad una versión de otra, porque el título de las cinco copias
              de una normativa es idéntico. Y no se repite la etiqueta de
              versión, que ya viene dentro del título.
            */}
            <Contenedor
              {...propiedadesDeEnlace}
              className={`flex items-baseline gap-2 py-1 text-[11px] text-muted-foreground ${
                v.pdfRoto ? 'opacity-70' : 'transition-colors hover:text-foreground'
              }`}
            >
              <span className="shrink-0 tabular-nums">{formatDateEs(v.publishedAt)}</span>
              <span className="min-w-0 flex-1 truncate">{titularDocumento(v.title)}</span>
              {v.estado === 'duplicada' ? (
                <span className="shrink-0">copia exacta</span>
              ) : null}
              {v.pdfRoto ? (
                <>
                  <span className="shrink-0 text-warn">sin PDF</span>
                  <FileX2 className="size-3 shrink-0 text-warn" aria-hidden />
                  <span className="sr-only">
                    La RFEE ha borrado este PDF de su web.
                  </span>
                </>
              ) : (
                <>
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                  <span className="sr-only">
                    Abre el PDF de esta versión en otra pestaña
                  </span>
                </>
              )}
            </Contenedor>
          </li>
        );
      })}
    </ul>
  );
}
