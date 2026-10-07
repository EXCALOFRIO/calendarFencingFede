import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getSessionProfile } from '@/lib/auth/session';
import { cargarEstadoFavorito } from '@/lib/sport/explorar/favoritos-pantalla';
import { personaDeRuta } from '@/lib/sport/explorar/ficha-url';
import { cargarCabeceraPerfil } from '@/lib/sport/explorar/perfil-cache-real';
import { contextoReal } from '@/lib/sport/explorar/real';

/**
 * Lecturas compartidas por el layout del perfil (la cabecera) y sus
 * secciones. Lo público sale de la caché compartida (`perfil-cache.ts`); lo
 * de la cuenta (seguir, si la ficha es la propia) se lee en la petición.
 * `cache` las hace una vez por petición: al abrir una sección desde fuera,
 * cabecera y sección leen la ficha una sola vez; al cambiar de sección dentro
 * del perfil el layout no se vuelve a pintar y sólo se lee lo de la sección
 * nueva.
 */

/** La guarda de sesión va en el layout y en cada sección: un layout no se repite al navegar entre hermanas. */
export async function exigirSesion(): Promise<void> {
  if (!(await getSessionProfile())) redirect('/entrar');
}

export const personaDeSegmento = personaDeRuta;

export const cabeceraPerfil = cache((personaId: string) => cargarCabeceraPerfil(contextoReal(), personaId));

export const fichaPerfil = async (personaId: string) => (await cabeceraPerfil(personaId)).vista;

export const extrasPerfil = async (personaId: string) => (await cabeceraPerfil(personaId)).extras;

export const favoritoPerfil = cache((personaId: string) => cargarEstadoFavorito(contextoReal(), personaId));
