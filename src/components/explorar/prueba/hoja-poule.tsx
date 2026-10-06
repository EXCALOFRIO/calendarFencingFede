'use client';

import { Grid3x3 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { PouleDePrueba } from '@/lib/sport/explorar/tipos-busqueda';
import { nombreVisible, partesNombre } from '@/lib/sport/nombre-visible';
import { cn } from '@/lib/utils';
import type { EnlaceFicha } from './enlaces';
import { puestosPoule, resaltado, type Filtro } from './logica';

const firma = (n: number) => (n > 0 ? `+${n}` : String(n));

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i', 'da', 'do', 'dos', 'di', 'van', 'von', 'der', 'den', 'du', 'le', 'san', 'santa']);

/**
 * Sólo el primer apellido («Zabala» de «ZABALA GUTIERREZ Juan»), con sus
 * partículas («De la Fuente», «San Martin»). Si la fuente no separa apellidos
 * y nombre no se sabe cuál es el apellido y va el nombre visible entero.
 */
export function apellidoPoule(publicado: string): string {
  const { nombre, apellidos } = partesNombre(publicado);
  if (!nombre || !apellidos) return nombreVisible(publicado);
  const palabras = nombreVisible(apellidos).split(' ');
  const fin = palabras.findIndex((p) => !PARTICULAS.has(p.toLocaleLowerCase('es')));
  return palabras.slice(0, fin < 0 ? palabras.length : fin + 1).join(' ');
}

/*
 * Anchos de columna en px y no en rem: en móvil la raíz sube a 18 px y en rem
 * no cabría. Así, con 7 tiradores la matriz entera cabe en 393 px. Los totales
 * van fijos a la derecha y su `right` es la suma de los que tienen a su derecha.
 */
const CASILLA = 28;
const NOMBRE_MIN = 80;
const NOMBRE_MAX = 160;
const TOTALES = [
  { clave: 'V', titulo: 'Victorias', ancho: 20 },
  { clave: 'TD', titulo: 'Tocados dados', ancho: 22 },
  { clave: 'TR', titulo: 'Tocados recibidos', ancho: 22 },
  { clave: 'Ind', titulo: 'Índice (TD − TR)', ancho: 26 },
  { clave: 'Pto', titulo: 'Puesto en la poule', ancho: 24 },
] as const;
const ANCHO_TOTALES = TOTALES.reduce((s, t) => s + t.ancho, 0);
const DERECHA = TOTALES.map((_, k) => TOTALES.slice(k + 1).reduce((s, t) => s + t.ancho, 0));

/** Casillas fijas: opacas para que las del centro pasen por debajo al desplazar. */
const FIJA_IZQUIERDA = 'sticky left-0 z-[1] bg-popover';
const FIJA_DERECHA = 'sticky z-[1] bg-popover';

/**
 * La matriz completa de una poule para la hoja de móvil: casillas V5 / D3,
 * apellidos fijos a la izquierda y totales (V, TD, TR, índice y puesto) fijos
 * a la derecha. Si no cabe, sólo se desplazan las casillas de los asaltos; la
 * persona resaltada lo está en su fila y en su columna.
 */
export function MatrizPoule({ poule, enlace, filtro }: { poule: PouleDePrueba; enlace?: EnlaceFicha; filtro: Filtro }) {
  const puestos = puestosPoule(poule.filas);
  const marcadas = poule.filas.map((f) => resaltado(f, filtro));
  const fijas = poule.filas.length * CASILLA + ANCHO_TOTALES;
  const totalFijo = (k: number, fila?: boolean) => ({
    className: cn(FIJA_DERECHA, 'border-b px-0 text-center', k === 0 && 'border-l', fila && 'bg-marcado'),
    style: { right: DERECHA[k] },
  });
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain" data-matriz-poule="">
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: fijas + NOMBRE_MIN, maxWidth: fijas + NOMBRE_MAX }}
      >
        <caption className="sr-only">
          {poule.etiqueta}: tantos de cada fila contra cada columna. V, victoria; D, derrota.
        </caption>
        <colgroup>
          <col />
          {poule.filas.map((f) => (
            <col key={f.clave} style={{ width: CASILLA }} />
          ))}
          {TOTALES.map((t) => (
            <col key={t.clave} style={{ width: t.ancho }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-[2] bg-popover text-[0.6875rem] text-muted-foreground">
          <tr>
            <th scope="col" className={cn(FIJA_IZQUIERDA, 'z-[3] border-b py-2 pr-1 pl-1.5 text-left font-medium')}>
              <span className="sr-only">Tirador</span>
            </th>
            {poule.filas.map((f, j) => (
              <th
                key={f.clave}
                scope="col"
                className={cn('border-b py-2 text-center font-medium', marcadas[j] && 'bg-marcado text-primary-text')}
              >
                <span className="sr-only">Contra el </span>
                {j + 1}
              </th>
            ))}
            {TOTALES.map((t, k) => {
              const fija = totalFijo(k);
              return (
                <th key={t.clave} scope="col" className={cn(fija.className, 'z-[3] py-2 font-medium')} style={fija.style}>
                  <abbr title={t.titulo} className="no-underline">{t.clave}</abbr>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {poule.filas.map((f, i) => {
            const fila = marcadas[i];
            const completo = nombreVisible(f.nombre);
            const apellido = apellidoPoule(f.nombre);
            const valores = [
              { texto: f.victorias, clase: 'font-semibold' },
              { texto: f.tocados },
              { texto: f.recibidos, clase: 'text-muted-foreground' },
              { texto: firma(f.tocados - f.recibidos) },
              { texto: `${puestos[i]}º`, clase: 'font-semibold' },
            ];
            return (
              <tr key={f.clave} data-resaltado={fila ? 'true' : undefined} className={cn(fila && 'bg-marcado')}>
                <th scope="row" className={cn(FIJA_IZQUIERDA, 'h-[44px] border-b p-0 text-left font-normal', fila && 'bg-marcado')}>
                  {/* El enlace ocupa la casilla entera: la fila mide lo mismo que un toque, 44 px (en px: `h-11` serían 49,5 con la raíz de 18 px). */}
                  {f.personaId && enlace ? (
                    <Link
                      href={enlace(f.personaId)}
                      prefetch={false}
                      title={completo}
                      aria-label={`Ficha de ${completo}`}
                      className="flex min-h-[44px] min-w-0 items-center gap-1 rounded-sm pr-1 pl-1.5 text-[0.8125rem] font-medium underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
                    >
                      <span className="cifra w-3 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 truncate">{apellido}</span>
                    </Link>
                  ) : (
                    <span title={completo} className="flex min-h-[44px] min-w-0 items-center gap-1 pr-1 pl-1.5 text-[0.8125rem] font-medium">
                      <span className="cifra w-3 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 truncate">{apellido}</span>
                      <span className="sr-only">: {completo}</span>
                    </span>
                  )}
                </th>
                {f.celdas.map((c, j) => {
                  const propia = i === j;
                  return (
                    <td
                      key={j}
                      className={cn(
                        'cifra border-b border-l px-0 text-center text-xs',
                        propia ? 'bg-muted' : marcadas[j] && !fila ? 'bg-marcado' : null,
                        c ? (c.victoria ? 'font-semibold text-ok' : 'text-danger') : 'text-muted-foreground',
                      )}
                    >
                      {propia ? <span className="sr-only">—</span> : c ? `${c.victoria ? 'V' : 'D'}${c.tantos}` : '·'}
                    </td>
                  );
                })}
                {valores.map((v, k) => {
                  const fija = totalFijo(k, fila);
                  return (
                    <td key={TOTALES[k].clave} className={cn(fija.className, 'cifra text-[0.8125rem]', v.clase)} style={fija.style}>
                      {v.texto}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Botón que abre la poule a pantalla completa en el móvil. Su `::after` cubre
 * la tarjeta entera (que es `relative`), así que tocar cualquier parte de la
 * lista la abre; los enlaces de los nombres quedan por encima. La hoja apila
 * una entrada en el historial para que «atrás» la cierre en vez de salir.
 */
export function HojaPoule({
  poule,
  enlace,
  filtro,
  className,
}: {
  poule: PouleDePrueba;
  enlace?: EnlaceFicha;
  filtro: Filtro;
  className?: string;
}) {
  const [abierta, setAbierta] = useState(false);
  const apilada = useRef(false);

  useEffect(() => {
    if (!abierta) return;
    const alVolver = () => {
      apilada.current = false;
      setAbierta(false);
    };
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, [abierta]);

  function cambiar(abrir: boolean) {
    if (abrir) {
      window.history.pushState({ ...(window.history.state ?? {}), hojaPoule: poule.ronda }, '');
      apilada.current = true;
      setAbierta(true);
      return;
    }
    setAbierta(false);
    if (apilada.current) {
      apilada.current = false;
      window.history.back();
    }
  }

  return (
    <Sheet open={abierta} onOpenChange={cambiar}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Abrir la matriz de ${poule.etiqueta}`}
          className={cn(
            "h-8 min-h-8 gap-1.5 rounded-full px-3 text-xs after:absolute after:inset-0 after:content-['']",
            className,
          )}
        >
          <Grid3x3 aria-hidden />
          Matriz
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="inset-0 h-dvh max-h-dvh gap-0 border-t-0"
      >
        <SheetHeader className="flex-row items-center gap-2 border-b py-3 pr-16 pl-3">
          <SheetTitle className="min-w-0 truncate text-lg leading-tight">{poule.etiqueta}</SheetTitle>
          <span className="text-xs text-muted-foreground">{poule.filas.length}</span>
        </SheetHeader>
        <MatrizPoule poule={poule} enlace={enlace} filtro={filtro} />
      </SheetContent>
    </Sheet>
  );
}
