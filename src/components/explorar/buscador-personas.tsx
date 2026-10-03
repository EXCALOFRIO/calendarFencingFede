'use client';

import { Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { crearSolicitanteSugerencias, siguienteOpcion, type EstadoSugerencias } from '@/lib/sport/explorar/sugerencias-cliente';
import { rutaFicha } from '@/lib/sport/explorar/url';
import { GENDER_LABEL } from '@/lib/utils';

export function BuscadorPersonas({ valor, onChange }: { valor: string; onChange: (valor: string) => void }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const lista = React.useRef<HTMLUListElement>(null);
  const [foco, setFoco] = React.useState(false);
  const [cerrado, setCerrado] = React.useState(false);
  const [activo, setActivo] = React.useState(-1);
  const [resultado, setResultado] = React.useState<EstadoSugerencias>({ estado: 'reposo', items: [] });
  const [solicitante] = React.useState(() => crearSolicitanteSugerencias(setResultado));
  const abierto = foco && !cerrado && resultado.items.length > 0;

  React.useEffect(() => {
    setActivo(-1);
    if (foco && !cerrado) solicitante.buscar(valor);
    else solicitante.cancelar();
    return solicitante.cancelar;
  }, [valor, foco, cerrado, solicitante]);

  React.useEffect(() => {
    if (abierto && activo >= 0) {
      lista.current?.querySelector<HTMLElement>(`#explorar-sugerencia-${activo}`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [abierto, activo]);

  const cerrar = () => { solicitante.cancelar(); setCerrado(true); setActivo(-1); };
  const elegir = (indice: number) => {
    const persona = resultado.items[indice];
    if (!persona) return;
    cerrar();
    router.push(rutaFicha(persona.id));
  };
  const mensaje = !foco || cerrado ? ''
    : resultado.estado === 'cargando' ? 'Buscando nombres parecidos…'
    : resultado.estado === 'error' ? 'Las sugerencias no están disponibles. Puedes pulsar Buscar.'
    : resultado.estado === 'ok' && resultado.items.length === 0 ? 'No hay sugerencias. Puedes pulsar Buscar.'
    : resultado.items.length ? `${resultado.items.length} sugerencias. Usa las flechas y Intro para abrir una ficha.`
    : '';

  return (
    <div className="col-span-2 flex min-w-0 flex-col gap-1.5 md:col-span-1">
      <Label htmlFor="explorar-q">Nombre o alias</Label>
      <div className="relative" onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) { setFoco(false); solicitante.cancelar(); }
      }}>
        <Search className="pointer-events-none absolute top-5.5 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={input} id="explorar-q" name="q" type="search" role="combobox"
          aria-autocomplete="list" aria-expanded={abierto} aria-controls="explorar-sugerencias"
          aria-activedescendant={abierto && activo >= 0 ? `explorar-sugerencia-${activo}` : undefined}
          aria-describedby="explorar-q-ayuda explorar-q-estado"
          value={valor} maxLength={80} autoComplete="off" placeholder="Apellido, nombre o alias"
          className="min-h-11 bg-secondary pr-12 pl-8"
          onFocus={() => { setFoco(true); setCerrado(false); }}
          onChange={(e) => {
            // La versión cambia en el evento, antes de que una promesa antigua
            // pueda responder entre el evento y el siguiente efecto.
            solicitante.cancelar();
            setResultado({ estado: 'reposo', items: [] });
            setCerrado(false);
            onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') { if (abierto) e.preventDefault(); cerrar(); }
            else if (abierto && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault(); setActivo(siguienteOpcion(e.key, activo, resultado.items.length));
            } else if (abierto && e.key === 'Enter' && activo >= 0) {
              e.preventDefault(); elegir(activo);
            } else if (e.key === 'Enter') cerrar();
          }}
        />
        {valor ? (
          <Button type="button" variant="ghost" size="icon" aria-label="Borrar nombre"
            className="absolute top-0 right-0 min-h-11 min-w-11"
            onClick={() => {
              solicitante.cancelar(); setResultado({ estado: 'reposo', items: [] });
              setActivo(-1); setCerrado(false); onChange(''); input.current?.focus();
            }}>
            <X aria-hidden />
          </Button>
        ) : null}
        {abierto ? (
          <ul ref={lista} id="explorar-sugerencias" role="listbox" aria-label="Fichas con nombres parecidos"
            className="absolute top-full right-0 left-0 z-30 mt-1 max-h-96 overflow-y-auto rounded-md border bg-popover text-popover-foreground">
            {resultado.items.map((p, i) => (
              <li key={p.id} role="presentation">
                <Button type="button" variant="ghost" tabIndex={-1}
                  id={`explorar-sugerencia-${i}`} role="option" aria-selected={activo === i}
                  className={`h-auto min-h-11 w-full justify-start rounded-none border-b px-3 py-2 text-left whitespace-normal ${activo === i ? 'bg-accent text-accent-foreground' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(i)}>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="break-words font-medium">{p.nombre}</span>
                    <span className="text-xs text-muted-foreground">
                      País: {p.pais ?? 'no publicado'}. Género: {p.genero ? GENDER_LABEL[p.genero] : 'no publicado'}.
                      {' '}Año de nacimiento: {p.anioNacimiento ?? 'no publicado'}.
                    </span>
                    {p.alias ? <span className="text-xs text-muted-foreground">Publicado también como {p.alias}</span> : null}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p id="explorar-q-ayuda" className="text-xs text-muted-foreground">
        Nombres parecidos para abrir una ficha, no una confirmación de identidad.
      </p>
      <p id="explorar-q-estado" role="status" aria-live="polite" className="text-xs text-muted-foreground">{mensaje}</p>
    </div>
  );
}
