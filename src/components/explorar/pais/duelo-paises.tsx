import { Swords } from 'lucide-react';
import Link from 'next/link';
import { COLOR, decimal } from '@/components/explorar/graficos/comun';
import { BarraDuelo, Celda, Rejilla } from '@/components/explorar/graficos/piezas-graficos';
import { CabeceraSeccion, VerMas } from '@/components/sistema/cabecera-seccion';
import { EstadoVacio } from '@/components/sistema/estado-vacio';
import { FilaPersona } from '@/components/sistema/fila-persona';
import { AREA_TACTIL, FOCO } from '@/components/sistema/tactil';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { rondaCuadro } from '@/lib/sport/explorar/ediciones-asaltos';
import type {
  BalanceDuelo, CruceDuelo, DueloPaises, LadoCruce, Marcador, NivelDuelo, PruebaDuelo, RelevoDuelo, TiradorDuelo,
} from '@/lib/sport/explorar/pais';
import { nombrePaisFie, paisParaBandera } from '@/lib/sport/explorar/pais-codigos';
import { cifra, porcentaje } from '@/lib/sport/explorar/pais-frases';
import { rutaPais, urlDuelo, type FiltrosDuelo } from '@/lib/sport/explorar/pais-url';
import { nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { TIPOS_COMPETICION } from '@/lib/sport/explorar/tipo-competicion';
import type { TipoCompeticion } from '@/lib/sport/explorar/tipos-social';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreCompacto, nombreVisible } from '@/lib/sport/nombre-visible';
import { rotuloPrueba } from '@/lib/sport/rotulos';
import { cn } from '@/lib/utils';
import { FiltrosPais } from './filtros-pais';
import { GraficosDuelo } from './graficos-duelo';
import { Bandera, Frases, fechaCorta } from './piezas-pais';

/**
 * Cara a cara de dos selecciones (`/explorar/pais/[codigo]/contra/[otro]`),
 * todo desde el país de la ruta («nuestro»): filtros arriba, marcador,
 * cifras, evolución, fases, tipos de competición, últimos asaltos, los
 * mejores de cada lado, la bestia negra, individual frente a equipos y, al
 * final, los cruces por prueba (paginados) con los relevos por equipos.
 */
export function DueloPaisesVista({
  duelo,
  pagina,
  filtros,
  categorias,
  frases,
  desde,
  paginaFallida = false,
}: {
  /** Balance y secciones (la primera página, cacheada). */
  duelo: DueloPaises;
  /** La página de pruebas que se enseña: la del propio `duelo` o la de `desde`. */
  pagina: Pick<DueloPaises, 'pruebas' | 'siguiente'>;
  filtros: FiltrosDuelo;
  categorias: readonly string[];
  frases: readonly string[];
  desde: string;
  /** La página de `desde` no se pudo leer: se dice en la lista, sin volver a la primera. */
  paginaFallida?: boolean;
}) {
  const { codigo, rival } = duelo;
  const equipos = filtros.modalidad === 'equipos' || (duelo.individual.asaltos === 0 && duelo.equipos.asaltos > 0);
  const principal = equipos ? duelo.equipos : duelo.individual;
  const temporadas = [...duelo.temporadas].map((t) => t.temporada).reverse();
  const hayAlgo = duelo.individual.asaltos + duelo.equipos.asaltos > 0;
  const nuestro = nombrePaisFie(codigo);
  const suyo = nombrePaisFie(rival);
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <h1 className="sr-only">{nuestro} contra {suyo}</h1>
      <FiltrosPais filtros={filtros} categorias={categorias} temporadas={temporadas} url={(f) => urlDuelo(codigo, rival, f)} />

      <MarcadorDuelo codigo={codigo} rival={rival} balance={principal} unidad={equipos ? 'encuentros' : 'asaltos'} />

      {!hayAlgo ? (
        <EstadoVacio
          titulo="Sin cruces"
          descripcion="Prueba con otros filtros."
          accion={<VerMasEnlace href={urlDuelo(codigo, rival)}>Quitar filtros</VerMasEnlace>}
        />
      ) : (
        <>
          <Frases frases={frases} />
          <Cifras balance={principal} equipos={equipos} />
          <Seccion id="duelo-evolucion" titulo="Evolución">
            <GraficosDuelo temporadas={duelo.temporadas} equipos={equipos} nuestro={codigo} suyo={rival} />
          </Seccion>
          <Fases balance={principal} />
          <Niveles niveles={duelo.niveles} equipos={equipos} />
          {!equipos ? <UltimosAsaltos pruebas={duelo.pruebas} /> : null}
          {duelo.tiradores ? (
            <>
              <ListaTiradores id="duelo-nuestros" titulo={`Mejores de ${nuestro}`} contexto={`contra ${suyo}`} lista={duelo.tiradores.nuestros} pais={codigo} />
              <ListaTiradores id="duelo-suyos" titulo={`Mejores de ${suyo}`} contexto={`contra ${nuestro}`} lista={duelo.tiradores.suyos} pais={rival} />
              <ListaTiradores id="duelo-bestias" titulo="Bestia negra" contexto={`Mejor porcentaje contra ${nuestro}`} lista={duelo.tiradores.bestias} pais={rival} />
            </>
          ) : null}
          {filtros.modalidad === '' && duelo.individual.asaltos > 0 && duelo.equipos.asaltos > 0 ? (
            <IndividualEquipos individual={duelo.individual} equipos={duelo.equipos} />
          ) : null}
          <Pruebas codigo={codigo} rival={rival} pagina={pagina} filtros={filtros} desde={desde} fallida={paginaFallida} />
        </>
      )}
    </div>
  );
}

function VerMasEnlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn('inline-flex h-9 items-center justify-center rounded-full bg-secondary px-4 text-sm font-medium hover:bg-accent', AREA_TACTIL, FOCO)}
    >
      {children}
    </Link>
  );
}

function Seccion({ id, titulo, contexto, children }: { id: string; titulo: string; contexto?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <CabeceraSeccion id={id} titulo={titulo} contexto={contexto} />
      {children}
    </section>
  );
}

const pct = (m: Marcador) => porcentaje(m.victorias, m.victorias + m.derrotas);

function Duelo({ m, formato }: { m: Marcador; formato?: (v: number) => string }) {
  return (
    <BarraDuelo
      izquierda={m.victorias}
      derecha={m.derrotas}
      colorIzquierda={COLOR.marca}
      colorDerecha={COLOR.apagado}
      formato={formato ?? cifra}
      tamano="text-2xl"
    />
  );
}

function MarcadorDuelo({ codigo, rival, balance, unidad }: { codigo: string; rival: string; balance: BalanceDuelo; unidad: string }) {
  const decididos = balance.victorias + balance.derrotas;
  const parte = decididos > 0 ? (balance.victorias / decididos) * 100 : 50;
  const lado = (c: string, alinear: 'start' | 'end') => (
    <Link
      href={rutaPais(c)}
      prefetch={false}
      className={cn('flex min-h-11 min-w-0 flex-col justify-center gap-1 rounded-md', alinear === 'end' ? 'items-end text-right' : 'items-start', FOCO)}
    >
      <Bandera codigo={c} className="[&_img]:h-5 [&_img]:w-7" />
      <span className="w-full truncate text-sm font-semibold">{nombrePaisFie(c)}</span>
    </Link>
  );
  return (
    <header className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {lado(codigo, 'start')}
        <p className="flex flex-col items-center">
          <span className="cifra text-4xl tabular-nums">
            {cifra(balance.victorias)}–{cifra(balance.derrotas)}
          </span>
          <span className="text-xs text-muted-foreground">
            {cifra(balance.asaltos)} {unidad}
            {decididos > 0 ? ` · ${porcentaje(balance.victorias, decididos)}` : ''}
          </span>
        </p>
        {lado(rival, 'end')}
      </div>
      {decididos > 0 ? (
        <div
          role="img"
          aria-label={`${porcentaje(balance.victorias, decididos)} de victorias`}
          className="flex h-1.5 overflow-hidden rounded-full bg-secondary"
        >
          <span className="block h-full bg-foreground" style={{ width: `${parte}%` }} />
        </div>
      ) : null}
    </header>
  );
}

