import { TIPOS_COMPETICION } from '@/lib/sport/explorar/tipo-competicion';
import type {
  AmbitoCompeticion,
  EstadisticasPorAmbito,
  ResumenCompeticiones,
  TipoCompeticion,
  TonoTipo,
} from '@/lib/sport/explorar/tipos-social';
import { cn } from '@/lib/utils';
import { EtiquetaCategoria, EtiquetaTipoCompeticion } from '../etiqueta-competicion';
import { Aclaracion, Bloque, Nota, type Nivel } from '../piezas';
import { Cifra, Metrica, SinDato } from './piezas-perfil';

type Clave = 'total' | AmbitoCompeticion;

const OPCIONES: { clave: Clave; rotulo: string; vacio: string }[] = [
  { clave: 'total', rotulo: 'Total', vacio: 'Sin competiciones importadas.' },
  { clave: 'internacional', rotulo: 'Internacional', vacio: 'Sin competiciones internacionales importadas.' },
  { clave: 'nacional', rotulo: 'Nacional', vacio: 'Sin competiciones nacionales importadas.' },
];

/**
 * Los selectores van escritos enteros (Tailwind no genera clases montadas en
 * tiempo de ejecución). El cambio de panel es sólo CSS: un grupo de radios y
 * `:has(:checked)`, así funciona sin JavaScript y con el teclado de siempre.
 */
const PANEL: Record<Clave, string> = {
  total: 'group-has-[#ficha-ambito-total:checked]/ambito:flex',
  internacional: 'group-has-[#ficha-ambito-internacional:checked]/ambito:flex',
  nacional: 'group-has-[#ficha-ambito-nacional:checked]/ambito:flex',
};

const pct = (p: number | null) => (p === null ? null : Math.round(p * 100));
const conSigno = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

function Cifras({ r }: { r: ResumenCompeticiones }) {
  const p = pct(r.porcentajeVictorias);
  const sinAsaltos = r.asaltos === 0;
  return (
    <dl className="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-3 lg:grid-cols-6">
      <Metrica etiqueta="Competiciones">
        <Cifra>{r.competiciones}</Cifra>
      </Metrica>
      <Metrica etiqueta="Medallas">
        <Cifra>{r.medallas}</Cifra>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Oro <strong className="cifra text-base text-foreground">{r.oros}</strong></span>
          <span>Plata <strong className="cifra text-base text-foreground">{r.platas}</strong></span>
          <span>Bronce <strong className="cifra text-base text-foreground">{r.bronces}</strong></span>
        </span>
      </Metrica>
      <Metrica etiqueta="Finales (entre los 8 primeros)">
        <Cifra>{r.finales}</Cifra>
      </Metrica>
      <Metrica etiqueta="Mejor puesto">
        {r.mejorPuesto !== null ? <Cifra>{r.mejorPuesto}º</Cifra> : <SinDato>Sin dato</SinDato>}
      </Metrica>
      <Metrica
        etiqueta="Asaltos ganados"
        detalle={sinAsaltos ? undefined : `${r.victorias}–${r.derrotas} en ${r.asaltos} ${r.asaltos === 1 ? 'asalto' : 'asaltos'}`}
      >
        {sinAsaltos || p === null ? <SinDato>Sin asaltos importados</SinDato> : <Cifra>{p}<span className="text-2xl">%</span></Cifra>}
      </Metrica>
      <Metrica
        etiqueta="Índice de tocados"
        detalle={sinAsaltos ? undefined : `${r.tocadosDados} dados, ${r.tocadosRecibidos} recibidos`}
      >
        {sinAsaltos ? <SinDato>Sin asaltos importados</SinDato> : <Cifra>{conSigno(r.indiceTocados)}</Cifra>}
      </Metrica>
    </dl>
  );
}

function Celda({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="order-2 text-[0.6875rem] leading-tight break-words text-muted-foreground">{etiqueta}</dt>
      <dd className="order-1 cifra text-2xl leading-none">{children}</dd>
    </div>
  );
}

function FilaDesglose({ rotulo, r }: { rotulo: React.ReactNode; r: ResumenCompeticiones }) {
  const p = pct(r.porcentajeVictorias);
  return (
    <li className="grid min-w-0 grid-cols-4 items-center gap-x-3 gap-y-3 bg-card px-4 py-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] sm:px-5">
      <div className="col-span-4 min-w-0 sm:col-span-1">{rotulo}</div>
      <dl className="col-span-4 grid grid-cols-4 gap-x-3 sm:contents">
        <Celda etiqueta={r.competiciones === 1 ? 'prueba' : 'pruebas'}>{r.competiciones}</Celda>
        <Celda etiqueta={r.medallas === 1 ? 'medalla' : 'medallas'}>{r.medallas}</Celda>
        <Celda etiqueta={r.finales === 1 ? 'final' : 'finales'}>{r.finales}</Celda>
        <Celda etiqueta="asaltos ganados">{p === null ? <span className="text-muted-foreground">—</span> : `${p}%`}</Celda>
      </dl>
    </li>
  );
}

