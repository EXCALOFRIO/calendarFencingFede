'use client';

import { ArrowLeft, IdCard, Loader2, Search, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { ResultadoBusqueda, ResultadoVinculo } from '@/app/(app)/alta/acciones';
import { Rotulos } from '@/components/estado/piezas';
import { etiquetaGrupo, puntos } from '@/components/ranking/formato';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Candidato } from '@/lib/altas/desde-ranking';

type Buscar = (texto: string) => Promise<ResultadoBusqueda>;
type Vincular = (clave: string, licencia: string) => Promise<ResultadoVinculo>;

/**
 * «Búscate y confirma con tu licencia».
 *
 * Son dos pasos y solo dos, en la misma pantalla y sin submenús:
 *
 *   1. escribe su apellido o su licencia y se reconoce en la lista,
 *   2. teclea su número de licencia y la ficha queda colgada de su cuenta.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ HAY UN SEGUNDO PASO
 * -------------------------------------------------------------------------
 * Si bastara con el nombre, cualquiera podría reclamar la ficha de Carlos
 * Llavador —y con ella su puesto, sus convocatorias y sus inscripciones—. El
 * número de licencia lo lleva cada uno en su carné y la página pública del
 * ranking **no** lo publica, así que teclearlo es la prueba razonable de que la
 * fila es tuya. La pantalla lo dice con esas palabras, no como una advertencia
 * legal: quien lee «hace falta tu licencia porque el ranking no la publica»
 * entiende para qué sirve, y quien lee «por motivos de seguridad» no entiende
 * nada.
 *
 * Lo que la lista NO trae es la licencia de nadie. Si la trajera, el dato que
 * sirve de prueba viajaría al navegador de cualquiera que escriba un apellido.
 */
