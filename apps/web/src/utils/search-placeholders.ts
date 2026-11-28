import { useEffect, useState } from 'react';

export const SEARCH_PLACEHOLDER_PHRASES = [
  '¿Qué quieres reproducir hoy?',
  '¿Qué te apetece escuchar?',
  'Ponle banda sonora a este momento…',
  '¿Qué canción tienes en la cabeza?',
  'Busca un tema, artista o vibra…',
  '¿Qué suena ahora?',
  'Descubre tu próximo temazo…',
  'Escribe un artista, álbum o letra…',
] as const;

export function pickInitialSearchPlaceholderIndex(): number {
  if (SEARCH_PLACEHOLDER_PHRASES.length <= 1) return 0;
  return Math.floor(Math.random() * SEARCH_PLACEHOLDER_PHRASES.length);
}

export function useRotatingSearchPlaceholder(options?: {
  paused?: boolean;
  intervalMs?: number;
}): string {
  const paused = Boolean(options?.paused);
  const intervalMs = options?.intervalMs ?? 7500;
  const [index, setIndex] = useState<number>(pickInitialSearchPlaceholderIndex);

  useEffect(() => {
    if (paused || SEARCH_PLACEHOLDER_PHRASES.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % SEARCH_PLACEHOLDER_PHRASES.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [paused, intervalMs]);

  return SEARCH_PLACEHOLDER_PHRASES[index] ?? SEARCH_PLACEHOLDER_PHRASES[0];
}
