import type { RendimientoCaraACara } from '@/lib/sport/explorar/rendimiento';
import { Bloque, type Nivel } from '../piezas';
import { BalanceAcumulado, lecturaAsalto } from './balance-acumulado';
import { BarrasDivergentes } from './barras-divergentes';
import { apellidoCorto, COLOR, decimal } from './comun';
import { lecturaPrueba, PuestosComparados } from './puestos-comparados';
import { BarraDuelo, Celda, Rejilla, Subtitulo } from './piezas-graficos';

/** Cifras enfrentadas; un solo rótulo de quién es quién arriba: en cada celda, izquierda es `yo`. */
function Marcador({ datos, a, b }: { datos: RendimientoCaraACara; a: string; b: string }) {
  const { total, poule, directa, delante } = datos;
  const tpa = datos.tocadosPorAsalto;
  const duelo = (izquierda: number, derecha: number) => (
    <BarraDuelo izquierda={izquierda} derecha={derecha} colorIzquierda={COLOR.marca} colorDerecha={COLOR.apagado} />
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-3 text-sm font-semibold">
        <span className="inline-flex min-w-0 items-center gap-2 text-primary-text">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary-text" />
          <span className="truncate">{a}</span>
        </span>
        <span className="inline-flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className="truncate">{b}</span>
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-off" />
        </span>
      </div>
      <Rejilla className="grid-cols-2 lg:grid-cols-4">
        <Celda rotulo="Asaltos">{duelo(total.victorias, total.derrotas)}</Celda>
        <Celda rotulo="Delante en pruebas">{duelo(delante.yo, delante.rival)}</Celda>
        <Celda rotulo="Poule">{duelo(poule.victorias, poule.derrotas)}</Celda>
        <Celda rotulo="Directa">{duelo(directa.victorias, directa.derrotas)}</Celda>
        {tpa.yo !== null && tpa.rival !== null ? (
          <Celda rotulo="Tocados por asalto" className="col-span-2 lg:col-span-4">
            <div className="flex items-end justify-between gap-3">
              <span className="cifra text-3xl leading-none">{decimal(tpa.yo)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {total.dados}–{total.recibidos} en total
              </span>
              <span className="cifra text-3xl leading-none text-muted-foreground">{decimal(tpa.rival)}</span>
            </div>
          </Celda>
        ) : null}
      </Rejilla>
    </div>
  );
}

/**
 * Gráficas del cara a cara entre `yo` y `rival`: marcador por fase, tocados
 * por asalto, quién acaba delante en las pruebas comunes, el balance
 * acumulado asalto a asalto y el reparto por temporada. Todo visto desde
 * `yo`, que va en carmesí; el rival, en blanco o gris.
 */
export function SeccionRendimientoCaraACara({
  datos,
  yo,
  rival,
  nivel = 'pagina',
  id = 'cara-a-cara-rendimiento',
  titulo = 'Evolución del duelo',
  tituloOculto = false,
  sinResumen = false,
}: {
  datos: RendimientoCaraACara;
  /** Nombres publicados; se rotula con el primer apellido. */
  yo: { nombre: string };
  rival: { nombre: string };
  nivel?: Nivel;
  id?: string;
  titulo?: string;
  tituloOculto?: boolean;
  /** La página ya pinta sus cifras del duelo encima: se omite el marcador y quedan sólo las gráficas. */
  sinResumen?: boolean;
}) {
  const { total, asaltos, pruebas, delante, porTemporada } = datos;
  if (total.asaltos === 0 && pruebas.length === 0) return null;
  const a = apellidoCorto(yo.nombre);
  const b = apellidoCorto(rival.nombre);
  const ultimo = asaltos.at(-1);
  const ultimaPrueba = pruebas.at(-1);
  const conAsaltos = porTemporada.filter((t) => t.asaltos.asaltos > 0);
  const conPruebas = porTemporada.filter((t) => t.delanteYo + t.delanteRival > 0);
  return (
    <Bloque id={id} titulo={titulo} nivel={nivel} tituloOculto={tituloOculto}>
      <div className="flex min-w-0 flex-col gap-6">
        {sinResumen ? null : <Marcador datos={datos} a={a} b={b} />}

        {asaltos.length > 0 ? (
          <section className="flex min-w-0 flex-col gap-2">
            <Subtitulo nivel={nivel}>Balance</Subtitulo>
            <BalanceAcumulado
              asaltos={asaltos}
              yo={a}
              rival={b}
              titulo={`Balance acumulado de ${a} contra ${b}: ${total.victorias} victorias y ${total.derrotas} derrotas`}
              inicial={ultimo ? `Último: ${lecturaAsalto(ultimo)}` : null}
            />
          </section>
        ) : null}

        {pruebas.length > 0 ? (
          <section className="flex min-w-0 flex-col gap-2">
            <Subtitulo nivel={nivel}>Puestos</Subtitulo>
            <PuestosComparados
              pruebas={pruebas}
              yo={a}
              rival={b}
              titulo={`Puestos en ${pruebas.length} pruebas comunes: ${a} delante en ${delante.yo}, ${b} en ${delante.rival}`}
              inicial={ultimaPrueba ? `Última: ${lecturaPrueba(ultimaPrueba, a, b)}` : null}
            />
          </section>
        ) : null}

        {conAsaltos.length > 1 || conPruebas.length > 1 ? (
          <section className="flex min-w-0 flex-col gap-2">
            <Subtitulo nivel={nivel}>Por temporada</Subtitulo>
            <Rejilla className={conAsaltos.length > 1 && conPruebas.length > 1 ? 'sm:grid-cols-2' : undefined}>
              {conPruebas.length > 1 ? (
                <Celda rotulo="Delante en pruebas">
                  <BarrasDivergentes
                    titulo="Pruebas comunes por temporada en las que acabó delante cada una"
                    columnas={conPruebas.map((t) => ({
                      etiqueta: t.corta,
                      arriba: t.delanteYo,
                      abajo: t.delanteRival,
                      lectura: `${t.temporada}: ${a} ${t.delanteYo}, ${b} ${t.delanteRival}`,
                    }))}
                    arriba={{ nombre: a, color: COLOR.marca }}
                    abajo={{ nombre: b, color: COLOR.apagado }}
                  />
                </Celda>
              ) : null}
              {conAsaltos.length > 1 ? (
                <Celda rotulo="Asaltos">
                  <BarrasDivergentes
                    titulo="Asaltos ganados y perdidos por temporada"
                    columnas={conAsaltos.map((t) => ({
                      etiqueta: t.corta,
                      arriba: t.asaltos.victorias,
                      abajo: t.asaltos.derrotas,
                      lectura: `${t.temporada}: ${t.asaltos.victorias}–${t.asaltos.derrotas}, ${t.asaltos.dados}–${t.asaltos.recibidos} en tocados`,
                    }))}
                    arriba={{ nombre: a, color: COLOR.victoria }}
                    abajo={{ nombre: b, color: COLOR.derrota }}
                  />
                </Celda>
              ) : null}
            </Rejilla>
          </section>
        ) : null}
      </div>
    </Bloque>
  );
}
