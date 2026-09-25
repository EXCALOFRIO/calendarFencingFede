import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    // El scraper y las rutas de cron hacen fetch a fuentes externas; no cachear.
    serverActions: { bodySizeLimit: '8mb' },
  },
  // Los PDFs de convocatoria viven en Vercel Blob.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.public.blob.vercel-storage.com' }],
  },
};

export default nextConfig;