export function Buscador({
  buscar,
  vincular,
  nombreCuenta,
  esPersonal,
}: {
  buscar: Buscar;
  vincular: Vincular;
  nombreCuenta: string;
  /** La cuenta es de un tirador o de un tutor, no de la dirección técnica. */
  esPersonal: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = React.useState('');
  const [buscando, setBuscando] = React.useState(false);
  const [candidatos, setCandidatos] = React.useState<Candidato[] | null>(null);
  const [buscado, setBuscado] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [elegido, setElegido] = React.useState<Candidato | null>(null);

  async function lanzarBusqueda(evento: React.FormEvent) {
    evento.preventDefault();
    setBuscando(true);
    setError(null);
    setElegido(null);
    try {
      const resultado = await buscar(texto);
      if (!resultado.ok) {
        setError(resultado.error);
        setCandidatos(null);
        return;
      }
      setCandidatos(resultado.candidatos);
      setBuscado(texto.trim());
    } catch {
      setError(
        'La búsqueda no ha respondido. Vuelve a intentarlo en unos segundos.',
      );
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Vincula tu ficha</h1>
        <p className="text-sm text-muted-foreground">
          Desde el ranking oficial de la RFEE
        </p>
      </div>

      {/*
        Dos líneas, no siete.

        La primera versión explicaba aquí todo el porqué, y a 390 px eso
        empujaba el campo de búsqueda —que es a lo que se viene— por debajo del
        pliegue. El porqué de la licencia está donde hace falta: en el paso en
        el que se pide. Y cuando ya se ha elegido una ficha, esta introducción
        desaparece: ya no explica nada que no esté justo debajo.
      */}
      {elegido ? null : (
        <p className="medida text-sm text-muted-foreground">
          Tu cuenta ({nombreCuenta}) todavía no está unida a ninguna ficha, así
          que el calendario no sabe cuál es tu arma. Búscate en la clasificación
          oficial de la RFEE y confírmalo con tu licencia.
        </p>
      )}

      {elegido ? (
        <Confirmacion
          candidato={elegido}
          vincular={vincular}
          onVolver={() => setElegido(null)}
          onHecho={() => {
            /*
              La confirmación no se pinta aquí: se vuelve a `/alta`, que al ver
              que la cuenta ya tiene ficha enseña el puesto oficial leído de la
              base. Así lo que se ve al acabar y lo que se ve al volver mañana
              son exactamente lo mismo, sin dos versiones de la verdad.
            */
            router.replace('/alta?hecha=1');
            router.refresh();
          }}
        />
      ) : (
        <>
          <form
            onSubmit={lanzarBusqueda}
            className="flex flex-wrap items-end gap-2"
          >
            {/*
              El campo se topa a 22 rem.

              Sin tope, a 1440 px un campo para escribir un apellido medía 1.290
              px de ancho, con el botón perdido en la otra punta de la pantalla.
              Un dato corto pide un campo corto: así se lee que lo que se espera
              es un apellido, no un párrafo.
            */}
            <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5 sm:max-w-88">
              <Label htmlFor="buscar-tirador">Tu nombre o tu licencia</Label>
              <Input
                id="buscar-tirador"
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Apellido, o licencia completa"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={error !== null}
                aria-describedby={error ? 'error-busqueda' : undefined}
              />
            </div>
            <Button type="submit" variant="outline" disabled={buscando}>
              {buscando ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Search aria-hidden />
              )}
              Buscarme
            </Button>
          </form>

          {error ? (
            <p
              id="error-busqueda"
              role="alert"
              className="medida flex items-start gap-2 text-sm text-danger"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          ) : null}

          {candidatos !== null ? (
            <Resultados
              candidatos={candidatos}
              buscado={buscado}
              onElegir={setElegido}
            />
          ) : null}

          <NoApareces esPersonal={esPersonal} />
        </>
      )}
    </div>
  );
}

/** Lo que devolvió la búsqueda, o por qué no devolvió nada. */
function Resultados({
  candidatos,
  buscado,
  onElegir,
}: {
  candidatos: Candidato[];
  buscado: string;
  onElegir: (candidato: Candidato) => void;
}) {
  if (candidatos.length === 0) {
    return (
      <section className="flex min-w-0 flex-col">
        <div className="border-b pb-2">
          <h2 className="text-xl">Nadie en el ranking oficial encaja con eso</h2>
        </div>
        <p className="medida py-4 text-sm text-muted-foreground">
          Con «{buscado}» no aparece nadie en la clasificación de esta
          temporada. Prueba con un solo apellido, sin acentos, o con tu número de
          licencia completo. Y ten en cuenta que en el ranking solo están los que
          han competido esta temporada: si acabas de empezar, todavía no sales.
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <h2 className="text-xl">
          {candidatos.length === 1 ? 'Un resultado' : `${candidatos.length} resultados`}
        </h2>
        <p className="text-sm text-muted-foreground">
          {candidatos.length === 1
            ? 'Comprueba que es tu ficha antes de seguir'
            : 'Puede haber homónimos: mira el arma, el club y el año'}
        </p>
      </div>

      <ul className="flex flex-col divide-y">
        {candidatos.map((c) => (
          <li key={c.clave} className="flex min-w-0 flex-col gap-2.5 py-4">
            <p className="text-base font-medium">{c.nombre}</p>

            {/*
              Los datos que distinguen a dos homónimos, cada uno con su rótulo.
              Sin rótulo, «2008» y «CEEC-M» son dos cadenas sueltas y no ayudan
              a decidir nada.
            */}
            <Rotulos
              disposicion="linea"
              datos={[
                ['Nació en', c.anioNacimiento ?? 'no publicado'],
                ['Club', c.club ?? 'no publicado'],
              ]}
            />

            <ul className="flex flex-col gap-1">
              {c.clasificaciones.map((cl) => (
                <li
                  key={`${cl.arma}-${cl.genero}-${cl.categoriaOriginal}`}
                  className="flex items-baseline gap-2"
                >
                  <span className="cifra shrink-0 text-xl">
                    {cl.puesto ? `${cl.puesto}.º` : '—'}
                  </span>
                  <span className="min-w-0 text-xs text-muted-foreground">
                    <span className="text-foreground">
                      {etiquetaGrupo({
                        weapon: cl.arma,
                        gender: cl.genero,
                        category: cl.categoria,
                      })}
                    </span>
                    {cl.puesto === null
                      ? ', todavía sin clasificar'
                      : cl.puntos === null
                        ? ', sin puntos publicados'
                        : `, con ${puntos(cl.puntos)} puntos`}
                  </span>
                </li>
              ))}
            </ul>

            {c.yaVinculado ? (
              <p className="medida flex items-start gap-2 text-sm text-warn">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  Esta ficha ya está vinculada a una cuenta. Si es la tuya, entra
                  con ella; si no lo es, escribe a la dirección técnica para que
                  lo revise.
                </span>
              </p>
            ) : c.sinLicencia ? (
              <p className="medida flex items-start gap-2 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  De esta fila todavía no tenemos el número de licencia, así que
                  no hay nada con lo que comprobar que eres tú. Pídele la
                  vinculación a la dirección técnica.
                </span>
              </p>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => onElegir(c)}
              >
                <IdCard aria-hidden />
                Soy yo
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * El segundo paso: la licencia.
 *
 * Es la única acción principal de la pantalla y por eso se queda sola: al
 * elegir una ficha, la lista desaparece. A 390 px, una lista de seis
 * resultados con un campo de licencia abierto en el cuarto obliga a
 * desplazarse para encontrar el botón.
 */
function Confirmacion({
  candidato,
  vincular,
  onVolver,
  onHecho,
}: {
  candidato: Candidato;
  vincular: Vincular;
  onVolver: () => void;
  onHecho: () => void;
}) {
  const [licencia, setLicencia] = React.useState('');
  const [enviando, setEnviando] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const resultado = await vincular(candidato.clave, licencia);
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      onHecho();
    } catch {
      setError(
        'No se ha podido vincular la ficha. Vuelve a intentarlo en unos ' +
          'segundos; si sigue fallando, avisa a la dirección técnica.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border-t border-filete bg-card px-4 py-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl">Confirma que eres tú</h2>
        <p className="medida text-sm text-muted-foreground">
          La página del ranking publica el nombre, el club y el puesto, pero no
          la licencia. Escribiéndola demuestras que esta ficha es tuya y no la de
          alguien que se llama igual. La tienes en tu carné de la RFEE.
        </p>
      </div>

      <Rotulos
        datos={[
          ['Vas a vincular', candidato.nombre],
          ['Nació en', candidato.anioNacimiento ?? 'no publicado'],
          ['Club', candidato.club ?? 'no publicado'],
          [
            candidato.clasificaciones.length === 1
              ? 'Clasificación'
              : 'Clasificaciones',
            candidato.clasificaciones
              .map((cl) =>
                etiquetaGrupo({
                  weapon: cl.arma,
                  gender: cl.genero,
                  category: cl.categoria,
                }),
              )
              .join(', '),
          ],
        ]}
      />

      <form onSubmit={enviar} className="flex flex-col gap-3">
        <div className="flex max-w-64 flex-col gap-1.5">
          <Label htmlFor="licencia">Tu número de licencia RFEE</Label>
          <Input
            id="licencia"
            value={licencia}
            /*
              Al corregir, el aviso se va: dejar el campo en rojo mientras se
              teclea la licencia buena es reñir por un error ya enmendado.
            */
            onChange={(e) => {
              setLicencia(e.target.value.toUpperCase());
              if (error) setError(null);
            }}
            placeholder="ABC01234"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="cifra tracking-wider"
            aria-invalid={error !== null}
            aria-describedby={error ? 'error-licencia' : undefined}
          />
        </div>

        {error ? (
          <p
            id="error-licencia"
            role="alert"
            className="medida flex items-start gap-2 text-sm text-danger"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={enviando || licencia.trim().length === 0}>
            {enviando ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Vincular mi ficha
          </Button>
          <Button type="button" variant="ghost" onClick={onVolver}>
            <ArrowLeft aria-hidden />
            Elegir otra
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * La vía muerta que hay que evitar.
 *
 * Mucha gente no está en el ranking: un M13 que empieza, alguien que no ha
 * puntuado esta temporada. Si la pantalla solo sabe buscar, esas personas se
 * quedan mirándola sin saber qué hacer, y son justo las que más ayuda
 * necesitan.
 */
function NoApareces({ esPersonal }: { esPersonal: boolean }) {
  return (
    /*
      Calladito y al final.

      Empezó siendo una sección con titular, dos párrafos y un botón, y a 390 px
      pesaba lo mismo que la acción principal antes de haber buscado nada. Se
      queda lo que cambia una decisión: por qué puede que no aparezcas y a quién
      pedírselo. El calendario ya está en la barra de abajo.
    */
    /*
      El filete va en el contenedor y el texto dentro con `medida`: si el
      `border-t` lo lleva el propio párrafo limitado a 68 caracteres, a 1440 px
      queda una raya a media pantalla con pinta de errata.
    */
    <div className="border-t pt-4">
      <p className="medida text-xs text-muted-foreground">
        ¿No te encuentras? En el ranking oficial solo están los que han
        competido esta temporada, así que es normal no salir si empiezas en M13
        o no has puntuado todavía. Pídele a la dirección técnica que te cree la
        ficha; en cuanto la tengas, esta pantalla te enseñará tus datos.
        {esPersonal
          ? ' Mientras tanto el calendario funciona, aunque sin filtrar por tu arma.'
          : ''}
      </p>
    </div>
  );
}