function Cifras({ balance: b, equipos }: { balance: BalanceDuelo; equipos: boolean }) {
  if (b.asaltos === 0) return null;
  const porAsalto = { victorias: b.tocadosFavor / b.asaltos, derrotas: b.tocadosContra / b.asaltos };
  return (
    <section aria-labelledby="duelo-cifras">
      <h2 id="duelo-cifras" className="sr-only">Cifras</h2>
      <Rejilla className="grid-cols-2">
        <Celda rotulo="Victorias" cifra={Math.round((b.victorias / b.asaltos) * 100)} unidad="%" />
        <Celda rotulo="Pruebas" cifra={cifra(b.pruebas)} />
        <Celda rotulo="Tocados">
          <Duelo m={{ victorias: b.tocadosFavor, derrotas: b.tocadosContra }} />
        </Celda>
        <Celda rotulo={equipos ? 'Tocados por encuentro' : 'Tocados por asalto'}>
          <Duelo m={porAsalto} formato={decimal} />
        </Celda>
      </Rejilla>
    </section>
  );
}

function Fases({ balance: b }: { balance: BalanceDuelo }) {
  const { poule, directa } = b;
  if (poule.victorias + poule.derrotas + directa.victorias + directa.derrotas === 0) return null;
  return (
    <Seccion id="duelo-fases" titulo="Por fase">
      <Rejilla className="grid-cols-2">
        <Celda rotulo={`Poule ${pct(poule)}`}><Duelo m={poule} /></Celda>
        <Celda rotulo={`Eliminación directa ${pct(directa)}`}><Duelo m={directa} /></Celda>
      </Rejilla>
    </Seccion>
  );
}

function Niveles({ niveles, equipos }: { niveles: readonly NivelDuelo[]; equipos: boolean }) {
  const con = niveles.filter((nv) => {
    const m = equipos ? nv.equipos : nv.individual;
    return m.victorias + m.derrotas > 0;
  });
  if (con.length < 2) return null;
  return (
    <Seccion id="duelo-niveles" titulo="Por competición">
      <Rejilla className="grid-cols-2">
        {con.map((nv) => {
          const m = equipos ? nv.equipos : nv.individual;
          const def = TIPOS_COMPETICION[nv.tipo as TipoCompeticion];
          return (
            <Celda key={nv.tipo} rotulo={`${def?.corta ?? nv.tipo} ${pct(m)}`}>
              <Duelo m={m} />
            </Celda>
          );
        })}
      </Rejilla>
    </Seccion>
  );
}

function IndividualEquipos({ individual, equipos }: { individual: BalanceDuelo; equipos: BalanceDuelo }) {
  return (
    <Seccion id="duelo-modalidades" titulo="Individual y equipos">
      <Rejilla className="grid-cols-2">
        <Celda rotulo={`Individual ${pct(individual)}`}><Duelo m={individual} /></Celda>
        <Celda rotulo={`Equipos ${pct(equipos)}`}><Duelo m={equipos} /></Celda>
      </Rejilla>
    </Seccion>
  );
}

const ULTIMOS = 8;

function UltimosAsaltos({ pruebas }: { pruebas: readonly PruebaDuelo[] }) {
  const ultimos = pruebas
    .filter((p) => p.modalidad === 'I')
    .flatMap((p) => p.cruces.map((c) => ({ c, p })))
    .slice(0, ULTIMOS);
  if (ultimos.length === 0) return null;
  return (
    <Seccion id="duelo-ultimos" titulo="Últimos asaltos">
      <ul className="flex flex-col overflow-hidden rounded-xl bg-card px-1">
        {ultimos.map(({ c, p }) => (
          <CruceIndividual
            key={c.id}
            cruce={c}
            arma={p.arma}
            meta={[nombrePrueba({ nombre: p.torneo, fuente: p.fuente, formato: 'INDIVIDUAL' }), fechaCorta(p.fecha)].filter(Boolean).join(' · ')}
          />
        ))}
      </ul>
    </Seccion>
  );
}

function ListaTiradores({ id, titulo, contexto, lista, pais }: { id: string; titulo: string; contexto: string; lista: readonly TiradorDuelo[]; pais: string }) {
  if (lista.length === 0) return null;
  return (
    <Seccion id={id} titulo={titulo} contexto={contexto}>
      <ol className="flex flex-col rounded-xl bg-card px-3">
        {lista.map((t) => (
          <li key={t.personaId} className="border-t border-filete first:border-t-0">
            <FilaPersona
              persona={{ id: t.personaId, nombre: nombreVisible(t.nombre) || t.nombre || '—', pais: paisParaBandera(pais) }}
              href={rutaFicha(t.personaId)}
              densidad="compacta"
              meta={`${cifra(t.asaltos)} asaltos · ${porcentaje(t.victorias, t.asaltos)}`}
              insignias={<span className="cifra text-base tabular-nums">{cifra(t.victorias)}–{cifra(t.derrotas)}</span>}
            />
          </li>
        ))}
      </ol>
    </Seccion>
  );
}

