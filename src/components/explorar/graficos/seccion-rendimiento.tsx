import type {
  AmbitoRendimiento,
  Rendimiento,
  TemporadaRendimiento,
  VistaRendimiento,
} from '@/lib/sport/explorar/rendimiento';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { cn } from '@/lib/utils';
import { Bloque, type Nivel } from '../piezas';
import { Paneles } from '../perfil/paneles';
import { BarrasApiladas } from './barras-apiladas';
import { BarrasTipo, type FilaDesglose } from './barras-tipo';
import { COLOR, COLOR_AMBITO, conSigno, decimal, FUERA_DE_PANTALLA, MEDALLAS, pct, top } from './comun';
import { lecturaPuesto } from './dispersion-puestos';
import { Donut } from './donut';
import {
  fraseAsaltos,
  fraseCompeticiones,
  fraseMedallas,
  fraseMejorGrupo,
  frasePuestoRelativo,
  fraseTocados,
  temporadaDeReferencia,
} from './frases';
import { LineaTemporal } from './linea-temporal';
import { MiniSparkline } from './mini-sparkline';
import { BarraDuelo, Celda, Frases, Rejilla, Subtitulo } from './piezas-graficos';
import { contarTramos, frasesTramos, TramosPuestos } from './tramos-puestos';

const OPCIONES: { clave: AmbitoRendimiento; rotulo: string }[] = [
  { clave: 'todo', rotulo: 'Todo' },
  { clave: 'internacional', rotulo: 'Internacional' },
  { clave: 'nacional', rotulo: 'Nacional' },
];

const porAsalto = (tocados: number, asaltos: number) => (asaltos > 0 ? tocados / asaltos : null);
const capital = (s: string) => s.charAt(0).toLocaleUpperCase('es') + s.slice(1).toLocaleLowerCase('es');

function lecturaTemporada(t: TemporadaRendimiento, texto: string) {
  return `${t.temporada}: ${texto}`;
}

/**
 * Temporada de la cifra grande: la última con al menos tres competiciones,
 * para que una temporada recién empezada (una prueba) no la decida; si no hay
 * ninguna así, la última con alguna.
 */
const ultimaConDatos = temporadaDeReferencia;

const nCompeticiones = (n: number) => `${n} ${n === 1 ? 'competición' : 'competiciones'}`;

function Cifras({ v }: { v: VistaRendimiento }) {
  const { asaltos, poule, directa } = v.total;
  const dados = porAsalto(asaltos.dados, asaltos.asaltos);
  const recibidos = porAsalto(asaltos.recibidos, asaltos.asaltos);
  const ts = v.porTemporada;
  return (
    <Rejilla className="grid-cols-2 lg:grid-cols-4">
      <div className="row-span-2 flex items-center justify-center bg-card px-3 py-4 lg:row-span-1">
        <Donut
          valor={asaltos.porcentaje}
          rotulo="Asaltos ganados"
          detalle={asaltos.asaltos > 0 ? `${asaltos.victorias}–${asaltos.derrotas}` : null}
          tamano={104}
        />
      </div>
      <Celda rotulo="Poule" cifra={pct(poule.porcentaje) ?? '–'} unidad={poule.porcentaje === null ? undefined : '%'}>
        <MiniSparkline
          titulo="Poule por temporada"
          valores={ts.map((t) => t.poule.porcentaje)}
          min={0}
          max={1}
          color={COLOR.marca}
        />
        <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          Directa
          <strong className="cifra text-xl font-semibold text-foreground">
            {pct(directa.porcentaje) ?? '–'}
            {directa.porcentaje === null ? null : <span className="text-xs">%</span>}
          </strong>
        </span>
      </Celda>
      <Celda
        rotulo="Tocados por asalto"
        cifra={dados !== null && recibidos !== null ? conSigno(dados - recibidos, decimal(Math.abs(dados - recibidos))) : '–'}
      >
        {dados !== null && recibidos !== null ? (
          <BarraDuelo
            izquierda={dados}
            derecha={recibidos}
            formato={decimal}
            tamano="text-2xl"
            colorIzquierda={COLOR.marca}
            colorDerecha={COLOR.apagado}
          />
        ) : null}
        <span className="flex justify-between gap-2 text-xs leading-none text-muted-foreground">
          <span>Dados</span>
          <span>Recibidos</span>
        </span>
      </Celda>
      <Celda
        rotulo="Puesto típico"
        cifra={v.total.mediana !== null ? `${Math.round(v.total.mediana)}º` : '–'}
        className="col-span-2 lg:col-span-1"
      >
        <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          {top(v.total.percentilMediano) ?? ''}
          <span>
            Mejor <strong className="cifra text-xl font-semibold text-foreground">{v.total.mejor !== null ? `${v.total.mejor}º` : '–'}</strong>
          </span>
        </span>
        <MiniSparkline
          titulo="Puesto relativo por temporada"
          valores={ts.map((t) => t.percentilMediano)}
          escala="percentil"
          color={COLOR.texto}
        />
      </Celda>
    </Rejilla>
  );
}

