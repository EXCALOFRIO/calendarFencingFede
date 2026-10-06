'use client';

import { ExternalLink, ScanText } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { DatoExtraidoView } from '@/lib/queries/calendar';
import { cn, titularDocumento } from '@/lib/utils';

/**
 * ===========================================================================
 * LO QUE DICE LA CONVOCATORIA
 * ===========================================================================
 *
 * El calendario de la RFEE y el de la FIE publican muy poco: de 274 eventos,
 * 246 no traen pabellón; de 484 pruebas, 23 traen hora de inicio y NINGUNA
 * trae cuota. El PDF de la convocatoria sí lo dice, y ya está leído —hay 98
 * datos extraídos repartidos en 9 fichas—. Lo que faltaba era enseñarlo.
 *
 * QUÉ FORMA SE LE DA, Y POR QUÉ NO ES UNA LISTA DE «CAMPOS EXTRAÍDOS»
 * ------------------------------------------------------------------
 * Una tabla de `campo → valor` es el PDF otra vez, con otra tipografía. Así
 * que cada dato leído va **en el hueco que le toca**: el pabellón donde está
 * el pabellón, las horas en la línea del día, el importe donde está la cuota.
 * Quien abre la ficha no tiene que saber que existe una extracción: ve el
 * dato, y ve que ese dato viene de un papel.
 *
 * TRES REGLAS QUE NO SON ESTÉTICAS
 * --------------------------------
 *  1. `pisadoPorPublicado` → **manda el publicado**. El valor extraído no se
 *     pinta como el bueno; si además dice otra cosa, se puede decir («la
 *     convocatoria dice…»), porque eso es información.
 *  2. `estado: 'sin_revisar'` → nadie lo ha comprobado. Va en gris, con la
 *     marca de documento leído delante, y dicho con palabras.
 *  3. La **cita viaja siempre y tiene que poder verse**. Un dato sacado de un
 *     PDF sin la frase de la que sale no se puede comprobar, y entonces no
 *     vale nada.
 *
 * CÓMO SE ENSEÑA LA CITA SIN ENSUCIAR
 * -----------------------------------
 * El **dato es el disparador**. No hay iconos de interrogación, ni un botón
 * «ver origen» al lado de cada línea: se toca el propio valor y sale la frase
 * literal del PDF con el enlace al documento. Así el adorno es cero y el
 * objetivo táctil es la fila entera, que en un móvil es lo que hay que tocar.
 *
 * Se usa `Popover` y no `HoverCard` a propósito: en un teléfono no existe el
 * `hover`, y esto se mira en un teléfono.
 */

/** Marca de «esto lo leyó la máquina de un PDF». Es forma, no solo color. */
export function MarcaConvocatoria({ className }: { className?: string }) {
  return (
    <ScanText
      className={cn('inline-block size-[0.9em] shrink-0 align-[-0.1em]', className)}
      aria-hidden
    />
  );
}

/**
 * Envuelve un valor leído de un PDF y lo hace tocable para ver su cita.
 *
 * `children` es el valor ya maquetado: esta función no decide su tamaño ni su
 * color, solo lo convierte en disparador. Cuando `dato` es `null` devuelve el
 * contenido tal cual, para que quien la use no tenga que ramificar.
 */