function Pruebas({
  codigo,
  rival,
  pagina,
  filtros,
  desde,
  fallida,
}: {
  codigo: string;
  rival: string;
  pagina: Pick<DueloPaises, 'pruebas' | 'siguiente'>;
  filtros: FiltrosDuelo;
  desde: string;
  fallida: boolean;
}) {
  return (
    <Seccion id="duelo-pruebas" titulo={desde ? 'Más cruces' : 'Cruces'}>
      {fallida ? (
        <EstadoVacio
          tipo="error"
          titulo="No se pudo cargar"
          accion={(
            <>
              <VerMasEnlace href={urlDuelo(codigo, rival, filtros, desde)}>Reintentar</VerMasEnlace>
              <VerMasEnlace href={urlDuelo(codigo, rival, filtros)}>Desde el principio</VerMasEnlace>
            </>
          )}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {pagina.pruebas.map((p) => (
              <TarjetaPrueba key={p.pruebaId} prueba={p} codigo={codigo} rival={rival} />
            ))}
          </ul>
          {pagina.siguiente ? (
            <VerMas href={urlDuelo(codigo, rival, filtros, pagina.siguiente)} detalle="cruces" className="self-center" />
          ) : null}
        </>
      )}
    </Seccion>
  );
}

function TarjetaPrueba({ prueba: p, codigo, rival }: { prueba: PruebaDuelo; codigo: string; rival: string }) {
  const equipos = p.modalidad === 'E';
  const rotulo = rotuloPrueba(
    { arma: p.arma, genero: p.genero, categoria: p.categoria, formato: equipos ? 'EQUIPOS' : 'INDIVIDUAL' },
    { variante: 'corto', categoria: 'siempre' },
  );
  return (
    <li className="flex flex-col rounded-xl bg-card">
      <Link
        href={construirUrlEdicion(p.edicionId, { prueba: p.pruebaId })}
        prefetch={false}
        className={cn('flex min-h-14 items-center gap-3 rounded-t-xl px-3 py-2 hover:bg-secondary', FOCO)}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">
            {nombrePrueba({ nombre: p.torneo, fuente: p.fuente, formato: equipos ? 'EQUIPOS' : 'INDIVIDUAL' })}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {[fechaCorta(p.fecha), rotulo].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="cifra shrink-0 text-xl tabular-nums">
          {p.victorias}–{p.derrotas}
        </span>
      </Link>
      {p.cruces.length > 0 ? (
        <ul className="flex flex-col border-t border-filete px-1 pb-1">
          {p.cruces.map((c) => (equipos
            ? <CruceEquipos key={c.id} cruce={c} codigo={codigo} rival={rival} />
            : <CruceIndividual key={c.id} cruce={c} arma={p.arma} />))}
        </ul>
      ) : null}
    </li>
  );
}

const RONDA_CORTA: Record<number, string> = { 2: 'Final', 4: 'Semifinal', 8: 'Cuartos', 16: 'Octavos' };

function ronda(c: CruceDuelo): string {
  if (c.fase === 'POULE') return 'Poule';
  const r = rondaCuadro(c.ronda ?? '');
  if (r.tamano) return RONDA_CORTA[r.tamano] ?? `T${r.tamano}`;
  return (c.ronda ?? '').toUpperCase() === 'C2' ? 'Bronce' : 'Cuadro';
}

function Tirador({ lado, alinear }: { lado: LadoCruce; alinear: 'start' | 'end' }) {
  const nombre = nombreCompacto(lado.nombre) || lado.nombre || '—';
  const clases = cn('flex min-h-11 min-w-0 items-center text-sm', alinear === 'end' ? 'justify-end text-right' : 'justify-start');
  if (!lado.personaId) return <span className={cn(clases, 'text-muted-foreground')}><span className="truncate">{nombre}</span></span>;
  return (
    <Link href={rutaFicha(lado.personaId)} prefetch={false} className={cn(clases, 'rounded-md hover:text-primary-text', FOCO)}>
      <span className="truncate">{nombre}</span>
    </Link>
  );
}

function Tanteo({ nuestros, suyos, pie }: { nuestros: number; suyos: number; pie: string }) {
  return (
    <span className="flex shrink-0 flex-col items-center px-1">
      <span className="text-sm font-semibold tabular-nums">
        <span className={nuestros > suyos ? 'text-foreground' : 'text-muted-foreground'}>{nuestros}</span>
        <span className="text-muted-foreground">–</span>
        <span className={suyos > nuestros ? 'text-foreground' : 'text-muted-foreground'}>{suyos}</span>
      </span>
      <span className="text-xs text-muted-foreground">{pie}</span>
    </span>
  );
}

function CruceIndividual({ cruce: c, arma, meta }: { cruce: CruceDuelo; arma: string; meta?: string }) {
  const personal = c.nuestro.personaId && c.suyo.personaId
    ? construirUrlCaraACara(c.nuestro.personaId, { rival: c.suyo.personaId, arma })
    : null;
  return (
    <li className="flex flex-col border-t border-filete pl-2 first:border-t-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_44px] items-center gap-1">
        <Tirador lado={c.nuestro} alinear="start" />
        <Tanteo nuestros={c.tocadosNuestros} suyos={c.tocadosSuyos} pie={ronda(c)} />
        <Tirador lado={c.suyo} alinear="end" />
        {personal ? (
          <Link
            href={personal}
            prefetch={false}
            aria-label={`Cara a cara de ${nombreCompacto(c.nuestro.nombre)} y ${nombreCompacto(c.suyo.nombre)}`}
            className={cn('flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground', FOCO)}
          >
            <Swords aria-hidden className="size-4" />
          </Link>
        ) : <span />}
      </div>
      {meta ? <p className="-mt-1 truncate pb-2 text-xs text-muted-foreground">{meta}</p> : null}
    </li>
  );
}

function CruceEquipos({ cruce: c, codigo, rival }: { cruce: CruceDuelo; codigo: string; rival: string }) {
  return (
    <li className="flex flex-col border-t border-filete first:border-t-0">
      <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-2">
        <span className="flex min-w-0 items-center gap-2 text-sm"><Bandera codigo={codigo} /><span className="truncate">{codigo}</span></span>
        <Tanteo nuestros={c.tocadosNuestros} suyos={c.tocadosSuyos} pie={ronda(c)} />
        <span className="flex min-w-0 items-center justify-end gap-2 text-sm"><span className="truncate">{rival}</span><Bandera codigo={rival} /></span>
      </div>
      {c.relevos ? <Relevos relevos={c.relevos} /> : null}
    </li>
  );
}

function alineacion(relevos: readonly RelevoDuelo[], lado: 'nuestro' | 'suyo'): LadoCruce[] {
  const vistos = new Map<string, LadoCruce>();
  for (const r of relevos) {
    const l = r[lado];
    if (l && l.nombre && !vistos.has(l.personaId ?? l.nombre)) vistos.set(l.personaId ?? l.nombre, l);
  }
  return [...vistos.values()];
}

function Relevos({ relevos }: { relevos: readonly RelevoDuelo[] }) {
  const nuestros = alineacion(relevos, 'nuestro');
  const suyos = alineacion(relevos, 'suyo');
  return (
    <details className="group px-2 pb-2">
      <summary className={cn('flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden', FOCO)}>
        Alineación y relevos
      </summary>
      <div className="grid grid-cols-2 gap-3 pb-2 text-xs text-muted-foreground">
        <p>{nuestros.map((l) => nombreCompacto(l.nombre) || l.nombre).join(', ')}</p>
        <p className="text-right">{suyos.map((l) => nombreCompacto(l.nombre) || l.nombre).join(', ')}</p>
      </div>
      <ol className="flex flex-col">
        {relevos.map((r) => (
          <li key={r.numero} className="grid grid-cols-[24px_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 border-t border-filete">
            <span className="text-xs text-muted-foreground tabular-nums">{r.numero}</span>
            {r.nuestro ? <Tirador lado={r.nuestro} alinear="start" /> : <span />}
            <Tanteo nuestros={r.tocadosNuestros} suyos={r.tocadosSuyos} pie={`${r.marcadorNuestro}–${r.marcadorSuyo}`} />
            {r.suyo ? <Tirador lado={r.suyo} alinear="end" /> : <span />}
          </li>
        ))}
      </ol>
    </details>
  );
}
