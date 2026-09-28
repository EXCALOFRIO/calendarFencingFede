'use client';

import { Check, Loader2, Search, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { toast } from 'sonner';
import {
  buscarTiradorEnRanking,
  crearTiradorDesdeRanking,
} from '@/app/(app)/admin/usuarios/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Candidato } from '@/lib/altas/desde-ranking';
import { CATEGORY_LABEL, WEAPON_LABEL } from '@/lib/utils';

/**
 * ===========================================================================
 * DAR DE ALTA A UN TIRADOR BUSCÁNDOLO, NO TECLEÁNDOLO
 * ===========================================================================
 *
 * Aquí había seis campos: nombre, apellidos, fecha de nacimiento, género,
 * licencia RFEE y armas. Ya no hay ninguno. Se escribe un apellido, se elige
 * a la persona en la clasificación oficial y **todo lo demás sale de ahí**.
 * Lo único que queda por teclear es el correo, porque es el único dato que la
 * federación no publica.
 *
 * Petición literal: *«que rellene todo solo, vamos, que ni salga como campo»*.
 *
 * ---------------------------------------------------------------------------
 * NO ES COMODIDAD: LOS DATOS TECLEADOS SON PEORES
 * ---------------------------------------------------------------------------
 * La licencia es la clave con la que se emparejan los resultados. Una letra
 * mal y esa persona no recibe ni un punto de ranking, y nadie se entera hasta
 * que pregunte por qué no aparece, meses después. La fecha de nacimiento
 * decide su categoría, o sea en qué pruebas puede inscribirse. El club decide
 * con qué código se cruza.
 *
 * Los tres los publica la RFEE y los ingerimos cada noche. Copiarlos a mano
 * era añadir una oportunidad de equivocarse a un dato que ya teníamos bien.
 *
 * ---------------------------------------------------------------------------
 * Y NO ES EMPAREJAR POR NOMBRE, QUE ESTÁ PROHIBIDO
 * ---------------------------------------------------------------------------
 * El nombre solo **busca**. Quién es cada fila lo decide la persona que mira,
 * y por eso cada candidato enseña lo que distingue a dos homónimos: el año de
 * nacimiento, el club, las armas y el puesto. Lo que después sí se empareja
 * solo son sus otras clasificaciones, y eso va **por licencia**.
 *
 * ---------------------------------------------------------------------------
 * LA SALIDA DE EMERGENCIA
 * ---------------------------------------------------------------------------
 * Quien no está en el ranking no se puede dar de alta así, y existe: un M13
 * que empieza no tiene clasificación todavía. Para eso está el enlace de
 * abajo, que devuelve el formulario de antes. Va en pequeño y al final a
 * propósito, porque es el caso raro.
 */
export function AltaTiradorDesdeRanking({ aMano }: { aMano: () => void }) {
  const router = useRouter();
  const [escrito, setEscrito] = React.useState('');
  const [buscando, setBuscando] = React.useState(false);
  const [candidatos, setCandidatos] = React.useState<Candidato[] | null>(null);
  const [elegido, setElegido] = React.useState<Candidato | null>(null);
  const [email, setEmail] = React.useState('');
  const [ocupado, setOcupado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function buscar() {
    setBuscando(true);
    setError(null);
    setElegido(null);
    try {
      const r = await buscarTiradorEnRanking(escrito);
      if (r.ok) setCandidatos(r.candidatos);
      else {
        setCandidatos(null);
        setError(r.error);
      }
    } catch {
      setError('No se ha podido buscar. Vuelve a intentarlo.');
    } finally {
      setBuscando(false);
    }
  }

  async function darDeAlta() {
    if (!elegido) return;
    setOcupado(true);
    setError(null);

    const datos = new FormData();
    datos.set('clave', elegido.clave);
    datos.set('email', email);
    datos.set('nombre', elegido.nombre);

    try {
      const r = await crearTiradorDesdeRanking(datos);
      if (r.ok) {
        toast.success(r.message, { duration: 10000 });
        setEscrito('');
        setCandidatos(null);
        setElegido(null);
        setEmail('');
        router.refresh();
      } else {
        setError(r.error);
      }
    } catch {
      setError('No se ha podido dar de alta. Vuelve a intentarlo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="alta-buscar">Nombre o apellidos</Label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="alta-buscar"
              value={escrito}
              onChange={(e) => setEscrito(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void buscar();
                }
              }}
              placeholder="Zabala"
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => void buscar()}
            disabled={buscando || escrito.trim().length < 3}
          >
            {buscando ? <Loader2 className="animate-spin" /> : <Search />}
            Buscar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Se busca en la clasificación oficial de la RFEE. De ahí salen su licencia,
          su fecha de nacimiento, su club y sus armas, así que no hay que escribirlos.
        </p>
      </div>

      {error ? (
        <p className="medida flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}

      {candidatos !== null && candidatos.length === 0 ? (
        <p className="medida text-sm text-muted-foreground">
          Nadie casa con «{escrito}» en la clasificación de esta temporada. Comprueba
          el apellido, o dalo de alta a mano si todavía no tiene clasificación.
        </p>
      ) : null}

      {candidatos && candidatos.length > 0 && !elegido ? (
        <ul className="flex flex-col divide-y rounded-md border">
          {candidatos.map((c) => (
            <li key={c.clave} className="flex min-w-0 flex-col gap-2 p-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <p className="font-medium">{c.nombre}</p>
                <span className="text-xs text-muted-foreground">
                  «{c.nombreOficial}»
                </span>
              </div>

              <Datos candidato={c} />

              {c.yaVinculado ? (
                <p className="flex items-start gap-2 text-sm text-warn">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>Esta ficha ya está vinculada a una cuenta.</span>
                </p>
              ) : c.sinLicencia ? (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    La fuente no publica su licencia, y sin ella sus resultados no se
                    pueden emparejar. Hay que darlo de alta a mano.
                  </span>
                </p>
              ) : (
                <div>
                  <Button type="button" variant="outline" onClick={() => setElegido(c)}>
                    Es este
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {elegido ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{elegido.nombre}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setElegido(null)}
            >
              Cambiar
            </Button>
          </div>

          <Datos candidato={elegido} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alta-correo-tirador">Correo</Label>
            <Input
              id="alta-correo-tirador"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="juan@ejemplo.es"
            />
            <p className="text-xs text-muted-foreground">
              Lo único que la federación no publica. No se le manda ningún correo:
              entra escribiendo esta dirección en la pantalla de acceso.
            </p>
          </div>

          <div>
            <Button
              type="button"
              onClick={() => void darDeAlta()}
              disabled={ocupado || email.trim().length === 0}
            >
              {ocupado ? <Loader2 className="animate-spin" /> : <Check />}
              Dar de alta
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        ¿Todavía no tiene clasificación?{' '}
        <button
          type="button"
          onClick={aMano}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Darlo de alta a mano
        </button>
        .
      </p>
    </div>
  );
}

/**
 * Lo que distingue a dos homónimos, y nada más.
 *
 * El AÑO de nacimiento, no la fecha: para reconocer a alguien sobra el año, y
 * la fecha exacta de nacimiento de un menor no se pinta en una lista que sale
 * al escribir un apellido. La fecha completa sí se usa al dar de alta, pero
 * se resuelve en el servidor y no viaja hasta aquí.
 */
function Datos({ candidato }: { candidato: Candidato }) {
  const categorias = [
    ...new Set(candidato.clasificaciones.map((c) => c.categoria)),
  ];
  const mejor = candidato.clasificaciones.find((c) => c.puesto !== null)?.puesto ?? null;

  const datos: [string, string][] = [
    ['Nació en', String(candidato.anioNacimiento ?? 'no publicado')],
    [
      candidato.armas.length === 1 ? 'Arma' : 'Armas',
      candidato.armas.map((a) => WEAPON_LABEL[a]).join(', ') || 'no publicada',
    ],
    [
      categorias.length === 1 ? 'Categoría' : 'Categorías',
      categorias
        .map((k) => CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] ?? k)
        .join(', ') || 'no publicada',
    ],
    ['Club', candidato.club ?? 'no publicado'],
    ['Mejor puesto', mejor === null ? 'sin clasificar' : `${mejor}.º`],
  ];

  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {datos.map(([rotulo, valor]) => (
        <div key={rotulo} className="flex min-w-0 items-baseline gap-1.5">
          <dt className="text-xs text-muted-foreground">{rotulo}</dt>
          <dd className="min-w-0">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}
