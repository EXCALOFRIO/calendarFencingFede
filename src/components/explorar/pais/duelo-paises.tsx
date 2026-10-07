import { Swords } from 'lucide-react';
import Link from 'next/link';
import { AREA_TACTIL, FOCO } from '@/components/sistema/tactil';
import { construirUrlCaraACara } from '@/lib/sport/explorar/cara-a-cara-url';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import { rondaCuadro } from '@/lib/sport/explorar/ediciones-asaltos';
import type { BalanceDuelo, CruceDuelo, DueloPaises, LadoCruce, PruebaDuelo, RelevoDuelo, TemporadaDuelo } from '@/lib/sport/explorar/pais';
import { nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { cifra, porcentaje, temporadaCorta } from '@/lib/sport/explorar/pais-frases';
import { ETIQUETA_ARMA, ETIQUETA_CATEGORIA, rutaPais, urlDuelo, type FiltrosDuelo } from '@/lib/sport/explorar/pais-url';
import { nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreCompacto } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { FiltrosPais } from './filtros-pais';
import { Bandera, EstadoPais, Frases, TituloSeccion, fechaCorta } from './piezas-pais';

/**
 * Cara a cara de dos selecciones (`/explorar/pais/[codigo]/contra/[otro]`):
 * balance, evolución por temporada y, por prueba, los asaltos entre tiradores
 * de los dos países y los encuentros por equipos con sus relevos. Todo desde
 * el país de la ruta («nuestro»).
 */
export function DueloPaisesVista({
  duelo,
  pagina,
  filtros,
  categorias,
  frases,
  desde,
}: {
  /** Balance y evolución (la primera página, cacheada). */
  duelo: DueloPaises;
  /** La página de pruebas que se enseña: la del propio `duelo` o la de `desde`. */
  pagina: Pick<DueloPaises, 'pruebas' | 'siguiente'>;
  filtros: FiltrosDuelo;
  categorias: readonly string[];
  frases: readonly string[];
  desde: string;
}) {
  const { codigo, rival } = duelo;
  const equipos = filtros.modalidad === 'equipos' || (duelo.individual.asaltos === 0 && duelo.equipos.asaltos > 0);
  const principal = equipos ? duelo.equipos : duelo.individual;
  const temporadas = [...duelo.temporadas].map((t) => t.temporada).reverse();
  const hayAlgo = duelo.individual.asaltos + duelo.equipos.asaltos > 0;
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-[24px]">
      <Marcador codigo={codigo} rival={rival} balance={principal} unidad={equipos ? 'encuentros' : 'asaltos'} />

      <FiltrosPais
        filtros={filtros}
        categorias={categorias}
        temporadas={temporadas}
        url={(f) => urlDuelo(codigo, rival, f)}
      />

      {!hayAlgo ? (
        <EstadoPais
          titulo="Sin cruces"
          linea="No hay asaltos entre los dos con estos filtros."
          volver={{ href: urlDuelo(codigo, rival), texto: 'Quitar filtros' }}
        />
      ) : (
        <>
          <Frases frases={frases} />
          {!equipos && duelo.equipos.asaltos > 0 && filtros.modalidad === '' ? (
            <p className="text-[13px] leading-[16px] text-muted-foreground">
              Por equipos: {cifra(duelo.equipos.victorias)}–{cifra(duelo.equipos.derrotas)}
            </p>
          ) : null}
          <Evolucion temporadas={duelo.temporadas} equipos={equipos} />
          <Pruebas codigo={codigo} rival={rival} pagina={pagina} filtros={filtros} desde={desde} />
        </>
      )}
    </div>
  );
}

function Marcador({ codigo, rival, balance, unidad }: { codigo: string; rival: string; balance: BalanceDuelo; unidad: string }) {
  const decididos = balance.victorias + balance.derrotas;
  const parte = decididos > 0 ? (balance.victorias / decididos) * 100 : 50;
  const lado = (c: string, alinear: 'start' | 'end') => (
    <Link
      href={rutaPais(c)}
      prefetch={false}
      className={cn('flex min-h-[44px] min-w-0 flex-col justify-center gap-[4px] rounded-[6px]', alinear === 'end' ? 'items-end text-right' : 'items-start', FOCO)}
    >
      <Bandera codigo={c} className="[&_img]:h-[18px] [&_img]:w-[24px]" />
      <span className="w-full truncate text-[14px] leading-[20px] font-semibold">{nombrePaisFie(c)}</span>
    </Link>
  );
  return (
    <header className="flex flex-col gap-[12px]">
      <h1 className="sr-only">{nombrePaisFie(codigo)} contra {nombrePaisFie(rival)}</h1>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-[12px]">
        {lado(codigo, 'start')}
        <p className="flex flex-col items-center">
          <span className="cifra text-[40px] leading-[44px] tabular-nums">
            {cifra(balance.victorias)}–{cifra(balance.derrotas)}
          </span>
          <span className="text-[12px] leading-[16px] text-muted-foreground">
            {cifra(balance.asaltos)} {unidad}
          </span>
        </p>
        {lado(rival, 'end')}
      </div>
      {decididos > 0 ? (
        <div
          role="img"
          aria-label={`${porcentaje(balance.victorias, decididos)} de victorias`}
          className="flex h-[6px] overflow-hidden rounded-full bg-secondary"
        >
          <span className="block h-full bg-foreground" style={{ width: `${parte}%` }} />
        </div>
      ) : null}
    </header>
  );
}

