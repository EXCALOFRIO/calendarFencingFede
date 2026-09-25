import { LogOut } from 'lucide-react';
import { headers } from 'next/headers';
import Link from 'next/link';
import { Calendarios, type FeedVista } from '@/components/perfil/calendarios';
import { FichaTirador } from '@/components/perfil/tirador';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getManagedAthletes, requireProfile } from '@/lib/auth/session';
import { deriveCategoriesFromBirthDate } from '@/lib/categories';
import { FEED_META, FEED_TYPES, feedUrl, webcalUrl } from '@/lib/ical';
import { getCurrentSeason } from '@/lib/queries/calendar';
import { revocarCalendario } from './acciones';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mi perfil' };

const PAPEL: Record<string, string> = {
  admin: 'Dirección técnica',
  coach: 'Seleccionador',
  club: 'Club',
  athlete: 'Tirador',
  guardian: 'Tutor',
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

export default async function Pagina() {
  const perfil = await requireProfile();

  const [atletas, temporada, base] = await Promise.all([
    getManagedAthletes(perfil.profileId),
    getCurrentSeason(),
    origen(),
  ]);

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
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl sm:text-3xl">Mi perfil</h1>
        <p className="min-w-0 truncate text-sm text-muted-foreground">
          {perfil.email}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl">Tu cuenta</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Nombre</dt>
            <dd className="text-sm">{perfil.fullName}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Correo</dt>
            <dd className="truncate text-sm">{perfil.email}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Papel</dt>
            <dd className="text-sm">{PAPEL[perfil.role] ?? perfil.role}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Club</dt>
            <dd className="text-sm">
              {perfil.clubName ?? (
                <span className="text-muted-foreground">Sin club asignado</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <Separator />

      <section className="flex flex-col gap-1">
        <h2 className="text-xl">
          {atletas.length === 1 ? 'Tu ficha de tirador' : 'Tus tiradores'}
        </h2>

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
          <div className="flex flex-col items-start gap-3 py-3">
            <p className="medida text-sm text-muted-foreground">
              Tu cuenta no tiene ninguna ficha de tirador vinculada. Aquí
              aparecerían sus armas, sus categorías y sus licencias. La vincula
              la dirección técnica o tu club desde el listado de tiradores.
            </p>
            <Button variant="outline" asChild>
              <Link href="/">Ver el calendario</Link>
            </Button>
          </div>
        )}
      </section>

      <Separator />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl">El calendario en tu móvil</h2>
        <Calendarios feeds={feeds} revocar={revocarCalendario} />
      </section>

      <Separator />

      <section className="flex flex-col items-start gap-3">
        <h2 className="text-xl">Sesión</h2>
        <p className="medida text-sm text-muted-foreground">
          Se cierra la sesión en este dispositivo. Los calendarios que tengas
          suscritos siguen actualizándose: no dependen de estar dentro.
        </p>
        <form action="/api/auth/sign-out" method="post">
          <Button variant="outline" type="submit">
            <LogOut /> Salir de la sesión
          </Button>
        </form>
      </section>
    </div>
  );
}
