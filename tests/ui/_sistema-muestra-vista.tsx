'use client';

/**
 * Página de muestra de `src/components/sistema/*` para `sistema-muestra.mts`.
 * La pinta el servidor del arnés y la hidrata `_sistema-muestra-cliente.tsx`.
 */
import {
  Bell,
  CalendarDays,
  Check,
  CircleUserRound,
  Compass,
  MoreHorizontal,
  Plus,
  Search,
  Share,
  SlidersHorizontal,
  Trophy,
} from 'lucide-react';
import { useState } from 'react';
import { BarraInferior } from '@/components/sistema/barra-inferior';
import { Boton, BotonIcono } from '@/components/sistema/boton';
import { CabeceraCompacta } from '@/components/sistema/cabecera-compacta';
import { ChipFiltro, FilaChips } from '@/components/sistema/chip-filtro';
import { HojaInferior } from '@/components/sistema/hoja-inferior';
import type { DestinoBarra } from '@/components/sistema/navegacion';
import { TransicionPagina } from '@/components/sistema/transicion';

export const DESTINOS_MUESTRA: readonly DestinoBarra[] = [
  { clave: 'calendario', href: '/', etiqueta: 'Calendario', icono: CalendarDays },
  { clave: 'explorar', href: '/explorar', etiqueta: 'Explorar', icono: Compass },
  { clave: 'buscar', href: '/explorar/buscar', etiqueta: 'Buscar', icono: Search },
  { clave: 'ranking', href: '/ranking', etiqueta: 'Ranking', icono: Trophy },
  { clave: 'tu', href: '/explorar/yo', etiqueta: 'Tú', icono: CircleUserRound, insignia: true },
];

const ARMAS = ['Florete', 'Espada', 'Sable'] as const;
const AMBITOS = ['Nacional', 'Internacional', 'Europeo'] as const;

const TORNEOS = [
  { dia: '12', mes: 'oct', nombre: 'TNR Absoluto', lugar: 'Madrid', arma: 'Florete', plazo: '3 días' },
  { dia: '19', mes: 'oct', nombre: 'Copa del Mundo', lugar: 'Tauberbischofsheim', arma: 'Florete', plazo: null },
  { dia: '26', mes: 'oct', nombre: 'Circuito Europeo M17', lugar: 'Budapest', arma: 'Espada', plazo: '9 días' },
  { dia: '02', mes: 'nov', nombre: 'Liga Nacional', lugar: 'Valencia', arma: 'Sable', plazo: '12 días' },
  { dia: '09', mes: 'nov', nombre: 'Campeonato del Mundo M20', lugar: 'Plovdiv', arma: 'Espada', plazo: null },
];

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[12px] border-t border-filete py-[20px]">
      <h2 className="font-sans text-[13px] leading-[16px] font-semibold tracking-normal text-muted-foreground">{titulo}</h2>
      {children}
    </section>
  );
}

function Lista() {
  return (
    <ul className="flex flex-col">
      {TORNEOS.map((t) => (
        <li key={t.nombre} className="flex min-w-0 items-center gap-[12px] border-b border-filete py-[10px]">
          <div className="flex w-[40px] shrink-0 flex-col items-center">
            <span className="cifra text-[20px] leading-[20px]">{t.dia}</span>
            <span className="text-[12px] leading-[16px] text-muted-foreground">{t.mes}</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] leading-[20px] font-medium">{t.nombre}</span>
            <span className="truncate text-[13px] leading-[16px] text-muted-foreground">{t.lugar}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-[13px] leading-[16px]">{t.arma}</span>
            {t.plazo ? <span className="text-[12px] leading-[16px] text-warn">{t.plazo}</span> : null}
          </div>
          <BotonIcono etiqueta={`Más opciones de ${t.nombre}`} tamano="md" className="text-muted-foreground">
            <MoreHorizontal aria-hidden />
          </BotonIcono>
        </li>
      ))}
    </ul>
  );
}

