'use client';

import { CalendarOff } from 'lucide-react';
import * as React from 'react';
import {
  esPretemporada,
  itemsDelMes,
  nombreDeMes,
  rangoCorto,
  type Bloque,
  type ItemMes,
} from '@/lib/calendario/bloques';
import type { EventView } from '@/lib/queries/calendar';
import { cn } from '@/lib/utils';
import { DivisorHueco, TarjetaBloque } from './tarjeta-bloque';

/**
 * ===========================================================================
 * EL TIMELINE DE BLOQUES: ESCRITORIO EN COLUMNAS, MÓVIL EN UNA
 * ===========================================================================
 *
 * QUÉ SUSTITUYE Y POR QUÉ
 * ---------------------------------------------------------------------------
 * Sustituye a la rejilla de siete columnas por mes. El razonamiento es del
 * usuario y es correcto: *«como son siempre casi siempre en findes las
 * competiciones»*, así que una cuadrícula gasta 31 casillas para enseñar
 * cuatro eventos. Y hay una segunda consecuencia que se veía en cada captura
 * del trimestre: cada mes tiene cinco o seis semanas según el año, así que las
 * tres columnas **nunca** salían del mismo alto.
 *
 * Con bloques, el alto de una columna es el de sus eventos. Tres columnas con
 * 0, 3 y 2 competiciones se parecen entre sí por primera vez, y el sitio que
 * antes era agujero negro lo ocupan los divisores de semanas libres, que dicen
 * algo.
 *
 * LO QUE TIENEN EN COMÚN LAS DOS VISTAS
 * ---------------------------------------------------------------------------
 * La tarjeta (`tarjeta-bloque.tsx`) y los divisores. No hay dos maquetados
 * paralelos que haya que mantener a la vez: hay un reparto de columnas y un
 * feed, y los dos pintan las mismas piezas.
 */

type Comun = {
  inscripciones: Record<string, string>;
  resaltados: Set<string>;
  proximo: string | null;
  mostrarArma: boolean;
  mostrarGenero: boolean;
  mostrarCategoria: boolean;
  onAbrir: (e: EventView) => void;
};

/**
 * UNA COLUMNA DE MES, EN ESCRITORIO.
 *
 * Con título cuando hay más de un mes en pantalla (el trimestre) y sin él
 * cuando el mes ya está escrito en el `<h1>` de la cabecera: repetir
 * «Octubre» dos veces a 40 px de distancia es gastar un renglón en decir lo
 * mismo.
 */
export function ColumnaMes({
  anio,
  mes,
  bloques,
  conTitulo,
  ...comun
}: {
  anio: number;
  mes: number;
  bloques: Bloque[];
  conTitulo: boolean;
} & Comun) {
  const items = React.useMemo(() => itemsDelMes(bloques, anio, mes), [bloques, anio, mes]);

  return (
    <section
      aria-label={nombreDeMes(anio, mes)}
      data-mes={`${anio}-${String(mes + 1).padStart(2, '0')}`}
      data-bloques={items.filter((i) => i.tipo === 'bloque').length}
      /*
        `flex-1` para que el mes vacío se centre de verdad.

        El estado vacío lleva `flex-1 justify-center`, pero eso solo centra si
        la columna mide lo que mide la celda de la rejilla. Sin esto, la
        sección medía lo que mide su contenido —170 px— y la caja de
        «Sin competiciones oficiales» quedaba pegada arriba con 160 px de
        negro debajo, que es exactamente el agujero que se venía a quitar.
      */
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {conTitulo ? (
        <h2 className="shrink-0 pb-1.5 text-lg">{nombreDeMes(anio, mes, false)}</h2>
      ) : null}

      {items.length === 0 ? (
        <MesVacioEscritorio anio={anio} mes={mes} />
      ) : (
        <ul className="flex min-w-0 flex-col">
          {items.map((item) => (
            <ItemDeLista key={claveDeItem(item)} item={item} variante="zonas" {...comun} />
          ))}
        </ul>
      )}
    </section>
  );
}

function claveDeItem(item: ItemMes): string {
  return item.tipo === 'bloque' ? item.bloque.clave : `hueco_${item.hueco.desde}`;
}

function ItemDeLista({
  item,
  variante,
  ...comun
}: {
  item: ItemMes;
  variante: 'zonas' | 'apilada';
} & Comun) {
  if (item.tipo === 'hueco') {
    return (
      <li>
        <DivisorHueco
          texto={item.hueco.texto}
          rango={rangoCorto({ desde: item.hueco.desde, hasta: item.hueco.hasta })}
        />
      </li>
    );
  }
  return (
    <li className="pb-2">
      <TarjetaBloque bloque={item.bloque} variante={variante} {...comun} />
    </li>
  );
}

