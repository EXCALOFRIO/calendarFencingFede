import { LogOut } from 'lucide-react';
import { salir } from '../salir';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Suspense } from 'react';
import { Seccion } from '@/components/estado/piezas';
import { EnlaceFavoritos } from '@/components/explorar/favoritos';
import { Calendarios, type FeedVista } from '@/components/perfil/calendarios';
import { HistorialPropio } from '@/components/perfil/historial-propio';
import { Dato, FichaTirador } from '@/components/perfil/tirador';
import { Button } from '@/components/ui/button';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { FEED_META, FEED_TYPES, feedUrl, webcalUrl } from '@/lib/ical';
import { leerCriteriosFicha } from '@/lib/sport/explorar/ficha-url';
import { getCurrentSeason } from '@/lib/queries/calendar';
import { revocarCalendario } from './acciones';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mi perfil' };

/**
 * Cómo se llama tu papel en tu propia ficha.
 *
 * `club` sigue en el mapa aunque ya no sea un papel de `Role`: quedó una
 * cuenta con ese valor en la base, y si entra, ver «club» a secas —o peor, el
 * valor crudo— no le dice nada. Se le dice que su papel ya no se usa, que es
 * la verdad y además es accionable: puede pedir que se lo cambien.
 */
const PAPEL: Record<string, string> = {
  admin: 'Dirección técnica',
  coach: 'Seleccionador',
  athlete: 'Tirador',
  guardian: 'Padre, madre o tutor',
  club: 'Papel retirado (club)',
};

/**
 * Origen público de la aplicación.
 *
 * Las direcciones del calendario se copian y se pegan en el móvil, así que
 * tienen que ser absolutas y apuntar a donde está la aplicación de verdad. Se
 * prefiere `NEXT_PUBLIC_APP_URL`; si no está configurada se deduce de la
 * petición, que en local es lo correcto.
 */
async function origen(): Promise<string> {
  const configurado = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
  if (configurado) return configurado;

  const cabeceras = await headers();
  const host =
    cabeceras.get('x-forwarded-host') ?? cabeceras.get('host') ?? 'localhost:3000';
  const protocolo =
    cabeceras.get('x-forwarded-proto') ??
    (host.startsWith('localhost') ? 'http' : 'https');

  return `${protocolo}://${host}`;
}

export default async function Pagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const perfil = await requireProfile();

  const [atletas, temporada, base, consulta] = await Promise.all([
    getManagedAthletes(perfil.profileId),
    getCurrentSeason(),
    origen(),
    searchParams,
  ]);
  const criteriosFicha = leerCriteriosFicha(consulta);

  const hoy = new Date().toISOString().slice(0, 10);

  const feeds: FeedVista[] = FEED_TYPES.map((tipo) => ({
    tipo,
    nombre: FEED_META[tipo].name.replace(/^Esgrima · /, ''),
    descripcion: FEED_META[tipo].description,
    url: feedUrl(base, perfil.icalToken, tipo),
    webcal: webcalUrl(base, perfil.icalToken, tipo),
  }));

  return (
    /* Pantalla de lectura: más de 900 px por línea de dato no se lee mejor. */
    <div className="flex w-full max-w-4xl flex-col gap-6">
      {/* Mismo filete que en `Cabecera` y en el calendario. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-filete pb-3">
        <h1 className="text-2xl sm:text-3xl">Mi perfil</h1>
        {/*
          El correo se parte, no se recorta: un correo con puntos suspensivos
          no se puede leer ni comprobar, y en esta pantalla está justamente
          para comprobar con qué cuenta has entrado.
        */}
        <p className="min-w-0 break-all text-xs text-muted-foreground sm:text-sm">
          {perfil.email}
        </p>
      </div>

      <Seccion titulo="Tu cuenta">
        <dl className="flex flex-wrap gap-x-8 gap-y-3 pt-3">
          <Dato etiqueta="Nombre">{perfil.fullName}</Dato>
          <Dato etiqueta="Correo">
            <span className="block break-all">{perfil.email}</span>
          </Dato>
          <Dato etiqueta="Papel">{PAPEL[perfil.role] ?? perfil.role}</Dato>
          <Dato etiqueta="Club">
            {perfil.clubName ?? (
              <span className="text-muted-foreground">Sin club asignado</span>
            )}
          </Dato>
        </dl>
      </Seccion>

      <Seccion titulo="Favoritos" accion={<EnlaceFavoritos />}>
        <p className="medida pt-3 text-sm text-muted-foreground">
          Las fichas deportivas que has guardado para volver a ellas. La lista es privada y guardar a
          alguien no envía avisos.
        </p>
      </Seccion>

      <Seccion
        titulo={atletas.length === 1 ? 'Tu ficha de tirador' : 'Tus tiradores'}
      >

        {atletas.length > 0 ? (
          <div className="flex flex-col divide-y">
            {atletas.map((a) => (
              <FichaTirador
                key={a.id}
                atleta={a}
                categorias={
                  temporada
                    ? deriveCategoriesFromBirthDate(
                        a.birthDate,
                        temporada.categories,
                      )
                    : null
                }
                hoy={hoy}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 py-4">
            {/*
              «o tu club» se ha ido: el club ya no es un papel de la
              aplicación, así que no puede vincular nada. Quien lo hace es la
              dirección técnica, y punto.
            */}
            <p className="medida text-sm text-muted-foreground">
              Sin ficha de tirador. La vincula la dirección técnica.
            </p>
            <Button variant="outline" asChild>
              <Link href="/">Ver el calendario</Link>
            </Button>
          </div>
        )}
      </Seccion>

      {/*
        Historial por defecto, no un enlace. Va en su propio límite de carga
        para que la cuenta y la ficha se vean sin esperar a las consultas
        deportivas; si fallan, el error se queda dentro de esta sección. Sin
        esqueleto (`docs/diseno-sistema.md` § 5) y sin `key`: al cambiar de
        página del historial se queda el anterior hasta que llega el nuevo.
      */}
      <Suspense fallback={null}>
        <HistorialPropio criterios={criteriosFicha} />
      </Suspense>

      <Seccion titulo="El calendario en tu móvil">
        <div className="pt-3">
          {perfil.preview ? (
            <p className="text-sm text-muted-foreground">
              No disponible en la vista previa.
            </p>
          ) : <Calendarios feeds={feeds} revocar={revocarCalendario} />}
        </div>
      </Seccion>

      <Seccion titulo="Sesión">
        <div className="flex flex-col items-start gap-3 pt-3">
          <p className="medida text-sm text-muted-foreground">
            Tus calendarios suscritos siguen al día.
          </p>
          <form action={salir}>
            <Button variant="outline" type="submit">
              <LogOut /> Salir de la sesión
            </Button>
          </form>
        </div>
      </Seccion>
    </div>
  );
}