export function CitaConvocatoria({
  dato,
  children,
  className,
}: {
  dato: DatoExtraidoView | null;
  children: React.ReactNode;
  className?: string;
}) {
  if (!dato) return <>{children}</>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${dato.etiqueta}: ver la frase de la convocatoria de la que sale`}
          className={cn(
            'group/cita -mx-2 block min-w-0 rounded-md px-2 text-left transition-colors',
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] p-0"
      >
        <div className="flex flex-col gap-2.5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{dato.etiqueta}</span>
            <Badge variant={dato.estado === 'aprobado' ? 'secondary' : 'outline'}>
              {dato.estado === 'aprobado' ? 'Revisado' : 'Sin verificar'}
            </Badge>
          </div>

          {/*
            La frase, literal y entre comillas, con un filete a la izquierda.
            No se recorta ni se retoca —ni siquiera las mayúsculas— porque es
            la prueba de que el dato existe, y una prueba retocada no prueba
            nada. Se conservan los saltos de línea del PDF: en una dirección,
            son la dirección.
          */}
          <blockquote className="border-l-2 border-primary/50 pl-2.5 text-sm leading-snug whitespace-pre-line">
            «{dato.cita.trim()}»
          </blockquote>

          {/*
            Ni párrafo para «sin revisar» ni para «comprobado por una persona»:
            lo dice la pastilla de arriba, y la cita con el botón del PDF es lo
            que sirve para comprobarlo (`UI.md`, 2 bis).
          */}
          <Button variant="outline" size="sm" className="max-w-full self-start rounded-full" asChild>
            <a
              href={dato.documento.url}
              target="_blank"
              rel="noreferrer"
              title={dato.documento.titulo ? titularDocumento(dato.documento.titulo) : undefined}
            >
              <ExternalLink />
              PDF
            </a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Elegir qué dato extraído ocupa cada hueco
// ---------------------------------------------------------------------------

/**
 * ¿Este dato puede ocupar el hueco principal de su campo?
 *
 * Dos filtros, los dos con un falso positivo real detrás:
 *
 *  · **Importes sin moneda en la cita.** El modelo sacó
 *    `fee_eur.equipos = 2,00 €` de la frase «un máximo de 2 equipos por
 *    arma». La cifra es correcta y el campo es un disparate. Si la frase de
 *    la que sale no menciona euros, no se enseña como precio.
 *  · **Pabellón que es la ciudad.** «Pabellón: Madrid» no es un pabellón; es
 *    lo que queda cuando la circular no lo dice. Un botón que promete el
 *    pabellón y abre el centro de una ciudad es peor que no tener botón.
 *
 * Lo descartado **no se esconde**: sigue en «Otros datos de la convocatoria»,
 * con su cita. Lo que no hace es ocupar el sitio del dato bueno.
 */
export function creible(dato: DatoExtraidoView, ciudad: string | null): boolean {
  /*
    La moneda, también como código ISO: las convocatorias de la FIE escriben
    «Individual entry: 80 EUR» y «Individual competition: EUR 80», sin el
    símbolo y sin la palabra. Pidiendo solo «€» o «euro» se tiraba la cuota
    buena —leída, atribuida y con su cita— y la ficha decía «cuota no
    publicada» en las Copas del Mundo. Medido en las convocatorias ya leídas:
    de siete citas de cuota de la FIE, cuatro lo escriben así.
  */
  if (dato.campo.startsWith('fee_eur') && !/€|\beur\b|euros?/i.test(dato.cita)) {
    return false;
  }
  if (dato.campo === 'venue' && ciudad && aplanado(dato.valor) === aplanado(ciudad)) {
    return false;
  }
  return true;
}

function aplanado(v: string) {
  return v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * El dato leído que ocupa un hueco, o `null` si no hay ninguno utilizable.
 *
 * `campo` casa por prefijo porque los horarios llevan sufijo de día y de
 * prueba (`start_time.2026-10-04.florete-masculino`), pero **el campo exacto
 * gana**: `fee_eur` es la cuota y `fee_eur.alojamiento` es otra cosa, y sin
 * este orden el hotel se colaba en el hueco de la inscripción.
 *
 * Si el mismo campo viene varias veces —dos documentos que dicen cosas
 * distintas— gana lo revisado por una persona; a igualdad, el primero, y los
 * demás siguen visibles en el desplegable del final. Aquí no se promedia ni
 * se elige «el más probable»: eso sería inventar.
 */
export function huecoDe(
  datos: DatoExtraidoView[],
  campo: string,
  ciudad: string | null = null,
): DatoExtraidoView | null {
  const candidatos = datos
    .filter(
      (d) =>
        (d.campo === campo || d.campo.startsWith(`${campo}.`)) &&
        !d.pisadoPorPublicado &&
        creible(d, ciudad),
    )
    .sort((a, b) => {
      const exacto = Number(b.campo === campo) - Number(a.campo === campo);
      if (exacto !== 0) return exacto;
      return Number(b.estado === 'aprobado') - Number(a.estado === 'aprobado');
    });
  return candidatos[0] ?? null;
}

/**
 * Los importes que NO son la cuota de inscripción: alojamiento, extranjeras,
 * media pensión. Llevan su concepto en la clave (`fee_eur.alojamiento`), y ese
 * concepto es justo lo que hace falta para que la cifra signifique algo.
 */
export function importesExtra(datos: DatoExtraidoView[]): DatoExtraidoView[] {
  return datos.filter(
    (d) =>
      d.campo.startsWith('fee_eur.') && !d.pisadoPorPublicado && creible(d, null),
  );
}

/** Lo que la convocatoria dice de un plazo, que nunca sustituye al oficial. */
export function plazosDeConvocatoria(
  datos: DatoExtraidoView[],
): DatoExtraidoView[] {
  return datos.filter((d) => d.campo.startsWith('deadline.'));
}

/**
 * Lo que la convocatoria dice de un campo QUE YA PUBLICA la fuente.
 *
 * Solo interesa cuando dice algo **distinto**: si coincide, repetirlo es
 * ruido. Cuando difiere no se cambia el valor —manda el publicado— pero se
 * puede decir, y decirlo es información: alguien tiene que enterarse de que
 * el papel y el calendario no cuadran.
 */
export function contradiccion(
  datos: DatoExtraidoView[],
  campo: string,
  publicado: string | null,
): DatoExtraidoView | null {
  if (!publicado) return null;
  return (
    datos.find(
      (d) =>
        (d.campo === campo || d.campo.startsWith(`${campo}.`)) &&
        d.pisadoPorPublicado &&
        aplanado(d.valor) !== aplanado(publicado),
    ) ?? null
  );
}

/**
 * Los enlaces de la convocatoria que MERECEN un botón.
 *
 * Y no son todos, que es lo que se vio al mirar la captura: en la ficha del
 * TNR M17 de Alcobendas salían cinco filas iguales —`esgrimaalcobendas.org`,
 * `engarde-service.com`, `g.co`, `crtm.es`, `uvehoteles.com`— con el mismo
 * peso que la convocatoria oficial. Cinco botones al mismo nivel para un
 * acortador de Google Maps y la web del transporte de Madrid: eso es la lista
 * de campos extraídos que había que evitar, con otro aspecto.
 *
 * El criterio sale de la propia clave. Cuando la extracción **sabe qué es** el
 * enlace, la clave tiene un solo tramo (`link.web`, `link.inscripcion`,
 * `link.alojamiento`). Cuando solo ha visto una URL suelta en el texto, le
 * cuelga el dominio como sufijo (`link.web.https-g-co-kgs-8nfl7gj`): eso es
 * «he encontrado una dirección y no sé de qué es», y no da para un botón.
 *
 * Lo demás no se pierde: sigue en el desplegable con su cita, que es donde se
 * puede juzgar si vale algo.
 */
export function enlacesDeConvocatoria(
  datos: DatoExtraidoView[],
): DatoExtraidoView[] {
  const vistos = new Set<string>();
  const salida: DatoExtraidoView[] = [];
  for (const d of datos) {
    if (!d.campo.startsWith('link.')) continue;
    if (d.campo.split('.').length !== 2) continue;
    const destino = d.valor.replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (vistos.has(destino)) continue;
    vistos.add(destino);
    salida.push(d);
  }
  return salida;
}

/** Cómo se llama en pantalla un enlace de la convocatoria. */
const NOMBRE_ENLACE: Record<string, string> = {
  'link.web': 'Web del organizador',
  'link.inscripcion': 'Inscripción',
  'link.alojamiento': 'Alojamiento',
  'link.resultados': 'Resultados',
  'link.reglamento': 'Reglamento',
};

export function nombreDeEnlace(d: DatoExtraidoView): string {
  return NOMBRE_ENLACE[d.campo] ?? dominioDe(d.valor);
}

/** Nombre corto del destino de un enlace, para ponerlo en un botón. */
export function dominioDe(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(
      /^www\./,
      '',
    );
  } catch {
    return url;
  }
}

/**
 * ¿Este campo habla de dinero o de árbitros?
 *
 * Es el filtro que quita de la tarjeta la cuota de inscripción, la de equipos,
 * las de cadete y júnior, la multa por árbitro que falte y los tramos de
 * árbitros obligatorios. Petición literal del usuario sobre la ficha de Lima:
 * *«lo del precio porfa quítalo que no lo quiero mostrar, lo de la inscripción
 * y lo de los equipos cuánto cuesta, ni el árbitro; lo de cuotas ocúltalo de
 * las tarjetas»*.
 *
 * Está en un solo sitio porque hay dos que lo necesitan —el hueco de la cuota y
 * la lista de frases del PDF— y porque lo que se oculta tiene que ser
 * exactamente lo mismo en los dos: media ocultación es peor que ninguna, deja
 * el importe asomando por el sitio que nadie revisó.
 *
 * **No se deja de extraer.** Los importes se siguen leyendo, se guardan con su
 * cita y se ven en Gestión › Extracción, que es donde los mira quien tramita.
 */
export function esImporte(campo: string): boolean {
  return (
    campo === 'fee_eur' ||
    campo.startsWith('fee_eur.') ||
    campo === 'fee_concept' ||
    campo.startsWith('fee_concept.') ||
    campo === 'referee_fine_eur' ||
    campo.startsWith('referee_quota.')
  );
}