function PorTemporada({ v, ambito }: { v: VistaRendimiento; ambito: AmbitoRendimiento }) {
  const ts = v.porTemporada;
  if (ts.length === 0) return null;
  const etiquetas = ts.map((t) => t.corta);
  const ultima = ultimaConDatos(ts);
  const dados = ts.map((t) => porAsalto(t.asaltos.dados, t.asaltos.asaltos));
  const recibidos = ts.map((t) => porAsalto(t.asaltos.recibidos, t.asaltos.asaltos));
  const ganados = ts.map((t) => t.asaltos.porcentaje);
  const relativo = ts.map((t) => t.percentilMediano);
  const competiciones = ambito === 'todo'
    ? [
        { clave: 'internacional', nombre: 'Internacional', color: COLOR_AMBITO.internacional },
        { clave: 'nacional', nombre: 'Nacional', color: COLOR_AMBITO.nacional },
      ]
    : [{ clave: ambito, nombre: ambito === 'internacional' ? 'Internacional' : 'Nacional', color: COLOR_AMBITO[ambito] }];
  return (
    <Rejilla className="sm:grid-cols-2">
      <Celda rotulo="Competiciones" cifra={ultima?.competiciones ?? 0} contexto={ultima?.corta}>
        <Frases frases={[fraseCompeticiones(ts)]} />
        <BarrasApiladas
          titulo={`Competiciones por temporada; ${v.total.competiciones} en total`}
          columnas={ts.map((t) => ({
            etiqueta: t.corta,
            valores: { internacional: t.internacionales, nacional: t.nacionales },
            lectura: lecturaTemporada(t, `${nCompeticiones(t.competiciones)} (${t.internacionales} int., ${t.nacionales} nac.)`),
          }))}
          series={competiciones}
          leyenda={ambito === 'todo'}
        />
      </Celda>
      <Celda rotulo="Medallas" cifra={v.total.medallas} contexto="total">
        <Frases frases={[fraseMedallas(ts, v.total)]} />
        <BarrasApiladas
          titulo={`Medallas por temporada: ${v.total.oros} oros, ${v.total.platas} platas y ${v.total.bronces} bronces`}
          columnas={ts.map((t) => ({
            etiqueta: t.corta,
            valores: { oro: t.oros, plata: t.platas, bronce: t.bronces },
            lectura: lecturaTemporada(t, `${t.oros} oro, ${t.platas} plata, ${t.bronces} bronce`),
          }))}
          series={MEDALLAS.map((m) => ({ clave: m.clave, nombre: m.nombre, color: COLOR[m.clave] }))}
        />
      </Celda>
      <Celda rotulo="Asaltos ganados" cifra={pct(ultima?.asaltos.porcentaje) ?? '–'} unidad="%" contexto={ultima?.corta}>
        <Frases frases={[fraseAsaltos(ts)]} />
        <LineaTemporal
          titulo="Porcentaje de asaltos ganados por temporada"
          etiquetas={etiquetas}
          min={0}
          max={1}
          marcas={[{ valor: 0.5, rotulo: '50%' }]}
          series={[
            {
              clave: 'ganados',
              nombre: 'Asaltos ganados',
              color: COLOR.marca,
              area: true,
              valores: ganados,
              lecturas: ts.map((t) => t.asaltos.porcentaje === null ? null
                : lecturaTemporada(t, `${pct(t.asaltos.porcentaje)}% (${t.asaltos.victorias}–${t.asaltos.derrotas})`)),
            },
          ]}
        />
      </Celda>
      <Celda rotulo="Tocados por asalto" cifra={(() => {
        const d = ultima ? porAsalto(ultima.asaltos.dados, ultima.asaltos.asaltos) : null;
        const r = ultima ? porAsalto(ultima.asaltos.recibidos, ultima.asaltos.asaltos) : null;
        return d !== null && r !== null ? conSigno(d - r, decimal(Math.abs(d - r))) : '–';
      })()} contexto={ultima?.corta}>
        <Frases frases={[fraseTocados(ts)]} />
        <LineaTemporal
          titulo="Tocados dados y recibidos por asalto en cada temporada"
          etiquetas={etiquetas}
          series={[
            {
              clave: 'dados', nombre: 'Dados', color: COLOR.marca, valores: dados,
              lecturas: ts.map((t, i) => dados[i] === null ? null : lecturaTemporada(t, `${decimal(dados[i]!)} dados, ${decimal(recibidos[i]!)} recibidos`)),
            },
            {
              clave: 'recibidos', nombre: 'Recibidos', color: COLOR.apagado, valores: recibidos, discontinua: true,
              lecturas: ts.map((t, i) => recibidos[i] === null ? null : lecturaTemporada(t, `${decimal(dados[i]!)} dados, ${decimal(recibidos[i]!)} recibidos`)),
            },
          ]}
        />
      </Celda>
      <Celda
        rotulo="Puesto relativo"
        cifra={top(ultima?.percentilMediano) ?? '–'}
        contexto={ultima?.corta}
        className="sm:col-span-2"
      >
        <Frases frases={[frasePuestoRelativo(ts, v.evolucion)]} />
        <LineaTemporal
          titulo="Puesto mediano relativo al cuadro, por temporada"
          etiquetas={etiquetas}
          escala="percentil"
          marcas={[{ valor: 0.1, rotulo: 'Top 10%' }, { valor: 0.25, rotulo: 'Top 25%' }, { valor: 0.5, rotulo: 'Top 50%' }]}
          series={[
            {
              clave: 'relativo', nombre: 'Puesto mediano', color: COLOR.texto, valores: relativo,
              lecturas: ts.map((t) => t.percentilMediano === null ? null
                : lecturaTemporada(t, `${top(t.percentilMediano)}, mediana ${Math.round(t.mediana ?? 0)}º, mejor ${t.mejor}º`)),
            },
          ]}
        />
      </Celda>
    </Rejilla>
  );
}