/**
 * EL MES VACÍO, CON INTENCIÓN.
 *
 * Septiembre de 2026 no tiene competiciones. En la rejilla eso era una
 * cuadrícula entera de 31 casillas vacías —una columna de 400 px de nada— y no
 * decía nada que no dijera el silencio.
 *
 * Ahora el contenido se centra en la columna, con un icono al 20 % de opacidad
 * y jerarquía de texto: el titular en semibold y la explicación debajo en
 * gris. No es un estado de error: es un mes de descanso, y decirlo así es
 * información.
 *
 * ---------------------------------------------------------------------------
 * LA SEGUNDA LÍNEA NO SE INVENTA, Y ESTE ES EL MATIZ QUE IMPORTA
 * ---------------------------------------------------------------------------
 * El brief pedía literalmente «Septiembre es mes de pretemporada y descanso».
 * Para septiembre es verdad —la temporada española arranca en octubre y
 * ninguna de las temporadas cargadas tiene competición oficial en julio,
 * agosto ni septiembre— y ahí va esa frase.
 *
 * Pero **no vale para cualquier mes vacío**, y por eso `esPretemporada()`
 * existe y está acotada. Un enero sin torneos no es pretemporada: es que el
 * filtro de arma, género o categoría se ha comido el mes. Escribir
 * «pretemporada» ahí sería inventarse una explicación oficial, que es la regla
 * número uno del proyecto. Así que fuera del verano se dice la verdad —que con
 * estos filtros no hay nada— y se ofrece la salida real, que es abrir los
 * filtros.
 */
function MesVacioEscritorio({ anio, mes }: { anio: number; mes: number }) {
  const nombre = nombreDeMes(anio, mes, false);
  return (
    <div className="flex min-h-[10rem] flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center">
      <CalendarOff className="size-8 opacity-20" aria-hidden />
      <p className="text-sm font-semibold">Sin competiciones oficiales</p>
      <p className="medida text-xs text-muted-foreground">
        {esPretemporada(mes)
          ? `${nombre} es mes de pretemporada y descanso.`
          : `No hay nada publicado en ${nombre.toLowerCase()} con los filtros puestos.`}
      </p>
    </div>
  );
}

/**
 * ===========================================================================
 * EL FEED DEL MÓVIL: UNA SOLA COLUMNA, Y SE ARREGLA UN FALLO
 * ===========================================================================
 *
 * EL FALLO QUE HABÍA, CON LAS CAPTURAS DEL USUARIO DELANTE
 * ---------------------------------------------------------------------------
 * En el móvil la vista de «1 mes» estaba **rota**: en vez del mes salía una
 * mini-rejilla comprimida de números sin barras y debajo una lista de tarjetas
 * de «próximos días». El diagnóstico es del usuario y es exacto:
 *
 *   *«la vista de 1 mes no se ve nada porque como sale la lista de
 *   competiciones de los próximos días el calendario se vuelve enano, mira qué
 *   error… debería verse como lo de 3 meses, y si quieres haciendo scroll
 *   luego lo de los próximos días»*
 *
 * La causa era estructural: la rejilla repartía el alto disponible entre sus
 * filas y la lista de «lo próximo» le quitaba 200 px, así que las cinco
 * semanas se quedaban en 30 px cada una y las barras no cabían. Con bloques el
 * problema desaparece porque **nadie reparte nada**: el feed mide lo que miden
 * sus tarjetas y se desplaza. Lo de «los próximos días» va al final, detrás
 * del calendario, que es lo que se pedía.
 *
 * CÓMO QUEDA
 * ---------------------------------------------------------------------------
 * 1. **Píldoras de mes fijas arriba** con el número de torneos: `Sep` ·
 *    `Oct · 3` · `Nov · 2`. Un mes con cero se ve de un vistazo sin
 *    desplazarse, que es justo lo que no se podía saber antes. Al tocar una,
 *    desplazamiento suave hasta su bloque.
 * 2. **Título de mes «sticky»**, que se queda arriba hasta que entra el
 *    siguiente: en un feed continuo de tres meses, sin eso se pierde el sitio.
 * 3. **Una sola columna, sin desplazamiento horizontal.** Se mide: el barrido
 *    falla si hay un píxel de desborde.
 */