const MAX_TEMPORADAS = 20;

function Evolucion({ temporadas, equipos }: { temporadas: readonly TemporadaDuelo[]; equipos: boolean }) {
  const de = (t: TemporadaDuelo) => (equipos ? t.equipos : t.individual);
  const ultimas = temporadas.filter((t) => de(t).victorias + de(t).derrotas > 0).slice(-MAX_TEMPORADAS);
  if (ultimas.length < 2) return null;
  const max = Math.max(1, ...ultimas.map((t) => Math.max(de(t).victorias, de(t).derrotas)));
  const rotular = (i: number) => i === 0 || i === ultimas.length - 1 || (ultimas.length - 1 - i) % 4 === 0;
  const resumen = ultimas.map((t) => `${temporadaCorta(t.temporada)}: ${de(t).victorias}–${de(t).derrotas}`).join(', ');
  return (
    <section aria-labelledby="duelo-evolucion" className="flex flex-col gap-[12px]">
      <TituloSeccion id="duelo-evolucion">Por temporada</TituloSeccion>
      <div role="img" aria-label={resumen} className="flex flex-col gap-[4px] rounded-[12px] bg-card px-[12px] py-[12px]">
        <div className="flex h-[56px] items-end gap-[3px]">
          {ultimas.map((t) => (
            <span key={t.temporada} className="block min-w-0 flex-1 rounded-t-[2px] bg-foreground" style={{ height: `${(de(t).victorias / max) * 100}%` }} />
          ))}
        </div>
        <div className="h-px bg-filete-alto" />
        <div className="flex h-[56px] items-start gap-[3px]">
          {ultimas.map((t) => (
            <span key={t.temporada} className="block min-w-0 flex-1 rounded-b-[2px] bg-muted-foreground" style={{ height: `${(de(t).derrotas / max) * 100}%` }} />
          ))}
        </div>
        <div aria-hidden className="flex gap-[3px]">
          {ultimas.map((t, i) => (
            <span key={t.temporada} className="min-w-0 flex-1 text-center text-[12px] leading-[16px] whitespace-nowrap text-muted-foreground">
              {rotular(i) ? `’${t.temporada.slice(-2)}` : ''}
            </span>
          ))}
        </div>
        <div aria-hidden className="flex justify-between text-[12px] leading-[16px] text-muted-foreground">
          <span>Arriba, victorias</span>
          <span>abajo, derrotas</span>
        </div>
      </div>
    </section>
  );
}

function Pruebas({
  codigo,
  rival,
  pagina,
  filtros,
  desde,
}: {
  codigo: string;
  rival: string;
  pagina: Pick<DueloPaises, 'pruebas' | 'siguiente'>;
  filtros: FiltrosDuelo;
  desde: string;
}) {
  return (
    <section aria-labelledby="duelo-pruebas" className="flex flex-col gap-[12px]">
      <TituloSeccion id="duelo-pruebas">{desde ? 'Más cruces' : 'Cruces'}</TituloSeccion>
      <ul className="flex flex-col gap-[12px]">
        {pagina.pruebas.map((p) => (
          <TarjetaPrueba key={p.pruebaId} prueba={p} codigo={codigo} rival={rival} />
        ))}
      </ul>
      {pagina.siguiente ? (
        <Link
          href={urlDuelo(codigo, rival, filtros, pagina.siguiente)}
          prefetch={false}
          className={cn('inline-flex h-[36px] items-center justify-center self-center rounded-full bg-secondary px-[16px] text-[13px] font-medium hover:bg-accent', AREA_TACTIL, FOCO)}
        >
          Ver más
        </Link>
      ) : null}
    </section>
  );
}