function Panel({ v, ambito, nivel }: { v: VistaRendimiento; ambito: AmbitoRendimiento; nivel: Nivel }) {
  if (v.total.competiciones === 0) {
    return <EstadoVacio titulo={`Sin competiciones ${ambito === 'nacional' ? 'nacionales' : 'internacionales'}`} />;
  }
  const ultimo = v.evolucion.at(-1);
  const tipos: FilaDesglose[] = v.porTipo;
  const categorias: FilaDesglose[] = v.porCategoria;
  // Casi nadie tira dos armas: una prueba suelta en otra (o mal etiquetada) no merece desglose.
  const armas: FilaDesglose[] = v.porArma.filter((a) => a.competiciones >= 3).map((a) => ({ ...a, etiqueta: capital(a.clave) }));
  return (
    <>
      <Cifras v={v} />
      {v.evolucion.length > 0 ? (
        <section className="flex min-w-0 flex-col gap-2">
          <Subtitulo nivel={nivel}>Evolución</Subtitulo>
          <Frases frases={frasesTramos(contarTramos(v.evolucion, v.porTemporada), v.porTemporada)} />
          <TramosPuestos
            puntos={v.evolucion}
            temporadas={v.porTemporada}
            inicial={ultimo ? `Última: ${lecturaPuesto(ultimo)}` : null}
          />
        </section>
      ) : null}
      <section className={cn('flex min-w-0 flex-col gap-2', FUERA_DE_PANTALLA)}>
        <Subtitulo nivel={nivel}>Por temporada</Subtitulo>
        <PorTemporada v={v} ambito={ambito} />
      </section>
      <section className={cn('flex min-w-0 flex-col gap-2', FUERA_DE_PANTALLA)}>
        <Subtitulo nivel={nivel}>Por tipo</Subtitulo>
        <Frases frases={[fraseMejorGrupo(tipos)]} />
        <BarrasTipo filas={tipos} titulo="Rendimiento por tipo de competición" />
      </section>
      {/* Con una sola categoría también sale: es la lectura que se busca (mejor puesto, poule y directa). */}
      {categorias.length > 0 ? (
        <section className={cn('flex min-w-0 flex-col gap-2', FUERA_DE_PANTALLA)}>
          <Subtitulo nivel={nivel}>Por categoría</Subtitulo>
          <Frases frases={[fraseMejorGrupo(categorias)]} />
          <BarrasTipo filas={categorias} titulo="Rendimiento por categoría" />
        </section>
      ) : null}
      {armas.length > 1 ? (
        <section className={cn('flex min-w-0 flex-col gap-2', FUERA_DE_PANTALLA)}>
          <Subtitulo nivel={nivel}>Por arma</Subtitulo>
          <Frases frases={[fraseMejorGrupo(armas)]} />
          <BarrasTipo filas={armas} titulo="Rendimiento por arma" />
        </section>
      ) : null}
    </>
  );
}

