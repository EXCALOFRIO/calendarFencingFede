'use client';

import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { crearConvocatoria } from '@/lib/callups/actions';
import type { EventoConvocable } from '@/lib/callups/tipos';
import { cn, formatDateEs, formatDateRangeEs, titular } from '@/lib/utils';

/**
 * Crear la convocatoria.
 *
 * Sale SIEMPRE en borrador. Publicar es lo que dispara los correos a las
 * familias, y un correo no se puede recoger: primero se elige el evento y se
 * sube el PDF, después se elige a quién se convoca, y solo entonces se
 * publica.
 */
export function NuevaConvocatoria({ eventos }: { eventos: EventoConvocable[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = React.useState(false);
  const [buscador, setBuscador] = React.useState(false);
  const [eventId, setEventId] = React.useState('');
  const [titulo, setTitulo] = React.useState('');
  const [texto, setTexto] = React.useState('');
  const [viaje, setViaje] = React.useState('');
  const [plazo, setPlazo] = React.useState('');
  const [pdf, setPdf] = React.useState<File | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const evento = eventos.find((e) => e.id === eventId) ?? null;
  const opcionesPlazo = evento ? plazosPosibles(evento.startDate) : [];

  function elegirEvento(e: EventoConvocable) {
    setEventId(e.id);
    setBuscador(false);
    // El título se propone; se puede cambiar. Escribirlo a mano cada vez es
    // la clase de fricción que hace que la gente acabe usando el correo.
    if (!titulo) setTitulo(`Convocatoria · ${titular(e.name)}`);
    setPlazo('');
  }

  async function enviar() {
    setEnviando(true);
    setError(null);

    const datos = new FormData();
    datos.set('eventId', eventId);
    datos.set('title', titulo);
    datos.set('body', texto);
    datos.set('travelNotes', viaje);
    datos.set('respondBy', plazo === SIN_PLAZO ? '' : plazo);
    if (pdf) datos.set('pdf', pdf);

    const r = await crearConvocatoria(datos);
    setEnviando(false);

    if (!r.ok) return setError(r.error);

    setAbierto(false);
    setEventId('');
    setTitulo('');
    setTexto('');
    setViaje('');
    setPlazo('');
    setPdf(null);
    router.refresh();
  }

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger asChild>
        {/*
          En contorno, no en relleno carmesí.

          En esta pantalla la acción consecuente es «Publicar y avisar»: se
          manda un correo a diez personas y un aviso no se recoge. Crear un
          borrador no tiene consecuencias, así que no puede pedir la misma
          atención. Una acción principal por pantalla.
        */}
        <Button variant="outline" className="cursor-pointer">
          <Plus aria-hidden />
          Nueva convocatoria
        </Button>
      </SheetTrigger>

      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="pr-10">Nueva convocatoria</SheetTitle>
          <SheetDescription className="medida pr-10">
            Se crea en borrador. Nadie recibe nada hasta que elijas a los convocados
            y pulses publicar.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-10">
          {/* Evento. Hay cientos en el calendario, así que se busca. */}
          <div className="flex flex-col gap-2">
            <Label>Competición</Label>
            <Popover open={buscador} onOpenChange={setBuscador}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={buscador}
                  className="h-auto w-full cursor-pointer justify-between py-2 text-left font-normal"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {evento ? titular(evento.name) : 'Busca la competición'}
                  </span>
                  <ChevronsUpDown className="opacity-50" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Nombre de la competición…" />
                  <CommandList>
                    <CommandEmpty>
                      Ninguna competición futura con ese nombre.
                    </CommandEmpty>
                    <CommandGroup>
                      {eventos.map((e) => (
                        <CommandItem
                          key={e.id}
                          value={`${e.name} ${e.city ?? ''}`}
                          onSelect={() => elegirEvento(e)}
                          className="cursor-pointer"
                        >
                          <Check
                            className={cn(
                              'size-4',
                              e.id === eventId ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0">
                            <span className="block truncate">{titular(e.name)}</span>
                            <span className="block text-xs text-muted-foreground">
                              {formatDateRangeEs(e.startDate, e.endDate)}
                              {e.city ? ` · ${titular(e.city)}` : ''} · {e.competitions.length}{' '}
                              {e.competitions.length === 1 ? 'prueba' : 'pruebas'}
                            </span>
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {evento ? (
              <p className="text-xs text-muted-foreground">
                {formatDateRangeEs(evento.startDate, evento.endDate)}
                {evento.city ? ` · ${titular(evento.city)}` : ''}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="titulo-convocatoria">Título</Label>
            <Input
              id="titulo-convocatoria"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Convocatoria · Campeonato de Europa Cadete"
            />
          </div>

          {/*
            El plazo se elige entre fechas calculadas sobre el comienzo de la
            competición, no se teclea. Así no hay campos de fecha nativos (que
            el contrato de interfaz prohíbe) y, sobre todo, no se puede fijar
            un plazo posterior al viaje por un error al escribir.
          */}
          <div className="flex flex-col gap-2">
            <Label>Plazo para responder</Label>
            <Select value={plazo} onValueChange={setPlazo} disabled={!evento}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    evento ? 'Elige el plazo' : 'Elige antes la competición'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {opcionesPlazo.map((o) => (
                  <SelectItem key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Sin plazo, la convocatoria se publica igual y en la tarjeta del
              tirador aparece «sin plazo fijado».
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="texto-convocatoria">Texto de la convocatoria</Label>
            <Textarea
              id="texto-convocatoria"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={4}
              placeholder="Concentración previa el jueves en el CAR. Uniformidad oficial."
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="viaje-convocatoria">Notas de viaje</Label>
            <Textarea
              id="viaje-convocatoria"
              value={viaje}
              onChange={(e) => setViaje(e.target.value)}
              rows={3}
              placeholder="Vuelo de ida el 12 a las 07:20 desde Madrid. Traslado desde el aeropuerto incluido."
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pdf-convocatoria">Convocatoria en PDF</Label>
            <Input
              id="pdf-convocatoria"
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">
              Opcional. Es el documento oficial que firma la dirección técnica; si
              no hay almacenamiento configurado, el servidor lo dirá al guardar.
            </p>
          </div>

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            onClick={enviar}
            disabled={enviando || !eventId || titulo.trim().length < 3}
            className="cursor-pointer"
          >
            {enviando ? 'Creando…' : 'Crear el borrador'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Valor del desplegable que significa "no fijar plazo". */
const SIN_PLAZO = 'sin-plazo';

/**
 * Plazos posibles, contados hacia atrás desde el comienzo de la competición y
 * siempre a las 23:59 hora de Madrid, que es justo lo que espera
 * `parseFechaMadrid`. Se descartan los que ya habrían pasado.
 *
 * La cuenta se hace sobre la CADENA de fecha, no sobre un `Date`: construir
 * un `Date` y restarle días mete el huso horario por medio y un plazo puesto
 * a las 23:59 acaba mostrándose como la 01:59 del día siguiente.
 */
function plazosPosibles(inicio: string): { valor: string; etiqueta: string }[] {
  const dias = [30, 21, 14, 10, 7, 5, 3];
  const hoy = new Date().toISOString().slice(0, 10);

  const opciones = dias
    .map((d) => ({ d, iso: restarDias(inicio.slice(0, 10), d) }))
    .filter((o) => o.iso >= hoy)
    .map((o) => ({
      valor: `${o.iso}T23:59`,
      etiqueta: `${o.d} días antes · ${formatDateEs(o.iso)}, 23:59`,
    }));

  return [...opciones, { valor: SIN_PLAZO, etiqueta: 'Sin plazo de respuesta' }];
}

/** `YYYY-MM-DD` menos N días, en `YYYY-MM-DD`, sin husos de por medio. */
function restarDias(iso: string, dias: number): string {
  const base = new Date(`${iso}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - dias);
  return base.toISOString().slice(0, 10);
}
