import Link from 'next/link';
import { FOCO } from '@/components/sistema/tactil';
import { construirUrlEdicion } from '@/lib/sport/explorar/edicion-url';
import type { FichaPais, PodioPais, TemporadaPais } from '@/lib/sport/explorar/pais';
import { nombrePaisFie } from '@/lib/sport/explorar/pais-codigos';
import { cifra, temporadaCorta } from '@/lib/sport/explorar/pais-frases';
import { ETIQUETA_ARMA, ETIQUETA_CATEGORIA, urlDuelo, urlPais, type FiltrosPais } from '@/lib/sport/explorar/pais-url';
import { medallaDe, nombrePrueba } from '@/lib/sport/explorar/presentacion';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import { ElegirRival, type OpcionRival } from './elegir-rival';
import { FiltrosPais as Filtros } from './filtros-pais';
import { Baldosa, Bandera, EstadoPais, Frases, PuntoMedalla, TituloSeccion, fechaCorta } from './piezas-pais';

/**
 * Ficha de un país (`/explorar/pais/[codigo]`): cifras, frases, evolución por
 * temporada, últimos podios y el selector de rival para el cara a cara.
 * Componente de servidor sin estado: todo llega en el DTO cacheado.
 */
export function FichaPaisVista({ ficha, filtros, frases }: { ficha: FichaPais; filtros: FiltrosPais; frases: readonly string[] }) {
  const nombre = nombrePaisFie(ficha.codigo);
  const t = ficha.total;
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-[24px]">
      <header className="flex min-w-0 items-center gap-[12px]">
        <Bandera codigo={ficha.codigo} className="[&_img]:h-[24px] [&_img]:w-[32px]" />
        <h1 className="min-w-0 truncate font-sans text-[20px] leading-[24px] font-semibold">{nombre}</h1>
      </header>

      <Filtros
        filtros={{ ...filtros, temporada: '' }}
        categorias={ficha.categorias}
        url={(f) => urlPais(ficha.codigo, f)}
      />

      {!t || t.resultados === 0 ? (
        <EstadoPais titulo="Sin resultados" linea="Prueba con otros filtros." volver={{ href: urlPais(ficha.codigo), texto: 'Quitar filtros' }} />
      ) : (
        <>
          <Frases frases={frases} />
          <section aria-labelledby="pais-cifras" className="flex flex-col gap-[12px]">
            <h2 id="pais-cifras" className="sr-only">Cifras</h2>
            <div className="grid grid-cols-3 gap-[8px]">
              <Baldosa valor={cifra(t.oros)} rotulo="Oros" medalla="oro" />
              <Baldosa valor={cifra(t.platas)} rotulo="Platas" medalla="plata" />
              <Baldosa valor={cifra(t.bronces)} rotulo="Bronces" medalla="bronce" />
            </div>
            <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">
              <Baldosa valor={cifra(t.pruebas)} rotulo="Pruebas" />
              <Baldosa valor={t.tiradores > 0 ? cifra(t.tiradores) : '—'} rotulo="Tiradores" />
              <Baldosa valor={cifra(t.finales)} rotulo="Entre los 8" />
              <Baldosa valor={t.mejor !== null ? `${t.mejor}.º` : '—'} rotulo="Mejor puesto" />
            </div>
          </section>
          <Evolucion temporadas={ficha.temporadas} />
          <Podios podios={ficha.podios} />
        </>
      )}

      <Rivales ficha={ficha} filtros={filtros} />
    </div>
  );
}

const MAX_TEMPORADAS = 20;