/**
 * Rendimiento del perfil: cifras, evolución de puestos, series por
 * temporada y desgloses por tipo y categoría, con un selector
 * Todo / Internacional / Nacional (`Paneles`: sólo el elegido entra en el
 * DOM). Si sólo hay uno de los dos ámbitos, el selector no se pinta.
 */
export function SeccionRendimiento({
  datos,
  nivel = 'pagina',
  id = 'ficha-rendimiento',
  titulo = 'Rendimiento',
  tituloOculto = false,
}: {
  datos: Rendimiento;
  nivel?: Nivel;
  id?: string;
  titulo?: string;
  tituloOculto?: boolean;
}) {
  const { vistas } = datos;
  if (vistas.todo.total.competiciones === 0) return null;
  const opciones = OPCIONES.filter((o) => o.clave === 'todo' || vistas[o.clave].total.competiciones > 0);
  const conSelector = opciones.length > 2;
  const visibles = conSelector ? opciones : opciones.slice(0, 1);
  return (
    <Bloque id={id} titulo={titulo} nivel={nivel} tituloOculto={tituloOculto}>
      <Paneles
        etiqueta="Qué competiciones contar"
        opciones={visibles.map((o) => ({ valor: o.clave, etiqueta: o.rotulo, cuenta: vistas[o.clave].total.competiciones }))}
        paneles={Object.fromEntries(visibles.map((o) => [
          o.clave,
          <Panel key={o.clave} v={vistas[o.clave]} ambito={conSelector ? o.clave : soloAmbito(datos)} nivel={nivel} />,
        ]))}
      />
    </Bloque>
  );
}

/** Con un solo ámbito, «todo» es ese ámbito: las barras de competiciones toman su color. */
function soloAmbito(datos: Rendimiento): AmbitoRendimiento {
  if (datos.vistas.internacional.total.competiciones === 0) return 'nacional';
  if (datos.vistas.nacional.total.competiciones === 0) return 'internacional';
  return 'todo';
}
