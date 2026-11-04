'use client';

import { ChevronDown, SearchX } from 'lucide-react';
import * as React from 'react';
import { codigoPais } from '@/components/bandera';
import { CampoBuscar } from '@/components/filtros/chips';
import { Boton } from '@/components/sistema/boton';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { PieIncremental } from '@/components/sistema/lista-incremental';
import type { InscritoFiePublico, ListaFie } from '@/lib/entries/inscritos-fie';
import { sinAcentos } from '@/lib/nombres';
import { nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { titular } from '@/lib/utils';

/**
 * «Ver todos los países»: la lista de inscritos de la FIE entera, dentro de
 * la ficha.
 *
 * La lista que se ve arriba es la que se guardó en la base y sólo tiene los
 * españoles; la FIE sí publica la completa y hasta ahora se mandaba a
 * fie.org a mirarla. Este desplegable la pide a `/api/inscritos-fie` —que la
 * lee en vivo de la misma API de la FIE— y la enseña con la misma fila de
 * persona de siempre, con un campo para buscar por nombre, equipo o país.
 *
 * Cómo se comporta:
 *
 *   · Cerrada no pide nada: abrir es la orden de leer (`onToggle`, con el
 *     `onClick` del summary de respaldo por si el evento no saltara).
 *   · Una lectura basta por despliegue: cerrar y reabrir enseña lo ya leído,
 *     no vuelve a pedir. Si falló, la próxima apertura reintenta.
 *   · El componente se monta por URL de la prueba (`key` en la ficha): al
 *     cambiar de prueba empieza de cero, como el «ver más» de la lista local.
 *
 * Lo que NO hace: ni enlazar cada fila a una ficha (un extranjero no tiene
 * ficha aquí y el nombre solo no demuestra identidad), ni marcar «tú» (el
 * emparejado por nombre sería adivinar), ni copiar la lista a la base.
 */

/** Las filas que se ven de entrada; el resto va detrás de «Ver más». */
const ASOMAN = 40;

type Estado = 'cerrada' | 'cargando' | 'ok' | 'sin_lista' | 'fallo';

/**
 * Temporada y `competitionId` de una URL de inscritos de la FIE
 * (`https://fie.org/competition/<temporada>/<competicion>/entries`). Es el
 * mismo par que pide la API de la FIE; `null` si la URL no encaja, y entonces
 * el desplegable ni se pinta: no se piden cosas inventadas.
 */
function pruebaDeUrlInscritos(url: string): { temporada: number; competicion: number } | null {
  const m = /\/competition\/(\d{4})\/(\d+)/.exec(url);
  if (!m) return null;
  return { temporada: Number(m[1]), competicion: Number(m[2]) };
}

export function InscritosFieTodos({ urlInscritos }: { urlInscritos: string }) {
  const detalles = React.useRef<HTMLDetailsElement>(null);
  const [estado, setEstado] = React.useState<Estado>('cerrada');
  const [lista, setLista] = React.useState<{ total: number; inscritos: InscritoFiePublico[] } | null>(null);
  const [consulta, setConsulta] = React.useState('');
  const [visibles, setVisibles] = React.useState(ASOMAN);
  /** Verdad mientras hay una petición en vuelo: ni toggle ni clic la duplican. */
  const enVuelo = React.useRef(false);

  const prueba = React.useMemo(() => pruebaDeUrlInscritos(urlInscritos), [urlInscritos]);

  const cargar = React.useCallback(async () => {
    if (!prueba || enVuelo.current) return;
    enVuelo.current = true;
    setEstado('cargando');
    try {
      const r = await fetch(
        `/api/inscritos-fie?temporada=${prueba.temporada}&competicion=${prueba.competicion}`,
      );
      const cuerpo = (await r.json().catch(() => null)) as ListaFie | null;
      if (r.ok && cuerpo?.estado === 'ok' && Array.isArray(cuerpo.inscritos)) {
        setLista({ total: cuerpo.total, inscritos: cuerpo.inscritos });
        setEstado('ok');
      } else if (r.ok && cuerpo?.estado === 'sin_lista') {
        setLista(null);
        setEstado('sin_lista');
      } else {
        // 401, 400, 503 o un cuerpo raro: mismo mensaje, sin inventar causas.
        setLista(null);
        setEstado('fallo');
      }
    } catch {
      setLista(null);
      setEstado('fallo');
    } finally {
      enVuelo.current = false;
    }
  }, [prueba]);

  /** Al abrir se lee una vez; con la lectura hecha, reabrir no repite la petición. */
  const alAbrir = () => {
    if (estado === 'cerrada' || estado === 'fallo') void cargar();
  };

  const filtrados = React.useMemo(() => {
    if (!lista) return [];
    const q = sinAcentos(consulta);
    if (!q) return lista.inscritos;
    return lista.inscritos.filter((i) => {
      /*
        El país se busca por las dos formas en que se sabe: el código que la
        fila enseña («FRA») y su nombre («Francia»), que es lo que se teclea.
      */
      const pais = i.pais ?? '';
      const nombreDelPais = pais ? nombrePaisFie(codigoPais(pais)) : '';
      return sinAcentos(`${i.nombre} ${i.equipo} ${pais} ${nombreDelPais}`).includes(q);
    });
  }, [lista, consulta]);

  if (!prueba) return null;

  const mostrados = filtrados.slice(0, visibles);
  const ocultos = filtrados.length - mostrados.length;

  return (
    <details
      ref={detalles}
      className="sis-details sis-details-grande group min-w-0"
      onToggle={(e) => {
        if (e.currentTarget.open) alAbrir();
      }}
    >
      {/*
        Palabras junto al icono, como siempre: qué se despliega se lee, no se
        deduce del chevron. El clic del summary también dispara la lectura por
        si `onToggle` no llegara (el panel se abre igual).
      */}
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-medium text-primary-text transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
        onClick={() => {
          if (!detalles.current?.open) alAbrir();
        }}
      >
        <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
        <span className="group-open:hidden">Ver todos los países</span>
        <span className="hidden group-open:inline">Ocultar todos los países</span>
      </summary>

      <div className="flex min-w-0 flex-col gap-3 pt-1 pb-2">
        {estado === 'cargando' ? (
          <p role="status" className="text-sm text-muted-foreground">
            Leyendo la lista de la FIE…
          </p>
        ) : null}

        {estado === 'sin_lista' ? (
          <p className="text-sm text-muted-foreground">
            La FIE todavía no ha publicado la lista de esta prueba.
          </p>
        ) : null}

        {estado === 'fallo' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p role="alert" className="text-sm text-warn">
              No se ha podido leer la lista de la FIE.
            </p>
            <Boton variante="contorno" tamano="sm" onClick={() => void cargar()}>
              Reintentar
            </Boton>
          </div>
        ) : null}

        {estado === 'ok' && lista ? (
          <>
            <p className="text-sm text-muted-foreground">
              Lista de la FIE
              {lista.total > lista.inscritos.length
                ? ` · Se muestran los ${lista.inscritos.length} primeros de ${lista.total}`
                : ''}
            </p>

            {lista.inscritos.length > 0 ? (
              <CampoBuscar
                valor={consulta}
                onCambio={(v) => {
                  setConsulta(v);
                  setVisibles(ASOMAN);
                }}
                etiqueta="Buscar en la lista de la FIE por nombre, equipo o país"
                placeholder="Buscar en la lista"
              />
            ) : null}

            {consulta ? (
              <p role="status" className="sr-only">
                {filtrados.length} {filtrados.length === 1 ? 'inscrito' : 'inscritos'}
              </p>
            ) : null}

            {filtrados.length > 0 ? (
              <ul data-slot="inscritos-fie" className="flex flex-col divide-y divide-border">
                {mostrados.map((i, n) => (
                  <li key={`${i.pais ?? ''}-${i.equipo}-${i.nombre}-${n}`}>
                    <FilaFie inscrito={i} />
                  </li>
                ))}
              </ul>
            ) : lista.inscritos.length === 0 ? (
              <p className="text-sm text-muted-foreground">La lista está vacía de momento.</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <SearchX className="size-4 shrink-0" aria-hidden />
                Nadie coincide con «{consulta.trim()}».
              </p>
            )}

            {/*
              Por lotes, sin fetch: al acercarse al pie el centinela enseña
              otra tanda; el «Ver más» queda de respaldo. Cerrado, el details
              no da caja al hueco y el observador no dispara.
            */}
            <PieIncremental
              quedan={ocultos}
              alAsomar={() => setVisibles((v) => v + ASOMAN)}
              cuenta={filtrados.length}
              detalle="de la lista de la FIE"
              className="self-start"
            />
          </>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Un inscrito de la lista de la FIE con la fila de persona de siempre:
 * bandera y nombre, y el equipo con su icono y en segunda línea cuando la
 * prueba es por equipos. Sin enlace: un extranjero no tiene ficha aquí.
 */
function FilaFie({ inscrito }: { inscrito: InscritoFiePublico }) {
  return (
    <FilaPersona
      persona={{
        nombre: nombreVisible(inscrito.nombre) || titular(inscrito.nombre),
        pais: inscrito.pais,
      }}
      equipo={Boolean(inscrito.equipo)}
      meta={inscrito.equipo ? titular(inscrito.equipo) : null}
    />
  );
}