export function Muestra({ hojaInicial }: { hojaInicial: boolean }) {
  const [hoja, setHoja] = useState(hojaInicial);
  const [armas, setArmas] = useState<string[]>(['Florete']);
  const [ambito, setAmbito] = useState<string>('Nacional');
  const alternar = (a: string) => setArmas((x) => (x.includes(a) ? x.filter((y) => y !== a) : [...x, a]));

  return (
    <>
      <CabeceraCompacta
        variante="raiz"
        titulo="Calendario"
        acciones={
          <>
            <BotonIcono etiqueta="Buscar">
              <Search aria-hidden />
            </BotonIcono>
            <BotonIcono etiqueta="Notificaciones, 2 nuevas" className="relative">
              <Bell aria-hidden />
              <span aria-hidden className="absolute top-[6px] right-[7px] size-[7px] rounded-full bg-primary ring-2 ring-background" />
            </BotonIcono>
          </>
        }
      />
      <TransicionPagina>
        <main className="mx-auto flex w-full max-w-[640px] flex-col px-[16px] pt-[8px] pb-[calc(50px+env(safe-area-inset-bottom)+24px)] lg:pb-[48px]">
          <FilaChips etiqueta="Filtros del calendario">
            <ChipFiltro tipo="menu" icono={SlidersHorizontal} contador={armas.length} onClick={() => setHoja(true)}>
              Filtros
            </ChipFiltro>
            {ARMAS.map((a) => (
              <ChipFiltro key={a} marcado={armas.includes(a)} onClick={() => alternar(a)}>
                {a}
              </ChipFiltro>
            ))}
            <ChipFiltro tipo="menu">Categoría</ChipFiltro>
          </FilaChips>

          <div className="pt-[12px]">
            <Lista />
          </div>

          <Seccion titulo="Tipografía">
            <div className="flex flex-col gap-[6px]">
              <p className="text-[20px] leading-[24px] font-semibold">20 · Título de pantalla</p>
              <p className="text-[16px] leading-[20px] font-semibold">16 · Título de cabecera y de hoja</p>
              <p className="text-[14px] leading-[20px]">14 · Texto de lista y párrafos</p>
              <p className="text-[13px] leading-[16px] text-muted-foreground">13 · Segunda línea, chips y botones</p>
              <p className="text-[12px] leading-[16px] text-muted-foreground">12 · Fechas, contadores y metadatos</p>
            </div>
          </Seccion>

          <Seccion titulo="Botones: 28, 32 y 36 px a la vista; 44 al tacto">
            {(['primario', 'secundario', 'claro', 'contorno', 'fantasma'] as const).map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-[8px]">
                <Boton variante={v} tamano="sm">
                  Seguir
                </Boton>
                <Boton variante={v}>
                  <Plus aria-hidden />
                  Seguir
                </Boton>
                <Boton variante={v} tamano="lg">
                  Inscribirme
                </Boton>
                <Boton variante={v} disabled>
                  Inscribirme
                </Boton>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-[8px]">
              <BotonIcono etiqueta="Compartir" tamano="sm">
                <Share aria-hidden />
              </BotonIcono>
              <BotonIcono etiqueta="Compartir" tamano="md">
                <Share aria-hidden />
              </BotonIcono>
              <BotonIcono etiqueta="Compartir" tamano="lg">
                <Share aria-hidden />
              </BotonIcono>
              <BotonIcono etiqueta="Añadir" variante="secundario" tamano="md">
                <Plus aria-hidden />
              </BotonIcono>
              <BotonIcono etiqueta="Hecho" variante="primario" tamano="md">
                <Check aria-hidden />
              </BotonIcono>
            </div>
            <Boton variante="primario" tamano="lg" ancho="completo">
              Solicitar inscripción
            </Boton>
          </Seccion>

          <Seccion titulo="Chips">
            <FilaChips etiqueta="Ámbito">
              {AMBITOS.map((a) => (
                <ChipFiltro key={a} marcado={ambito === a} onClick={() => setAmbito(a)}>
                  {a}
                </ChipFiltro>
              ))}
            </FilaChips>
            <FilaChips etiqueta="Filtros puestos" envolver>
              <ChipFiltro tipo="quitar">Florete</ChipFiltro>
              <ChipFiltro tipo="quitar">M17</ChipFiltro>
              <ChipFiltro tipo="quitar">Temporada 2025-2026</ChipFiltro>
            </FilaChips>
          </Seccion>

          <Seccion titulo="Cabecera de subpantalla">
            <div className="overflow-hidden rounded-[12px] border border-filete">
              <CabeceraCompacta
                titulo="Carlos Llavador"
                anclada={false}
                pegajosa={false}
                acciones={
                  <BotonIcono etiqueta="Más opciones">
                    <MoreHorizontal aria-hidden />
                  </BotonIcono>
                }
              />
            </div>
          </Seccion>

          <Seccion titulo="Barra inferior: sólida, material y con rótulos">
            <div className="flex flex-col gap-[12px]">
              {(['solido', 'material'] as const).map((fondo) => (
                <div key={fondo} className="relative overflow-hidden rounded-[12px] border border-filete">
                  <div aria-hidden className="flex flex-col gap-[6px] p-[12px] text-[14px]">
                    <span className="h-[18px] w-3/4 rounded-[4px] bg-org-fie-relleno" />
                    <span className="h-[18px] w-1/2 rounded-[4px] bg-org-rfee-relleno" />
                    <span className="h-[18px] w-2/3 rounded-[4px] bg-org-efc-relleno" />
                    <span className="truncate font-medium">Contenido que pasa por debajo de la barra</span>
                    <span className="h-[18px] w-4/5 rounded-[4px] bg-primary" />
                    <span className="h-[18px] w-3/5 rounded-[4px] bg-org-fie-relleno" />
                  </div>
                  <BarraInferior
                    destinos={DESTINOS_MUESTRA}
                    activa="explorar"
                    fondo={fondo}
                    posicion="estatica"
                    soloMovil={false}
                    etiqueta={`Barra de muestra ${fondo}`}
                    className="absolute inset-x-0 bottom-0 pb-0"
                  />
                </div>
              ))}
              <div className="overflow-hidden rounded-[12px] border border-filete">
                <BarraInferior
                  destinos={DESTINOS_MUESTRA}
                  activa="ranking"
                  rotulos="visibles"
                  posicion="estatica"
                  soloMovil={false}
                  etiqueta="Barra de muestra con rótulos"
                  className="pb-0"
                />
              </div>
            </div>
          </Seccion>
        </main>
      </TransicionPagina>

      <HojaInferior
        abierta={hoja}
        alCambiar={setHoja}
        titulo="Filtros"
        pie={
          <Boton variante="primario" tamano="lg" ancho="completo" onClick={() => setHoja(false)}>
            Ver 128 torneos
          </Boton>
        }
      >
        <div className="flex flex-col gap-[20px] pt-[4px]">
          <div className="flex flex-col gap-[8px]">
            <h3 className="font-sans text-[13px] font-semibold tracking-normal text-muted-foreground">Arma</h3>
            <FilaChips etiqueta="Arma" envolver>
              {ARMAS.map((a) => (
                <ChipFiltro key={a} marcado={armas.includes(a)} onClick={() => alternar(a)}>
                  {a}
                </ChipFiltro>
              ))}
            </FilaChips>
          </div>
          <div className="flex flex-col gap-[8px]">
            <h3 className="font-sans text-[13px] font-semibold tracking-normal text-muted-foreground">Ámbito</h3>
            <FilaChips etiqueta="Ámbito" envolver>
              {AMBITOS.map((a) => (
                <ChipFiltro key={a} marcado={ambito === a} onClick={() => setAmbito(a)}>
                  {a}
                </ChipFiltro>
              ))}
            </FilaChips>
          </div>
          <div className="flex flex-col gap-[8px]">
            <h3 className="font-sans text-[13px] font-semibold tracking-normal text-muted-foreground">Categoría</h3>
            <FilaChips etiqueta="Categoría" envolver>
              {['M13', 'M15', 'M17', 'M20', 'Absoluto', 'Veteranos'].map((c) => (
                <ChipFiltro key={c} marcado={c === 'M17'}>
                  {c}
                </ChipFiltro>
              ))}
            </FilaChips>
          </div>
        </div>
      </HojaInferior>

      <BarraInferior destinos={DESTINOS_MUESTRA} />
    </>
  );
}
