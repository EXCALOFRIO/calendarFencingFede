import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { asc, inArray, ne } from 'drizzle-orm';
import { and } from 'drizzle-orm';
import { db } from '@/db';
import { userProfile } from '@/db/schema';
import { Button } from '@/components/ui/button';
import { getAuthenticatedProfile } from '@/lib/auth/session';
import { iniciarVistaPrevia, terminarAccesoQa, terminarVistaPrevia } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Vista previa privada',
  robots: { index: false, follow: false },
};
const PAPELES = [
  { role: 'admin', label: 'Dirección técnica' },
  { role: 'coach', label: 'Seleccionador' },
  { role: 'athlete', label: 'Tirador' },
] as const;

export default async function VistaPrevia({
  searchParams,
}: {
  searchParams: Promise<{ rol?: string }>;
}) {
  const admin = await getAuthenticatedProfile();
  if (!admin) redirect('/entrar');
  if (admin.role !== 'admin') notFound();
  const [perfiles, consulta] = await Promise.all([
    db.select({ id: userProfile.id, fullName: userProfile.fullName, role: userProfile.role })
      .from(userProfile)
      .where(and(
        inArray(userProfile.role, ['admin', 'coach', 'athlete']),
        ne(userProfile.inviteStatus, 'revocada'),
      )).orderBy(asc(userProfile.fullName)),
    searchParams,
  ]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl sm:text-3xl">Vista previa privada</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {admin.qa
            ? 'Acceso técnico temporal de QA, exclusivamente de solo lectura.'
            : 'Solo tu cuenta administradora puede abrir estas vistas.'}
          {' '}Muestran los datos del perfil elegido, sin cambiar su cuenta. Caducan a los 30 minutos.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Puedes navegar, buscar y filtrar. No puedes guardar cambios, enviar avisos,
          renovar calendarios ni ejecutar ingestiones o IA.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {PAPELES.map(({ role, label }) => {
          const disponibles = perfiles.filter((p) => p.role === role);
          return (
            <section key={role} className="flex min-w-0 flex-col gap-3 rounded-md border bg-card p-4">
              <h2 className="text-lg">{label}</h2>
              {disponibles.length ? (
                <form action={iniciarVistaPrevia} className="flex flex-1 flex-col gap-3">
                  <input type="hidden" name="role" value={role} />
                  <label htmlFor={`perfil-${role}`} className="text-sm">Perfil que quieres ver</label>
                  <select id={`perfil-${role}`} name="profileId"
                    className="h-11 min-w-0 w-full rounded-md border bg-background px-2 text-base"
                    autoFocus={consulta.rol === role}>
                    {disponibles.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                  </select>
                  <Button type="submit" className="mt-auto min-h-11 whitespace-normal">
                    Ver como {label.toLowerCase()}
                  </Button>
                </form>
              ) : <p className="text-sm text-muted-foreground">No hay perfiles activos de este tipo.</p>}
            </section>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3">
        <form action={admin.qa ? terminarAccesoQa : terminarVistaPrevia}>
          <Button variant="outline" type="submit" className="min-h-11">
            {admin.qa ? 'Cerrar acceso técnico' : 'Volver a mi cuenta'}
          </Button>
        </form>
        <Button variant="ghost" asChild className="min-h-11">
          <Link href="/">Volver al calendario</Link>
        </Button>
      </div>
    </main>
  );
}
