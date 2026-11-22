import type React from 'react';
import type { Track } from '@pmusic/core';

export interface DraggedTrackSource {
  playlistId: string;
  index: number;
}

const MIME_TYPE = 'application/x-pmusic-track';

let activeTrack: Track | null = null;
let activeSource: DraggedTrackSource | null = null;

export function setDraggedTrack(
  e: React.DragEvent,
  track: Track,
  source?: DraggedTrackSource
): void {
  activeTrack = track;
  activeSource = source ?? null;
  try {
    e.dataTransfer.effectAllowed = source ? 'move' : 'copy';
    e.dataTransfer.setData(MIME_TYPE, JSON.stringify(track));
    e.dataTransfer.setData('text/plain', `${track.title} — ${track.artists.map((a) => a.name).join(', ')}`);
  } catch {
    // Ignore restricted synthetic drag events
  }
}

export function getDraggedTrack(): Track | null {
  return activeTrack;
}

export function getDraggedSource(): DraggedTrackSource | null {
  return activeSource;
}

export function readTrackFromDropEvent(e: React.DragEvent): Track | null {
  if (activeTrack) return activeTrack;
  try {
    const raw = e.dataTransfer.getData(MIME_TYPE);
    if (raw) {
      return JSON.parse(raw) as Track;
    }
  } catch {
    // Ignore invalid JSON payloads
  }
  return null;
}

export function clearDraggedTrack(): void {
  activeTrack = null;
  activeSource = null;
}
