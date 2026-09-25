import { desc, ilike, or, sql } from 'drizzle-orm';
import { ArrowUpRight, FileText, Search, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { officialDocument } from '@/db/schema';
import { requireProfile } from '@/lib/auth/session';
import { formatDateEs, titular } from '@/lib/utils';

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
 * Antes se pintaban 150 tarjetas de una vez: 686 kB de HTML y 15 000 px de
 * alto. Nadie recorre 150 circulares con el pulgar; se busca una. Así que la
 * búsqueda manda (y se resuelve en el servidor, sobre el índice) y la lista
 * empieza con 30. El "ver más" es una navegación blanda: no recarga la página
 * ni pierde el sitio.
 *
 * Además se seleccionan solo las columnas que se pintan. Con `select()`
 * entero viajaban también hashes, ids y fechas de revisión que nadie mira.
 *
 * Se llama «Normativa» en la barra y «Normativa» en el titular. Antes el menú
 * decía una cosa y la pantalla otra ("Circulares"), que es la clase de
 * detalle por la que uno duda de si ha llegado donde quería.
 */
export default async function DocumentosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; n?: string }>;
}) {
  await requireProfile();
  const { q, n } = await searchParams;
  const term = q?.trim();

  const pedidos = Number.parseInt(n ?? '', 10);
  const limite = Math.min(
    Number.isFinite(pedidos) && pedidos > 0 ? pedidos : PASO,
    TOPE,
  );

  const filtro = term
    ? or(
        ilike(officialDocument.title, `%${term}%`),
        ilike(officialDocument.circularNumber, `%${term}%`),
        ilike(officialDocument.seasonLabel, `%${term}%`),
      )
    : undefined;

  const [documentos, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        id: officialDocument.id,
        title: officialDocument.title,
        pdfUrl: officialDocument.pdfUrl,
        publishedAt: officialDocument.publishedAt,
        circularNumber: officialDocument.circularNumber,
        seasonLabel: officialDocument.seasonLabel,
        mentionsFees: officialDocument.mentionsFees,
      })
      .from(officialDocument)
      .where(filtro)
      .orderBy(desc(officialDocument.publishedAt))
      .limit(limite),

    db
      .select({ total: sql<number>`count(*)::int` })
      .from(officialDocument)
      .where(filtro),
  ]);

  const quedan = total - documentos.length;
  const siguiente = new URLSearchParams();
  if (term) siguiente.set('q', term);
  siguiente.set('n', String(Math.min(limite + PASO, TOPE)));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl sm:text-3xl">Normativa</h1>
          <p className="text-xs text-muted-foreground">
            <span className="cifra text-base text-foreground">{total}</span>{' '}
            {term
              ? `${total === 1 ? 'coincide' : 'coinciden'} con «${term}»`
              : 'circulares publicadas por la RFEE'}
          </p>
        </header>

        {/*
          La búsqueda es la herramienta principal de esta pantalla, así que va
          arriba del todo y es lo único que hay: un buscador y una lista. Al
          enviar se pierde el parámetro `n` a propósito —una búsqueda nueva
          empieza por las 30 primeras—, y por eso no está en el formulario.
        */}
        <form method="get" className="flex max-w-xl items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
            <Input
              name="q"
              defaultValue={term}
              placeholder="Buscar circular, título o temporada"
              type="search"
              aria-label="Buscar en la normativa"
              className="h-11 pl-8 sm:h-9"
            />
          </div>
          <button type="submit" className="sr-only">
            Buscar
          </button>
          {term ? (
            <Button variant="ghost" size="sm" asChild className="h-11 sm:h-9">
              <Link href="/documentos">
                <X aria-hidden />
                Quitar
              </Link>
            </Button>
          ) : null}
        </form>
      </div>

      {documentos.length === 0 ? (
        <div className="flex flex-col items-start gap-1 border-t py-10">
          <FileText className="size-5 text-muted-foreground" aria-hidden />
          <p className="mt-1 text-sm font-medium">
            {term ? 'Ninguna circular coincide' : 'Todavía no hay circulares'}
          </p>
          <p className="medida text-xs text-muted-foreground">
            {term
              ? 'Solo se indexa lo que la RFEE publica en esgrima.es. Prueba con el número de circular o con la temporada.'
              : 'Se cargan una vez al día desde esgrima.es. Pide a un administrador que lance la carga.'}
          </p>
          {term ? (
            <Button variant="outline" size="sm" asChild className="mt-3">
              <Link href="/documentos">Ver todas las circulares</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-card">
          {documentos.map((d) => {
            const [numero, anio] = d.circularNumber
              ? partirCircular(d.circularNumber)
              : [null, null];

            return (
              <li key={d.id}>
                <a
                  href={d.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="group grid grid-cols-[2rem_minmax(0,1fr)_1rem] items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 sm:grid-cols-[2rem_minmax(0,1fr)_9rem_1rem] sm:items-center"
                >
                  {/*
                    El número de circular es por lo que se pregunta: "mírate la
                    12". Va delante y en grande. Cuando el fichero no lo trae no
                    se inventa: se pone el icono de documento y ya.
                  */}
                  <span className="w-8 shrink-0 pt-0.5 text-center">
                    {numero ? (
                      <>
                        <span className="cifra block text-lg text-foreground">
                          {numero}
                        </span>
                        {anio ? (
                          <span className="block text-[11px] text-muted-foreground/70">
                            {anio}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <FileText
                        className="mx-auto size-4 text-muted-foreground/70"
                        aria-label="Sin número de circular"
                      />
                    )}
                  </span>

                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm font-medium sm:truncate">
                      {titular(d.title)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                      {/* En el móvil la fecha va aquí; donde hay sitio se va a
                          su columna y el título se queda en una línea. */}
                      <span className="text-muted-foreground sm:hidden">
                        {formatDateEs(d.publishedAt)}
                      </span>
                      {/*
                        Aviso de que la circular toca dinero o plazos. Solo
                        texto: se probó también con un filete de color a la
                        izquierda de la fila y salía en cuatro de cada cinco
                        circulares, o sea que no distinguía nada y dejaba la
                        lista rayada de amarillo.
                      */}
                      {d.mentionsFees ? (
                        <span className="text-warn">toca importes o plazos</span>
                      ) : null}
                    </span>
                  </span>

                  <span className="hidden text-right sm:block">
                    <span className="block text-xs text-muted-foreground">
                      {formatDateEs(d.publishedAt)}
                    </span>
                    {d.seasonLabel ? (
                      <span className="block text-[11px] text-muted-foreground/70">
                        {d.seasonLabel}
                      </span>
                    ) : null}
                  </span>

                  <ArrowUpRight
                    className="size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground"
                    aria-hidden
                  />
                  <span className="sr-only">Abre el PDF en otra pestaña</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {quedan > 0 ? (
        <Button variant="outline" asChild className="h-11 w-full">
          <Link href={`/documentos?${siguiente.toString()}`} scroll={false}>
            Ver {Math.min(quedan, PASO)} más
          </Link>
        </Button>
      ) : null}

      <p className="medida text-xs text-muted-foreground/70">
        Los PDF se enlazan al original de esgrima.es, no se copian. Si una
        circular cambia importes, la aplicación avisa al administrador; nunca
        los cambia por su cuenta.
      </p>
    </div>
  );
}