function Desglose({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{titulo}</p>
      <ul className="grid min-w-0 gap-px border-y bg-border" aria-label={titulo}>
        {children}
      </ul>
    </div>
  );
}

function Panel({
  clave,
  vacio,
  r,
  categorias,
  tipos,
}: {
  clave: Clave;
  vacio: string;
  r: ResumenCompeticiones;
  categorias: ResumenCompeticiones[];
  tipos: (ResumenCompeticiones & { tono: TonoTipo })[];
}) {
  return (
    <div
      data-ambito={clave}
      className={cn('hidden min-w-0 flex-col gap-5', PANEL[clave])}
    >
      {r.competiciones === 0 ? (
        <p role="status" className="medida text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <>
          <Cifras r={r} />
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            {tipos.length > 0 ? (
              <Desglose titulo="Por tipo de competición">
                {tipos.map((t) => (
                  <FilaDesglose
                    key={t.clave}
                    r={t}
                    rotulo={<EtiquetaTipoCompeticion larga clasificacion={{ tipo: t.clave as TipoCompeticion, etiqueta: t.etiqueta, corta: t.etiqueta, tono: t.tono }} />}
                  />
                ))}
              </Desglose>
            ) : null}
            {categorias.length > 0 ? (
              <Desglose titulo="Por categoría">
                {categorias.map((c) => <FilaDesglose key={c.clave} r={c} rotulo={<EtiquetaCategoria codigo={c.clave} />} />)}
              </Desglose>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Internacional frente a nacional, con desglose por categoría y por tipo de
 * competición. El tipo es una lectura del nombre y del calendario, no un dato
 * oficial; la aclaración lo dice.
 */
export function AmbitoPerfil({ ambito, nivel }: { ambito: EstadisticasPorAmbito; nivel: Nivel }) {
  if (ambito.total.competiciones === 0) return null;
  const resumen: Record<Clave, ResumenCompeticiones> = {
    total: ambito.total,
    internacional: ambito.internacional,
    nacional: ambito.nacional,
  };
  const categorias: Record<Clave, ResumenCompeticiones[]> = {
    total: ambito.porCategoria,
    internacional: ambito.internacional.porCategoria,
    nacional: ambito.nacional.porCategoria,
  };
  const tiposDe = (clave: Clave) => clave === 'total'
    ? ambito.porTipo
    : ambito.porTipo.filter((t) => TIPOS_COMPETICION[t.clave as TipoCompeticion]?.ambito === clave);
  return (
    <Bloque id="ficha-ambito" titulo="Internacional y nacional" nivel={nivel}>
      <div className="group/ambito flex min-w-0 flex-col gap-4">
        <fieldset className="min-w-0">
          <legend className="sr-only">Qué competiciones contar</legend>
          {/* En móvil, tres columnas iguales: con cifras de tres dígitos los rótulos no caben en una fila libre. */}
          <div className="grid w-full grid-cols-3 gap-1 rounded-full border bg-card p-1 sm:inline-flex sm:w-auto sm:max-w-full">
            {OPCIONES.map((o) => (
              <label
                key={o.clave}
                className={cn(
                  'relative inline-flex min-h-11 min-w-0 cursor-pointer flex-wrap items-center justify-center gap-x-1.5 rounded-full px-2 text-center text-sm leading-tight text-muted-foreground sm:px-4',
                  'hover:text-foreground has-[:checked]:bg-marcado has-[:checked]:font-semibold has-[:checked]:text-primary-text',
                  'has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                )}
              >
                <input
                  type="radio"
                  name="ficha-ambito"
                  value={o.clave}
                  id={`ficha-ambito-${o.clave}`}
                  defaultChecked={o.clave === 'total'}
                  className="sr-only"
                />
                {o.rotulo}
                <span className="cifra text-base leading-none">{resumen[o.clave].competiciones}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {OPCIONES.map((o) => (
          <Panel
            key={o.clave}
            clave={o.clave}
            vacio={o.vacio}
            r={resumen[o.clave]}
            categorias={categorias[o.clave]}
            tipos={tiposDe(o.clave)}
          />
        ))}
      </div>
      {ambito.truncado ? (
        <Nota>Tiene más pruebas de las que se leen de una vez: estas cifras son parciales.</Nota>
      ) : null}
      <Aclaracion titulo="Cómo se clasifica cada competición">
        <Nota>
          Internacional es lo que publica la FIE o se celebra fuera de España; nacional, lo de la RFEE y
          las federaciones autonómicas. El tipo (Copa del Mundo, TNR, Campeonato de España…) sale del
          calendario cuando lo documenta y, si no, del nombre del torneo: es una ayuda de lectura, no un
          dato oficial. Las medallas cuentan los puestos 1, 2 y 3 publicados.
        </Nota>
      </Aclaracion>
    </Bloque>
  );
}
