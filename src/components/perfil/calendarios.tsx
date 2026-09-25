'use client';

import { Check, ChevronDown, Copy, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export type FeedVista = {
  tipo: string;
  nombre: string;
  descripcion: string;
  url: string;
  webcal: string;
};

/**
 * Suscripción al calendario.
 *
 * Se dan las dos formas porque fallan por motivos distintos: en el iPhone el
 * enlace `webcal:` abre el diálogo de suscripción y deja el calendario vivo,
 * mientras que descargar el `.ics` a mano deja una copia congelada que nunca
 * se entera de un cambio de fecha. En Google Calendar, en cambio, no hay
 * diálogo: hay que pegar la dirección, así que se puede copiar.
 */
/** Un calendario: qué trae, su dirección y las dos formas de suscribirlo. */
function Fila({
  feed,
  copiado,
  onCopiar,
}: {
  feed: FeedVista;
  copiado: boolean;
  onCopiar: (feed: FeedVista) => void;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-2 py-3">
      <div>
        <p className="text-sm font-medium">{feed.nombre}</p>
        <p className="medida text-sm text-muted-foreground">
          {feed.descripcion}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`url-${feed.tipo}`}
          readOnly
          value={feed.url}
          aria-label={`Dirección de ${feed.nombre}`}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 min-w-0 flex-1 basis-56 font-mono text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCopiar(feed)}
          aria-label={`Copiar la dirección de ${feed.nombre}`}
        >
          {copiado ? <Check /> : <Copy />}
          {copiado ? 'Copiada' : 'Copiar'}
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={feed.webcal}>Suscribir</a>
        </Button>
      </div>
    </div>
  );
}

export function Calendarios({
  feeds,
  revocar,
}: {
  feeds: FeedVista[];
  revocar: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const principal = feeds.find((f) => f.tipo === 'todo') ?? feeds[0] ?? null;
  const resto = feeds.filter((f) => f.tipo !== principal?.tipo);
  const [copiado, setCopiado] = React.useState<string | null>(null);
  const [revocando, empezar] = React.useTransition();
  const [aviso, setAviso] = React.useState<string | null>(null);

  const copiar = async (feed: FeedVista) => {
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopiado(feed.tipo);
      setTimeout(() => setCopiado((c) => (c === feed.tipo ? null : c)), 2500);
    } catch {
      // Sin permiso de portapapeles (o en http): se selecciona para que la
      // persona pueda copiar a mano en vez de quedarse sin salida.
      document.getElementById(`url-${feed.tipo}`)?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="medida text-sm text-muted-foreground">
        En el iPhone, toca «Suscribir»: se abre el diálogo del calendario y solo
        tienes que aceptar. En Google Calendar, desde el ordenador, copia la
        dirección y pégala en «Otros calendarios», el «+», «Desde URL».
      </p>

      {principal ? (
        <Fila
          feed={principal}
          copiado={copiado === principal.tipo}
          onCopiar={copiar}
        />
      ) : null}

      {/*
        Los calendarios por ámbito van plegados: casi todo el mundo quiere el
        suyo entero, y cinco direcciones seguidas convierten esta pantalla en
        una lista de enlaces.
      */}
      {resto.length > 0 ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-fit">
              <ChevronDown />
              Suscribir solo una parte del calendario
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col divide-y">
              {resto.map((feed) => (
                <li key={feed.tipo}>
                  <Fila
                    feed={feed}
                    copiado={copiado === feed.tipo}
                    onCopiar={copiar}
                  />
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      <div className="flex flex-col items-start gap-3">
        <p className="medida flex items-start gap-2 text-sm text-warn">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Estas direcciones son personales: quien tenga una ve tus
            competiciones sin necesidad de entrar. No las publiques. Si se te
            escapa alguna, revócalas y se generan otras.
          </span>
        </p>

        {aviso ? <p className="medida text-sm">{aviso}</p> : null}

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              Revocar las direcciones
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revocar las direcciones del calendario</DialogTitle>
              <DialogDescription>
                Se generan direcciones nuevas y las de ahora dejan de funcionar
                al momento. Los calendarios que ya tengas suscritos en el móvil
                se quedarán vacíos hasta que los vuelvas a suscribir con la
                dirección nueva.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Dejarlo como está</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="destructive"
                  disabled={revocando}
                  onClick={() =>
                    empezar(async () => {
                      const r = await revocar();
                      setAviso(r.ok ? r.message : r.error);
                      router.refresh();
                    })
                  }
                >
                  {revocando ? 'Revocando…' : 'Revocar y generar otras'}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