export function FeedMovil({
  meses,
  bloques,
  pie,
  ...comun
}: {
  /** Los meses que se están mirando, en orden. Uno o tres. */
  meses: { anio: number; mes: number }[];
  bloques: Bloque[];
  /** Lo que va detrás del calendario: «lo próximo, fuera de este mes». */
  pie?: React.ReactNode;
} & Comun) {
  const porMes = React.useMemo(
    () => meses.map((m) => ({ ...m, items: itemsDelMes(bloques, m.anio, m.mes) })),
    [meses, bloques],
  );

  const idBase = React.useId();
  const ancla = (m: { anio: number; mes: number }) =>
    `${idBase}-${m.anio}-${m.mes}`.replace(/:/g, '');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        Las píldoras solo cuando hay más de un mes. Con un mes en pantalla
        serían una sola pastilla que no lleva a ninguna parte, y en un iPhone
        eso son 36 px de los 500 útiles.
      */}
      {porMes.length > 1 ? (
        <nav
          aria-label="Ir a un mes"
          /* `no-scrollbar`: con tres meses cabe de sobra, pero si algún día son
             seis la fila se desplaza en horizontal DENTRO de su caja, que es lo
             único que puede desplazarse a lo ancho en esta pantalla. */
          className="no-scrollbar mb-2 flex shrink-0 gap-1.5 overflow-x-auto"
        >
          {porMes.map((m) => {
            const cuantos = m.items.filter((i) => i.tipo === 'bloque').length;
            const torneos = m.items.reduce(
              (n, i) => n + (i.tipo === 'bloque' ? i.bloque.eventos.length : 0),
              0,
            );
            return (
              <button
                key={`${m.anio}-${m.mes}`}
                type="button"
                onClick={() => {
                  document
                    .getElementById(ancla(m))
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={cn(
                  'objetivo-libre flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
                  cuantos === 0
                    ? 'border-border text-muted-foreground'
                    : 'border-input bg-card text-foreground',
                )}
                aria-label={`Ir a ${nombreDeMes(m.anio, m.mes)}, ${
                  torneos === 0
                    ? 'sin competiciones'
                    : `${torneos} ${torneos === 1 ? 'torneo' : 'torneos'}`
                }`}
              >
                {nombreDeMes(m.anio, m.mes, false).slice(0, 3)}
                {torneos > 0 ? (
                  <span className="cifra text-[0.7rem] text-muted-foreground">
                    · {torneos}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {porMes.map((m) => (
          <section key={`${m.anio}-${m.mes}`} id={ancla(m)} className="scroll-mt-1">
            {/*
              El título pegajoso. `z-10` y fondo sólido: va por encima de las
              tarjetas al desplazarse y **no** lleva alfa ni desenfoque, que
              sobre el lienzo texturado dejaría pasar la retícula por detrás de
              las letras (`REFERENCIAS.md` §10).
            */}
            <h2
              className={cn(
                'sticky top-0 z-10 -mx-0.5 mb-1.5 bg-background px-0.5 py-1 text-base leading-none',
                /*
                  Con UN mes en pantalla el título sobra: el `<h1>` de la
                  cabecera ya dice «Octubre» a 30 px de aquí, y en un iPhone
                  este renglón son 28 px de los 500 útiles gastados en
                  repetirlo. Con tres meses es imprescindible, porque el feed
                  es continuo y sin él no se sabe en cuál estás.
                */
                porMes.length === 1 && 'sr-only',
              )}
            >
              {nombreDeMes(m.anio, m.mes)}
            </h2>

            {m.items.length === 0 ? (
              <MesVacioMovil anio={m.anio} mes={m.mes} />
            ) : (
              <ul className="flex min-w-0 flex-col">
                {m.items.map((item) => (
                  <ItemDeLista
                    key={claveDeItem(item)}
                    item={item}
                    variante="apilada"
                    {...comun}
                  />
                ))}
              </ul>
            )}
          </section>
        ))}

        {/* Y detrás del calendario, lo de «los próximos días»: es literalmente
            lo que pidió el usuario —«si quieres haciendo scroll luego lo de los
            próximos días»— y ya no le roba alto a nada. */}
        {pie ? <div className="pt-2">{pie}</div> : null}
      </div>
    </div>
  );
}

/**
 * El mes vacío en el móvil: una tarjeta fina, no media pantalla.
 *
 * ~70 px. En un feed de tres meses, el mes sin nada tiene que caber en un
 * renglón y dejar sitio a los que sí tienen competiciones: si ocupa lo mismo
 * que un mes lleno, hay que desplazarse por la nada para llegar a octubre, que
 * es justo lo que se está arreglando.
 */
function MesVacioMovil({ anio, mes }: { anio: number; mes: number }) {
  const nombre = nombreDeMes(anio, mes, false);
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-dashed px-3 py-3">
      <CalendarOff className="size-5 shrink-0 opacity-20" aria-hidden />
      <p className="min-w-0 text-xs">
        <span className="font-semibold">
          {esPretemporada(mes) ? `${nombre}: mes de pretemporada` : nombre}
        </span>{' '}
        <span className="text-muted-foreground">· Sin competiciones programadas.</span>
      </p>
    </div>
  );
}