function TarjetaPrueba({ prueba: p, codigo, rival }: { prueba: PruebaDuelo; codigo: string; rival: string }) {
  const equipos = p.modalidad === 'E';
  const rotulo = [ETIQUETA_ARMA[p.arma] ?? p.arma, ETIQUETA_CATEGORIA[p.categoria] ?? p.categoria].join(' ');
  return (
    <li className="flex flex-col rounded-[12px] bg-card">
      <Link
        href={construirUrlEdicion(p.edicionId, { prueba: p.pruebaId })}
        prefetch={false}
        className={cn('flex min-h-[56px] items-center gap-[12px] rounded-t-[12px] px-[12px] py-[8px] hover:bg-secondary', FOCO)}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] leading-[20px] font-semibold">
            {nombrePrueba({ nombre: p.torneo, fuente: p.fuente, formato: equipos ? 'EQUIPOS' : 'INDIVIDUAL' })}
          </span>
          <span className="truncate text-[12px] leading-[16px] text-muted-foreground">
            {fechaCorta(p.fecha)} · {rotulo}{equipos ? ' por equipos' : ''}
          </span>
        </span>
        <span className="cifra shrink-0 text-[20px] leading-[24px] tabular-nums">
          {p.victorias}–{p.derrotas}
        </span>
      </Link>
      {p.cruces.length > 0 ? (
        <ul className="flex flex-col border-t border-filete px-[4px] pb-[4px]">
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
  const clases = cn(
    'flex min-h-[44px] min-w-0 items-center text-[14px] leading-[20px]',
    alinear === 'end' ? 'justify-end text-right' : 'justify-start',
  );
  if (!lado.personaId) return <span className={cn(clases, 'text-muted-foreground')}><span className="truncate">{nombre}</span></span>;
  return (
    <Link href={rutaFicha(lado.personaId)} prefetch={false} className={cn(clases, 'rounded-[6px] hover:text-primary-text', FOCO)}>
      <span className="truncate">{nombre}</span>
    </Link>
  );
}

function Tanteo({ nuestros, suyos, pie }: { nuestros: number; suyos: number; pie: string }) {
  return (
    <span className="flex shrink-0 flex-col items-center px-[4px]">
      <span className="text-[14px] leading-[20px] font-semibold tabular-nums">
        <span className={nuestros > suyos ? 'text-foreground' : 'text-muted-foreground'}>{nuestros}</span>
        <span className="text-muted-foreground">–</span>
        <span className={suyos > nuestros ? 'text-foreground' : 'text-muted-foreground'}>{suyos}</span>
      </span>
      <span className="text-[12px] leading-[16px] text-muted-foreground">{pie}</span>
    </span>
  );
}

function CruceIndividual({ cruce: c, arma }: { cruce: CruceDuelo; arma: string }) {
  const personal = c.nuestro.personaId && c.suyo.personaId
    ? construirUrlCaraACara(c.nuestro.personaId, { rival: c.suyo.personaId, arma })
    : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_44px] items-center gap-[4px] border-t border-filete pl-[8px] first:border-t-0">
      <Tirador lado={c.nuestro} alinear="start" />
      <Tanteo nuestros={c.tocadosNuestros} suyos={c.tocadosSuyos} pie={ronda(c)} />
      <Tirador lado={c.suyo} alinear="end" />
      {personal ? (
        <Link
          href={personal}
          prefetch={false}
          aria-label={`Cara a cara de ${nombreCompacto(c.nuestro.nombre)} y ${nombreCompacto(c.suyo.nombre)}`}
          className={cn('flex size-[44px] items-center justify-center rounded-full text-muted-foreground hover:text-foreground', FOCO)}
        >
          <Swords aria-hidden className="size-[18px]" />
        </Link>
      ) : <span />}
    </li>
  );
}

function CruceEquipos({ cruce: c, codigo, rival }: { cruce: CruceDuelo; codigo: string; rival: string }) {
  return (
    <li className="flex flex-col border-t border-filete first:border-t-0">
      <div className="grid min-h-[44px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-[4px] px-[8px]">
        <span className="flex min-w-0 items-center gap-[6px] text-[14px] leading-[20px]"><Bandera codigo={codigo} /><span className="truncate">{codigo}</span></span>
        <Tanteo nuestros={c.tocadosNuestros} suyos={c.tocadosSuyos} pie={ronda(c)} />
        <span className="flex min-w-0 items-center justify-end gap-[6px] text-[14px] leading-[20px]"><span className="truncate">{rival}</span><Bandera codigo={rival} /></span>
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
    <details className="group px-[8px] pb-[8px]">
      <summary className={cn('flex min-h-[44px] cursor-pointer list-none items-center text-[13px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden', FOCO)}>
        Alineación y relevos
      </summary>
      <div className="grid grid-cols-2 gap-[12px] pb-[8px] text-[12px] leading-[16px] text-muted-foreground">
        <p>{nuestros.map((l) => nombreCompacto(l.nombre) || l.nombre).join(', ')}</p>
        <p className="text-right">{suyos.map((l) => nombreCompacto(l.nombre) || l.nombre).join(', ')}</p>
      </div>
      <ol className="flex flex-col">
        {relevos.map((r) => (
          <li key={r.numero} className="grid grid-cols-[24px_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-[4px] border-t border-filete">
            <span className="text-[12px] leading-[16px] text-muted-foreground tabular-nums">{r.numero}</span>
            {r.nuestro ? <Tirador lado={r.nuestro} alinear="start" /> : <span />}
            <Tanteo nuestros={r.tocadosNuestros} suyos={r.tocadosSuyos} pie={`${r.marcadorNuestro}–${r.marcadorSuyo}`} />
            {r.suyo ? <Tirador lado={r.suyo} alinear="end" /> : <span />}
          </li>
        ))}
      </ol>
    </details>
  );
}
