import { cn } from '@/lib/utils';

/**
 * Corona de laurel propia. No se usan los anillos olímpicos: son marca
 * registrada del COI.
 */
export function IconoLaurel({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      data-icono="laurel"
      className={cn('size-3.5 shrink-0', className)}
    >
      <path d="M9 20.5C5.2 18.8 3 15.3 3 11.3c0-2.2.6-4.3 1.7-6" />
      <path d="M15 20.5c3.8-1.7 6-5.2 6-9.2 0-2.2-.6-4.3-1.7-6" />
      <g fill="currentColor" stroke="none">
        <ellipse cx="4.6" cy="8" rx="1.1" ry="2" transform="rotate(-25 4.6 8)" />
        <ellipse cx="4.2" cy="12.5" rx="1.1" ry="2" transform="rotate(-50 4.2 12.5)" />
        <ellipse cx="6" cy="16.6" rx="1.1" ry="2" transform="rotate(-70 6 16.6)" />
        <ellipse cx="19.4" cy="8" rx="1.1" ry="2" transform="rotate(25 19.4 8)" />
        <ellipse cx="19.8" cy="12.5" rx="1.1" ry="2" transform="rotate(50 19.8 12.5)" />
        <ellipse cx="18" cy="16.6" rx="1.1" ry="2" transform="rotate(70 18 16.6)" />
      </g>
    </svg>
  );
}
