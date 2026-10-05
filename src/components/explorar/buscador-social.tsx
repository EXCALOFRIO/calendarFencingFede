'use client';

import { ArrowRight, LoaderCircle, Search, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { rutaFichaConRetorno } from '@/lib/sport/explorar/ficha-url';
import {
  anadirReciente,
  claveRecientes,
  leerRecientes,
  quitarReciente,
  type PerfilReciente,
} from '@/lib/sport/explorar/recientes';
import {
  crearSolicitanteSugerencias,
  type EstadoSugerencias,
} from '@/lib/sport/explorar/sugerencias-cliente';
import { consultaSugerencias, MAX_SUGERENCIAS_SOCIAL } from '@/lib/sport/explorar/sugerencias-modelo';
import { nombreVisible } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import {
  BotonQuitarReciente,
  CLASE_LISTA_PERFILES,
  EncabezadoSeccion,
  FilaPerfil,
} from './buscador-social-fila';
import { BotonSeguirCompacto } from './buscador-social-seguir';

type Sugerida = EstadoSugerencias['items'][number];

/** Espera tras la última tecla: corta, porque cada consulta lee unos pocos miles de filas. */
const ESPERA_SOCIAL = 160;

function almacen(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Recientes de esta cuenta en este navegador. Sin almacenamiento (modo privado estricto), simplemente no hay. */
export function useRecientes(profileId: string | undefined) {
  const clave = profileId ? claveRecientes(profileId) : null;
  const [lista, setLista] = React.useState<PerfilReciente[]>([]);
  React.useEffect(() => {
    if (!clave) return;
    try {
      setLista(leerRecientes(almacen()?.getItem(clave)));
    } catch {
      setLista([]);
    }
  }, [clave]);
  const escribir = React.useCallback((cambiar: (actual: PerfilReciente[]) => PerfilReciente[]) => {
    if (!clave) return;
    const s = almacen();
    let actual: PerfilReciente[] = [];
    try {
      actual = leerRecientes(s?.getItem(clave));
    } catch {
      // Se sigue con la lista vacía.
    }
    const siguiente = cambiar(actual);
    setLista(siguiente);
    try {
      if (siguiente.length) s?.setItem(clave, JSON.stringify(siguiente));
      else s?.removeItem(clave);
    } catch {
      // Cuota o almacenamiento bloqueado: los recientes duran lo que la página.
    }
  }, [clave]);
  return {
    recientes: lista,
    anadir: (p: PerfilReciente) => escribir((l) => anadirReciente(l, p)),
    quitar: (id: string) => escribir((l) => quitarReciente(l, id)),
    borrar: () => escribir(() => []),
  };
}

/** Recorre con flechas los enlaces de perfil de `lista`; arriba del primero vuelve al campo. */
function moverFoco(lista: HTMLElement | null, entrada: HTMLInputElement | null, tecla: string, desde: Element | null) {
  if (!lista) return false;
  const enlaces = [...lista.querySelectorAll<HTMLElement>('[data-fila-perfil]')];
  if (enlaces.length === 0) return false;
  const i = desde ? enlaces.indexOf(desde as HTMLElement) : -1;
  if (tecla === 'ArrowDown') {
    enlaces[Math.min(i + 1, enlaces.length - 1)]?.focus();
    return true;
  }
  if (tecla === 'ArrowUp') {
    if (i <= 0) entrada?.focus();
    else enlaces[i - 1]?.focus();
    return true;
  }
  return false;
}

export type EstadoBuscadorSocial = {
  /** Texto con el que se piden perfiles en vivo, o `null` si no se piden. */
  vivo: string | null;
  /** Hay texto, pero aún no da para pedir (menos de tres letras). */
  corto: boolean;
};

/**
 * Qué enseña el buscador: perfiles en vivo cuando lo escrito sirve para
 * sugerir y no es ya la búsqueda de la URL (cuya lista completa pinta la
 * página); si no, el contenido de la página.
 */
export function estadoBuscador(escrito: string, qUrl: string): EstadoBuscadorSocial {
  const texto = escrito.replace(/\s+/g, ' ').trim();
  if (texto === qUrl.trim()) return { vivo: null, corto: false };
  const q = consultaSugerencias(texto);
  return q ? { vivo: texto, corto: false } : { vivo: null, corto: texto.length > 0 };
}

/**
 * Buscador de perfiles al estilo de una red social: una barra grande y, al
 * escribir, la lista de perfiles en vivo (los más parecidos y, entre ellos,
 * los más activos y recientes), cada uno con «Seguir». Intro o «Ver todos los
 * resultados» envían el formulario que lo contiene a la lista completa. Sin
 * texto enseña los recientes de este navegador y el contenido de la página.
 *
 * Teclado: flecha abajo pasa del campo a los perfiles, las flechas los
 * recorren e Intro abre el enfocado (es un enlace); Escape vuelve al campo.
 */
export function BuscadorSocial({
  valor,
  onChange,
  qUrl,
  volverDe,
  profileId,
  herramientas,
  avisoFiltros = false,
  pendiente = false,
  children,
}: {
  valor: string;
  onChange: (valor: string) => void;
  /** `q` de la URL: su lista completa ya está en la página. */
  qUrl: string;
  /** Dirección de la búsqueda completa a la que vuelve la ficha abierta desde aquí. */
  volverDe: (q: string) => string;
  profileId?: string;
  /** Botones bajo la barra (filtros). */
  herramientas?: React.ReactNode;
  /** Hay filtros que la lista en vivo no aplica. */
  avisoFiltros?: boolean;
  pendiente?: boolean;
  children?: React.ReactNode;
}) {
  const entrada = React.useRef<HTMLInputElement>(null);
  const lista = React.useRef<HTMLDivElement>(null);
  const [resultado, setResultado] = React.useState<EstadoSugerencias>({ estado: 'reposo', items: [] });
  const [vistos, setVistos] = React.useState<Sugerida[]>([]);
  const [solicitante] = React.useState(() => crearSolicitanteSugerencias(
    (e) => {
      setResultado(e);
      if (e.estado === 'ok') setVistos(e.items);
    },
    undefined,
    { limite: MAX_SUGERENCIAS_SOCIAL, espera: ESPERA_SOCIAL },
  ));
  const { recientes, anadir, quitar, borrar } = useRecientes(profileId);
  const { vivo, corto } = estadoBuscador(valor, qUrl);

  React.useEffect(() => {
    if (vivo) solicitante.buscar(vivo);
    else solicitante.cancelar();
    return solicitante.cancelar;
  }, [vivo, solicitante]);

  // Mientras llega la respuesta se dejan los perfiles anteriores: la lista no parpadea al escribir.
  const items = resultado.estado === 'ok' ? resultado.items
    : resultado.estado === 'cargando' ? vistos : [];
  const cargando = Boolean(vivo) && resultado.estado === 'cargando';
  const mensaje = !vivo ? (corto ? 'Escribe al menos tres letras para ver perfiles.' : '')
    : resultado.estado === 'cargando' && items.length === 0 ? 'Buscando perfiles…'
    : resultado.estado === 'error' ? 'Los perfiles no están disponibles ahora. Pulsa Intro para hacer la búsqueda completa.'
    : resultado.estado === 'ok' && items.length === 0 ? 'Ningún perfil se parece a ese nombre.'
    : items.length ? `${items.length} ${items.length === 1 ? 'perfil' : 'perfiles'}. Flecha abajo para recorrerlos.`
    : '';

  // Delegado en el contenedor: también cuenta las filas que pinta el servidor (sugerencias para seguir).
  const clicLista = (e: React.MouseEvent<HTMLDivElement>) => {
    const fila = (e.target as HTMLElement).closest?.<HTMLElement>('[data-fila-perfil]');
    const id = fila?.dataset.persona;
    if (!fila || !id) return;
    anadir({ id, nombre: fila.dataset.nombre ?? '', pais: fila.dataset.pais || null });
  };
  // En el contenedor y no en cada fila: también recorre las filas que pinta el servidor.
  const teclaLista = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const fila = (e.target as HTMLElement).closest?.('[data-fila-perfil]');
    if (!fila) return;
    if (e.key === 'Escape') { e.preventDefault(); entrada.current?.focus(); return; }
    if (moverFoco(lista.current, entrada.current, e.key, fila)) e.preventDefault();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative w-full lg:max-w-2xl">
        <label htmlFor="explorar-q" className="sr-only">Buscar tiradores</label>
        {cargando || pendiente ? (
          <LoaderCircle className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        )}
        <input
          ref={entrada}
          id="explorar-q"
          name="q"
          type="search"
          value={valor}
          maxLength={80}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Buscar tiradores"
          aria-controls="explorar-perfiles"
          aria-describedby="explorar-q-estado"
          className="h-12 min-h-12 w-full rounded-full border border-input bg-secondary pr-12 pl-12 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:appearance-none"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown' && moverFoco(lista.current, entrada.current, 'ArrowDown', null)) e.preventDefault();
            else if (e.key === 'Escape' && valor) { e.preventDefault(); onChange(''); }
          }}
        />
        {valor ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Borrar búsqueda"
            className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            onClick={() => { onChange(''); entrada.current?.focus(); }}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>

      {herramientas}

      <p id="explorar-q-estado" role="status" aria-live="polite" className={cn('px-1 text-sm text-muted-foreground', !corto && 'sr-only')}>
        {mensaje}
      </p>

      <div ref={lista} id="explorar-perfiles" className="min-w-0" onKeyDown={teclaLista} onClick={clicLista}>
        {vivo ? (
          <section aria-label={`Perfiles para «${vivo}»`} className="flex min-w-0 flex-col gap-1 lg:max-w-2xl">
            {items.length > 0 ? (
              <ul className={cn(CLASE_LISTA_PERFILES, cargando && 'opacity-80')}>
                {items.map((p) => (
                  <FilaPerfil
                    key={p.id}
                    p={p}
                    href={rutaFichaConRetorno(p.id, volverDe(vivo))}
                    accion={(
                      <BotonSeguirCompacto
                        personaId={p.id}
                        nombre={nombreVisible(p.nombre) || p.nombre}
                        inicial={Boolean(p.seguida)}
                        lectura={p}
                      />
                    )}
                  />
                ))}
              </ul>
            ) : resultado.estado === 'ok' || resultado.estado === 'error' ? (
              <p className="px-0.5 py-3 text-sm text-muted-foreground sm:px-3">{mensaje}</p>
            ) : (
              <ul aria-hidden="true" className={CLASE_LISTA_PERFILES}>
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="flex min-h-16 items-center gap-3 px-0.5 py-2 sm:px-3">
                    <span className="size-12 shrink-0 rounded-full bg-secondary" />
                    <span className="flex flex-1 flex-col gap-2">
                      <span className="h-3.5 w-2/5 rounded bg-secondary" />
                      <span className="h-3 w-3/5 rounded bg-secondary" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="submit"
              variant="ghost"
              className="h-auto min-h-12 w-full justify-between rounded-xl px-3 text-left whitespace-normal text-primary-text hover:text-primary-text"
            >
              <span>Ver todos los resultados de «{vivo}»</span>
              <ArrowRight aria-hidden />
            </Button>
            {avisoFiltros ? (
              <p className="px-3 text-xs text-muted-foreground">
                Estos perfiles son sólo por nombre: los filtros se aplican al ver todos los resultados.
              </p>
            ) : null}
          </section>
        ) : (
          <div className="flex min-w-0 flex-col gap-6">
            {valor.trim() === '' && recientes.length > 0 ? (
              <section aria-labelledby="explorar-recientes" className="flex min-w-0 flex-col gap-1 lg:max-w-2xl">
                <EncabezadoSeccion id="explorar-recientes" titulo="Recientes">
                  <Button type="button" variant="ghost" size="sm" className="text-primary-text hover:text-primary-text" onClick={borrar}>
                    Borrar todo
                  </Button>
                </EncabezadoSeccion>
                <ul className={CLASE_LISTA_PERFILES} aria-labelledby="explorar-recientes">
                  {recientes.map((p) => (
                    <FilaPerfil
                      key={p.id}
                      p={p}
                      accion={<BotonQuitarReciente nombre={nombreVisible(p.nombre) || p.nombre} onQuitar={() => quitar(p.id)} />}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