function Evolucion({ temporadas }: { temporadas: readonly TemporadaPais[] }) {
  const ultimas = temporadas.slice(-MAX_TEMPORADAS);
  if (ultimas.length < 2) return null;
  const medallas = (s: TemporadaPais) => s.oros + s.platas + s.bronces;
  const conMedallas = ultimas.some((s) => medallas(s) > 0);
  const valor = (s: TemporadaPais) => (conMedallas ? medallas(s) : s.pruebas);
  const max = Math.max(1, ...ultimas.map(valor));
  const resumen = ultimas.map((s) => `${temporadaCorta(s.temporada)}: ${valor(s)}`).join(', ');
  const rotular = (i: number) => i === 0 || i === ultimas.length - 1 || (ultimas.length - 1 - i) % 4 === 0;
  return (
    <section aria-labelledby="pais-evolucion" className="flex flex-col gap-[12px]">
      <TituloSeccion id="pais-evolucion">{conMedallas ? 'Medallas por temporada' : 'Pruebas por temporada'}</TituloSeccion>
      <div role="img" aria-label={resumen} className="flex flex-col gap-[4px] rounded-[12px] bg-card px-[12px] pt-[12px] pb-[8px]">
        <div className="flex h-[96px] items-end gap-[3px]">
          {ultimas.map((s) => {
            const alto = (v: number) => `${(v / max) * 100}%`;
            return (
              <div key={s.temporada} title={`${temporadaCorta(s.temporada)}: ${valor(s)}`} className="flex h-full min-w-0 flex-1 flex-col-reverse">
                {conMedallas ? (
                  <>
                    <span className="block w-full rounded-b-[2px] bg-[#CD7F32]" style={{ height: alto(s.bronces) }} />
                    <span className="block w-full bg-[#A8A9AD]" style={{ height: alto(s.platas) }} />
                    <span className="block w-full rounded-t-[2px] bg-[#D4A017]" style={{ height: alto(s.oros) }} />
                  </>
                ) : (
                  <span className="block w-full rounded-[2px] bg-muted-foreground" style={{ height: alto(s.pruebas) }} />
                )}
              </div>
            );
          })}
        </div>
        <div aria-hidden className="flex gap-[3px]">
          {ultimas.map((s, i) => (
            <span key={s.temporada} className="min-w-0 flex-1 overflow-visible text-center text-[12px] leading-[16px] whitespace-nowrap text-muted-foreground">
              {rotular(i) ? `’${s.temporada.slice(-2)}` : ''}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Podios({ podios }: { podios: readonly PodioPais[] }) {
  if (podios.length === 0) return null;
  return (
    <section aria-labelledby="pais-podios" className="flex flex-col gap-[8px]">
      <TituloSeccion id="pais-podios">Últimos podios</TituloSeccion>
      <ul className="flex flex-col overflow-hidden rounded-[12px] bg-card">
        {podios.map((p) => {
          const medalla = medallaDe(p.puesto)!;
          const href = p.persona ? rutaFicha(p.persona.id) : construirUrlEdicion(p.edicionId, { prueba: p.pruebaId });
          const quien = p.persona ? nombreVisible(p.persona.nombre) || p.persona.nombre : 'Equipo';
          const prueba = [ETIQUETA_ARMA[p.arma] ?? p.arma, ETIQUETA_CATEGORIA[p.categoria] ?? p.categoria].join(' ');
          return (
            <li key={p.resultadoId} className="border-t border-filete first:border-t-0">
              <Link
                href={href}
                prefetch={false}
                className={cn('flex min-h-[56px] items-center gap-[12px] px-[12px] py-[8px] hover:bg-secondary', FOCO)}
              >
                <PuntoMedalla medalla={medalla} className="size-[12px]" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] leading-[20px] font-medium">{quien}</span>
                  <span className="truncate text-[12px] leading-[16px] text-muted-foreground">
                    {nombrePrueba({ nombre: p.torneo, fuente: p.fuente, formato: p.modalidad === 'E' ? 'EQUIPOS' : 'INDIVIDUAL' })}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end text-[12px] leading-[16px] text-muted-foreground">
                  <span>{prueba}</span>
                  <span>{fechaCorta(p.fecha)}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Rivales({ ficha, filtros }: { ficha: FichaPais; filtros: FiltrosPais }) {
  if (ficha.rivales.length === 0) return null;
  const opciones: OpcionRival[] = ficha.rivales.map((r) => ({
    codigo: r.codigo,
    nombre: nombrePaisFie(r.codigo),
    href: urlDuelo(ficha.codigo, r.codigo, filtros),
    balance: r.asaltos > 0 ? `${cifra(r.victorias)}–${cifra(r.derrotas)}` : `${cifra(r.ganados)}–${cifra(r.perdidos)}`,
    bandera: <Bandera codigo={r.codigo} />,
  }));
  return (
    <section aria-labelledby="pais-rivales" className="flex flex-col gap-[8px]">
      <TituloSeccion id="pais-rivales">Cara a cara</TituloSeccion>
      <ElegirRival opciones={opciones} />
    </section>
  );
}
