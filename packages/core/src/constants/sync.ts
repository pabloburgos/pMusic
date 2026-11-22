/** Supabase Free Tier hard cap: 10 keys/presence object (pMusic uses 7) */
export const SUPABASE_PRESENCE_MAX_KEYS = 10;

/** Minimum interval between Presence `track()` calls (Free Tier: <= 5 calls / 30s) */
export const SUPABASE_PRESENCE_MIN_INTERVAL_MS = 8_000;

/** Max queue length inside `PlaybackTransferSnapshot` to stay safely under 256 KB Broadcast cap */
export const PLAYBACK_TRANSFER_MAX_QUEUE_ITEMS = 100;

/** Single multiplexed Realtime channel per authenticated user: `pmusic:user:<userId>` */
export const REALTIME_CHANNEL_PREFIX = 'pmusic:user:';
