import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Database,
  Disc3,
  Download,
  Gamepad2,
  Palette,
  RefreshCw,
  Settings,
  Sliders,
  Timer,
  Upload,
  X,
} from 'lucide-react';
import {
  USER_EQ_FREQUENCIES_HZ,
  USER_EQ_PRESETS,
  formatDurationSec,
} from '@pmusic/core';
import { usePMusicStore } from '../store/usePMusicStore.ts';
import {
  PMUSIC_ACCENT_PRESETS,
  PMUSIC_THEMES,
} from '../utils/themes.ts';

type SettingsCategoryId =
  | 'apariencia'
  | 'audio'
  | 'dj'
  | 'discord'
  | 'reproduccion'
  | 'cuenta';

const CATEGORIES: ReadonlyArray<{
  id: SettingsCategoryId;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'apariencia', label: 'Apariencia y Temas', icon: <Palette className="h-4 w-4" /> },
  { id: 'audio', label: 'Audio y EQ', icon: <Sliders className="h-4 w-4" /> },
  { id: 'dj', label: 'Sesión DJ', icon: <Disc3 className="h-4 w-4" /> },
  { id: 'discord', label: 'Discord RPC', icon: <Gamepad2 className="h-4 w-4" /> },
  { id: 'reproduccion', label: 'Reproducción', icon: <Timer className="h-4 w-4" /> },
  { id: 'cuenta', label: 'Cuenta y Datos', icon: <Database className="h-4 w-4" /> },
];

const SwitchRow: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}> = ({ title, description, checked, disabled, onToggle }) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <div className="min-w-0 flex-1">
      <div className="text-[13.5px] font-bold pm-text-primary">{title}</div>
      <div className="text-xs pm-text-secondary">{description}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      disabled={disabled}
      onClick={onToggle}
      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-all disabled:opacity-50 ${
        checked ? 'pm-btn-primary' : 'pm-btn-secondary'
      }`}
    >
      {checked ? 'Activado' : 'Desactivado'}
    </button>
  </div>
);

export const SettingsModal: React.FC = () => {
  const {
    settingsOpen,
    setSettingsOpen,
    currentTrack,
    positionSec,
    durationSec,
    themeId,
    playerBarStyle,
    accentPreset,
    liquidGlassMode,
    visualizerEnabled,
    graphicSaverMode,
    reducedMotionPref,
    lyricsSize,
    lyricsBlurEnabled,
    userEq,
    safeCrossfade,
    playbackRate,
    preservesPitch,
    audioNormalization,
    normalizationTarget,
    stereoBalance,
    monoAudio,
    streamQuality,
    autoplayEnabled,
    djMode,
    discordRpcEnabled,
    discordRpcConfig,
    discordRpcStatus,
    sleepTimerMode,
    sleepTimerRemainingSec,
    authState,
    offlineEntries,
    setTheme,
    setPlayerBarStyle,
    setAccentPreset,
    setLiquidGlassMode,
    setVisualizerEnabled,
    setGraphicSaverMode,
    setReducedMotionPref,
    setLyricsSize,
    setLyricsBlurEnabled,
    setEqEnabled,
    setEqPreset,
    setEqBandGain,
    setSafeCrossfade,
    setPlaybackRate,
    setPreservesPitch,
    setAudioNormalization,
    setNormalizationTarget,
    setStereoBalance,
    setMonoAudio,
    setStreamQuality,
    setAutoplayEnabled,
    toggleDjMode,
    setDjSessionStyle,
    toggleDjFx,
    setDjStemSculpting,
    setDjVocalClashProtection,
    setDjAutoReorder,
    setDiscordRpcEnabled,
    setDiscordRpcConfig,
    reconnectDiscordRpc,
    refreshDiscordRpcStatus,
    setSleepTimer,
    cancelSleepTimer,
    signInSupabase,
    signUpSupabase,
    signOutSupabase,
    clearOfflineCache,
    exportLibraryJson,
    importLibraryJson,
    showToast,
  } = usePMusicStore();

  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>('apariencia');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [clientIdInput, setClientIdInput] = useState(discordRpcConfig.clientId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setClientIdInput(discordRpcConfig.clientId);
  }, [discordRpcConfig.clientId]);

  useEffect(() => {
    if (settingsOpen) {
      void refreshDiscordRpcStatus();
    }
  }, [settingsOpen, refreshDiscordRpcStatus]);

  if (!settingsOpen) return null;

  const totalOfflineBytes = offlineEntries.reduce((s, e) => s + e.sizeBytes, 0);
  const enabledFx = djMode.enabledTransitions ?? {
    eq_swap: true,
    filter_sweep: true,
    echo_out: true,
  };
  const crossfadePct = Math.round((safeCrossfade.durationSec / 12) * 100);
  const balancePct = Math.round(((stereoBalance + 1) / 2) * 100);

  const statusBadgeText =
    discordRpcStatus.status === 'connected'
      ? `Conectado${discordRpcStatus.username ? ` como ${discordRpcStatus.username}` : ''}`
      : discordRpcStatus.status === 'connecting'
        ? 'Conectando con Discord...'
        : discordRpcStatus.status === 'needs_client_id'
          ? 'Falta Client ID de aplicación Discord'
          : discordRpcStatus.status === 'web_only'
            ? 'Disponible en la app pMusic Windows (.exe)'
            : discordRpcStatus.status === 'disabled'
              ? 'Desactivado'
              : 'Discord no detectado (reintento automático cada 15 s)';

  const handleDownloadJsonBackup = () => {
    const json = exportLibraryJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pmusic-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Copia de seguridad descargada');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div
        aria-hidden="true"
        onClick={() => setSettingsOpen(false)}
        className="pm-spotlight-backdrop absolute inset-0 bg-black/65"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ajustes de pMusic"
        data-testid="settings-view"
        className="pm-glass-regular pm-modal-pop relative z-10 flex h-[86dvh] w-[95vw] max-w-4xl flex-col overflow-hidden rounded-[24px]"
      >
        {/* Top Modal Header */}
        <header className="flex shrink-0 items-center justify-between border-b pm-border px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Settings className="h-5 w-5 pm-text-primary" />
            <div>
              <h2 className="text-lg font-bold leading-tight pm-text-primary">
                Configuración de pMusic
              </h2>
              <p className="text-[11.5px] pm-text-tertiary">
                Temas, motor acústico DSP, Sesión DJ, Discord RPC y sincronización
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar ajustes"
            onClick={() => setSettingsOpen(false)}
            className="pm-btn-secondary inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
          >
            <X className="h-3.5 w-3.5" />
            <span>Cerrar</span>
          </button>
        </header>

        {/* Body: Left Category Navigation + Right Interactive Pane */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            role="tablist"
            aria-label="Categorías de ajustes"
            className="flex shrink-0 gap-1 overflow-x-auto border-b pm-border px-3 py-2.5 md:w-[232px] md:flex-col md:border-r md:border-b-0 md:p-3 pm-no-scrollbar"
          >
            {CATEGORIES.map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  data-testid={`settings-category-${cat.id}`}
                  aria-selected={active}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex shrink-0 items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left text-xs font-bold transition-all ${
                    active ? 'pm-btn-primary shadow-sm' : 'pm-text-secondary pm-hover'
                  }`}
                >
                  {cat.icon}
                  <span className="whitespace-nowrap">{cat.label}</span>
                </button>
              );
            })}
          </nav>

          <div
            key={activeCategory}
            className="pm-tab-enter min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-6"
          >
            {/* 1. APARIENCIA Y TEMAS */}
            {activeCategory === 'apariencia' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-bold pm-text-primary">
                    Temas y personalidad visual
                  </h3>
                  <p className="text-xs pm-text-secondary">
                    Cambia completamente la paleta, los contrastes, el vidrio líquido y la tipografía editorial de pMusic
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {PMUSIC_THEMES.map((theme) => {
                    const selected = themeId === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        data-testid={`theme-card-${theme.id}`}
                        aria-pressed={selected}
                        onClick={() => setTheme(theme.id)}
                        className={`pm-surface-card pm-card-lift relative flex flex-col justify-between gap-3 rounded-[16px] p-4 text-left ${
                          selected ? 'ring-2 ring-[var(--pm-accent-primary)]' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            {theme.swatches.map((hex, i) => (
                              <span
                                key={`${theme.id}-${i}`}
                                className="h-4 w-4 rounded-full border border-black/25 shadow-sm"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                          {selected && (
                            <span className="pm-btn-primary inline-flex h-5 w-5 items-center justify-center rounded-full">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                        <div>
                          <div className="text-[14.5px] font-bold pm-text-primary">
                            {theme.name}
                          </div>
                          <div className="mt-0.5 text-[11px] font-semibold pm-text-tertiary">
                            {theme.fontLabel}
                          </div>
                          <p className="mt-1.5 text-[11.5px] leading-snug pm-text-secondary">
                            {theme.tagline}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Customizable Dock Style */}
                <section
                  data-surface="content"
                  className="pm-surface-card space-y-3 rounded-[16px] p-4"
                >
                  <div>
                    <div className="text-sm font-bold pm-text-primary">
                      Estilo de barra inferior (Reproductor PC)
                    </div>
                    <p className="text-xs pm-text-secondary">
                      Elige cómo se presentan los controles y la barra de progreso en escritorio
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <button
                      type="button"
                      data-testid="dock-style-classic-center"
                      aria-pressed={playerBarStyle === 'classic-center'}
                      onClick={() => setPlayerBarStyle('classic-center')}
                      className={`pm-surface-card pm-card-lift flex flex-col gap-2.5 rounded-[14px] p-3.5 text-left ${
                        playerBarStyle === 'classic-center'
                          ? 'ring-2 ring-[var(--pm-accent-primary)]'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold pm-text-primary">
                          Barra Clásica Central
                        </span>
                        {playerBarStyle === 'classic-center' && (
                          <span className="pm-btn-primary inline-flex h-4 w-4 items-center justify-center rounded-full">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                      <div className="pm-elevated flex flex-col items-center gap-1.5 rounded-lg border pm-border px-3 py-2">
                        <div className="flex items-center gap-2 opacity-80">
                          <span className="h-1.5 w-1.5 rounded-full bg-current pm-text-tertiary" />
                          <span className="h-2 w-2 rounded-full bg-current pm-text-secondary" />
                          <span className="h-3.5 w-3.5 rounded-full bg-[var(--pm-accent-primary)]" />
                          <span className="h-2 w-2 rounded-full bg-current pm-text-secondary" />
                          <span className="h-1.5 w-1.5 rounded-full bg-current pm-text-tertiary" />
                        </div>
                        <div className="flex w-full items-center gap-1.5">
                          <span className="h-1 w-4 rounded-full pm-text-tertiary bg-current opacity-40" />
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-current/15">
                            <div className="h-full w-2/5 rounded-full bg-[var(--pm-accent-primary)]" />
                          </div>
                          <span className="h-1 w-4 rounded-full pm-text-tertiary bg-current opacity-40" />
                        </div>
                      </div>
                      <p className="text-[11px] pm-text-secondary">
                        Controles centrados con barra temporal interactiva y tiempos simétricos
                      </p>
                    </button>

                    <button
                      type="button"
                      data-testid="dock-style-ambient-dock"
                      aria-pressed={playerBarStyle === 'ambient-dock'}
                      onClick={() => setPlayerBarStyle('ambient-dock')}
                      className={`pm-surface-card pm-card-lift flex flex-col gap-2.5 rounded-[14px] p-3.5 text-left ${
                        playerBarStyle === 'ambient-dock'
                          ? 'ring-2 ring-[var(--pm-accent-primary)]'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold pm-text-primary">
                          Barra Ambiental Fluida
                        </span>
                        {playerBarStyle === 'ambient-dock' && (
                          <span className="pm-btn-primary inline-flex h-4 w-4 items-center justify-center rounded-full">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                      <div className="pm-elevated relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border pm-border px-3 py-2.5">
                        <div
                          className="pointer-events-none absolute inset-y-0 left-0 w-3/5"
                          style={{
                            background:
                              'linear-gradient(90deg, color-mix(in srgb, var(--pm-accent-primary) 28%, transparent) 0%, color-mix(in srgb, var(--pm-accent-primary) 12%, transparent) 78%, transparent 100%)',
                          }}
                        />
                        <div className="relative z-10 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-current pm-text-tertiary" />
                          <span className="h-2 w-2 rounded-full bg-current pm-text-secondary" />
                          <span className="h-3.5 w-3.5 rounded-full bg-[var(--pm-accent-primary)]" />
                          <span className="h-2 w-2 rounded-full bg-current pm-text-secondary" />
                          <span className="h-1.5 w-1.5 rounded-full bg-current pm-text-tertiary" />
                        </div>
                        <span className="relative z-10 text-[9px] font-bold pm-text-tertiary">
                          0:23 · 4:18
                        </span>
                      </div>
                      <p className="text-[11px] pm-text-secondary">
                        Degradado suave del color del álbum sin cortes bruscos en toda la cápsula
                      </p>
                    </button>

                    <button
                      type="button"
                      data-testid="dock-style-floating-island"
                      aria-pressed={playerBarStyle === 'floating-island'}
                      onClick={() => setPlayerBarStyle('floating-island')}
                      className={`pm-surface-card pm-card-lift flex flex-col gap-2.5 rounded-[14px] p-3.5 text-left ${
                        playerBarStyle === 'floating-island'
                          ? 'ring-2 ring-[var(--pm-accent-primary)]'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold pm-text-primary">
                          Isla Flotante Frost
                        </span>
                        {playerBarStyle === 'floating-island' && (
                          <span className="pm-btn-primary inline-flex h-4 w-4 items-center justify-center rounded-full">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-center py-1">
                        <div className="pm-elevated relative flex w-4/5 flex-col items-center gap-1 overflow-hidden rounded-full border pm-border px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-current pm-text-secondary" />
                            <span className="h-3.5 w-3.5 rounded-full bg-[var(--pm-accent-primary)]" />
                            <span className="h-2 w-2 rounded-full bg-current pm-text-secondary" />
                          </div>
                          <div className="pointer-events-none absolute inset-x-4 bottom-0 h-[2.5px] rounded-full bg-current/15">
                            <div className="h-full w-1/2 rounded-full bg-[var(--pm-accent-primary)]" />
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] pm-text-secondary">
                        Cápsula compacta centrada estilo Dynamic Island con línea inferior de progreso
                      </p>
                    </button>

                    <button
                      type="button"
                      data-testid="dock-style-minimal-wave"
                      aria-pressed={playerBarStyle === 'minimal-wave'}
                      onClick={() => setPlayerBarStyle('minimal-wave')}
                      className={`pm-surface-card pm-card-lift flex flex-col gap-2.5 rounded-[14px] p-3.5 text-left ${
                        playerBarStyle === 'minimal-wave'
                          ? 'ring-2 ring-[var(--pm-accent-primary)]'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold pm-text-primary">
                          Minimalista Studio
                        </span>
                        {playerBarStyle === 'minimal-wave' && (
                          <span className="pm-btn-primary inline-flex h-4 w-4 items-center justify-center rounded-full">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </div>
                      <div className="pm-elevated relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border pm-border px-3 py-2.5">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-current/15">
                          <div className="h-full w-2/3 rounded-r-full bg-[var(--pm-accent-primary)]" />
                        </div>
                        <div className="flex w-full items-center justify-between pt-0.5">
                          <span className="inline-flex items-end gap-0.5">
                            <span className="h-2 w-0.5 rounded-full bg-[var(--pm-accent-primary)]" />
                            <span className="h-3 w-0.5 rounded-full bg-[var(--pm-accent-primary)]" />
                            <span className="h-1.5 w-0.5 rounded-full bg-[var(--pm-accent-primary)]" />
                          </span>
                          <span className="h-3 w-3 rounded-full bg-[var(--pm-accent-primary)]" />
                          <span className="h-1.5 w-6 rounded-full bg-current/25" />
                        </div>
                      </div>
                      <p className="text-[11px] pm-text-secondary">
                        Filamento luminoso superior interactivo e indicador espectral minimalista
                      </p>
                    </button>
                  </div>
                </section>

                {/* Accent Color Swatches */}
                <section
                  data-surface="content"
                  className="pm-surface-card space-y-3 rounded-[16px] p-4"
                >
                  <div>
                    <div className="text-sm font-bold pm-text-primary">
                      Color de acento personalizado
                    </div>
                    <p className="text-xs pm-text-secondary">
                      Personaliza botones principales, indicadores activos y resaltes de navegación
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {PMUSIC_ACCENT_PRESETS.map((preset) => {
                      const active = accentPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          data-testid={`accent-preset-${preset.id}`}
                          aria-pressed={active}
                          onClick={() => setAccentPreset(preset.id)}
                          className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                            active ? 'pm-btn-primary' : 'pm-btn-secondary'
                          }`}
                        >
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-black/25 shadow-sm"
                            style={{ background: preset.swatchHex }}
                          />
                          <span>{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section
                  data-surface="content"
                  className="pm-surface-card divide-y pm-border rounded-[16px] px-4 py-2"
                >
                  <div className="flex items-center justify-between gap-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-bold pm-text-primary">
                        Modo Liquid Glass integral
                      </div>
                      <div className="text-xs pm-text-secondary">
                        Activado: cristal translúcido en menús, barra inferior, panel derecho y tarjetas · Desactivado: acabado sólido moderno opaco
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      data-testid="liquid-glass-toggle"
                      aria-checked={liquidGlassMode}
                      aria-label="Modo Liquid Glass integral"
                      onClick={() => setLiquidGlassMode(!liquidGlassMode)}
                      className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                        liquidGlassMode ? 'pm-btn-primary' : 'pm-btn-secondary'
                      }`}
                    >
                      {liquidGlassMode ? 'Liquid Glass' : 'Sólido Moderno'}
                    </button>
                  </div>
                  <SwitchRow
                    title="Visualizador espectral en vivo"
                    description="Muestra barras animadas reactivas al audio en la vista de canción"
                    checked={visualizerEnabled}
                    onToggle={() => setVisualizerEnabled(!visualizerEnabled)}
                  />
                  <SwitchRow
                    title="Modo ahorro gráfico (Reducir transparencias)"
                    description="Sustituye los paneles translúcidos por superficies sólidas opacas"
                    checked={graphicSaverMode}
                    onToggle={() => setGraphicSaverMode(!graphicSaverMode)}
                  />
                  <SwitchRow
                    title="Reducir animaciones"
                    description="Desactiva transiciones y animaciones cinemáticas en toda la app"
                    checked={reducedMotionPref}
                    onToggle={() => setReducedMotionPref(!reducedMotionPref)}
                  />
                </section>
              </div>
            )}

            {/* 2. AUDIO Y EQ */}
            {activeCategory === 'audio' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-bold pm-text-primary">
                    Audio Hi-Fi, Ecualizador y Mezcla
                  </h3>
                  <p className="text-xs pm-text-secondary">
                    Controles acústicos en tiempo real sobre Web Audio API de 64 bits
                  </p>
                </div>

                {/* Quality & Normalization */}
                <section
                  data-surface="content"
                  className="pm-surface-card space-y-4 rounded-[16px] p-4"
                >
                  <div className="space-y-2">
                    <div className="text-sm font-bold pm-text-primary">
                      Calidad de streaming
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'high', label: 'Alta (Máxima)' },
                          { id: 'medium', label: 'Equilibrada' },
                          { id: 'low', label: 'Ahorro datos' },
                        ] as const
                      ).map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setStreamQuality(q.id)}
                          className={`rounded-[12px] py-2 text-xs font-bold ${
                            streamQuality === q.id ? 'pm-btn-primary' : 'pm-btn-secondary'
                          }`}
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pm-border pt-3">
                    <SwitchRow
                      title="Normalización automática de volumen (LUFS)"
                      description="Iguala el nivel sonoro entre álbumes antiguos y lanzamientos actuales"
                      checked={audioNormalization}
                      onToggle={() => setAudioNormalization(!audioNormalization)}
                    />
                    {audioNormalization && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(
                          [
                            { id: 'quiet', label: 'Suave (-14 dB)' },
                            { id: 'normal', label: 'Estándar (-11 dB)' },
                            { id: 'loud', label: 'Potente (-8 dB)' },
                          ] as const
                        ).map((lvl) => (
                          <button
                            key={lvl.id}
                            type="button"
                            onClick={() => setNormalizationTarget(lvl.id)}
                            className={`rounded-full px-3.5 py-1 text-[11px] font-bold ${
                              normalizationTarget === lvl.id
                                ? 'pm-btn-primary'
                                : 'pm-btn-secondary'
                            }`}
                          >
                            {lvl.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                {/* Embedded 5-Band EQ & Crossfade */}
                <section
                  data-surface="content"
                  className="pm-surface-card space-y-4 rounded-[16px] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold pm-text-primary">
                        Ecualizador gráfico de 5 bandas
                      </div>
                      <div className="text-xs pm-text-secondary">
                        Ajusta bajos, presencia vocal y brillo en vivo
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={userEq.enabled}
                      onClick={() => setEqEnabled(!userEq.enabled)}
                      className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                        userEq.enabled ? 'pm-btn-primary' : 'pm-btn-secondary'
                      }`}
                    >
                      {userEq.enabled ? 'Activo' : 'Apagado'}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {USER_EQ_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setEqPreset(preset.id)}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          userEq.preset === preset.id
                            ? 'pm-btn-primary'
                            : 'pm-btn-secondary'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-5 gap-2.5 pt-1">
                    {USER_EQ_FREQUENCIES_HZ.map((freq, idx) => {
                      const val = userEq.bandsDb[idx] ?? 0;
                      const pct = Math.round(((val + 12) / 24) * 100);
                      const label = freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : `${freq}`;
                      return (
                        <div key={freq} className="pm-panel space-y-1.5 rounded-[12px] p-2.5 text-center">
                          <div className="text-[11px] font-bold pm-text-tertiary">{label}Hz</div>
                          <input
                            type="range"
                            min={-12}
                            max={12}
                            step={0.5}
                            aria-label={`Banda EQ ${label}Hz`}
                            value={val}
                            onChange={(e) => setEqBandGain(idx, Number(e.target.value))}
                            style={{ '--pm-fill': `${pct}%` } as React.CSSProperties}
                            className="w-full"
                          />
                          <div className="tabular-nums text-[11px] font-bold pm-text-primary">
                            {val > 0 ? `+${val}` : val} dB
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t pm-border pt-3">
                    <SwitchRow
                      title="Crossfade seguro (0–12 s)"
                      description={
                        djMode.enabled
                          ? 'Pausado automáticamente mientras Sesión DJ está activa'
                          : 'Encadena canciones suavemente al finalizar cada pista'
                      }
                      checked={safeCrossfade.enabled && !djMode.enabled}
                      disabled={djMode.enabled}
                      onToggle={() => setSafeCrossfade({ enabled: !safeCrossfade.enabled })}
                    />
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={12}
                        step={1}
                        aria-label="Segundos de crossfade"
                        value={safeCrossfade.durationSec}
                        onChange={(e) => setSafeCrossfade({ durationSec: Number(e.target.value) })}
                        style={{ '--pm-fill': `${crossfadePct}%` } as React.CSSProperties}
                        className="flex-1"
                      />
                      <span className="tabular-nums w-10 text-right text-xs font-bold pm-text-primary">
                        {safeCrossfade.durationSec} s
                      </span>
                    </div>
                  </div>
                </section>

                {/* Speed, Pitch, Stereo Balance & Mono */}
                <section
                  data-surface="content"
                  className="pm-surface-card space-y-4 rounded-[16px] p-4"
                >
                  <div>
                    <div className="text-sm font-bold pm-text-primary">
                      Velocidad de reproducción
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[0.75, 0.85, 1, 1.15, 1.25, 1.5].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => setPlaybackRate(rate)}
                          className={`tabular-nums rounded-full px-3.5 py-1.5 text-xs font-bold ${
                            Math.abs(playbackRate - rate) < 0.01
                              ? 'pm-btn-primary'
                              : 'pm-btn-secondary'
                          }`}
                        >
                          {rate}×
                        </button>
                      ))}
                    </div>
                  </div>

                  <SwitchRow
                    title="Conservar afinación al cambiar velocidad"
                    description="Evita distorsión de voz cuando escuchas música más rápida o más lenta"
                    checked={preservesPitch}
                    onToggle={() => setPreservesPitch(!preservesPitch)}
                  />

                  <div className="space-y-2 border-t pm-border pt-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold pm-text-primary">Balance estéreo (L / R)</span>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums pm-text-secondary">
                          {stereoBalance === 0
                            ? 'Centro'
                            : stereoBalance < 0
                              ? `Izq ${Math.abs(Math.round(stereoBalance * 100))}%`
                              : `Der ${Math.round(stereoBalance * 100)}%`}
                        </span>
                        {stereoBalance !== 0 && (
                          <button
                            type="button"
                            onClick={() => setStereoBalance(0)}
                            className="pm-btn-secondary rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                          >
                            Centrar
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      aria-label="Balance estéreo"
                      value={stereoBalance}
                      onChange={(e) => setStereoBalance(Number(e.target.value))}
                      style={{ '--pm-fill': `${balancePct}%` } as React.CSSProperties}
                      className="w-full"
                    />
                  </div>

                  <div className="border-t pm-border pt-2">
                    <SwitchRow
                      title="Audio Mono"
                      description="Une los canales izquierdo y derecho (ideal para un solo auricular)"
                      checked={monoAudio}
                      onToggle={() => setMonoAudio(!monoAudio)}
                    />
                    <SwitchRow
                      title="Reproducción automática continua"
                      description="Sigue enlazando recomendaciones al terminar la cola o playlist"
                      checked={autoplayEnabled}
                      onToggle={() => setAutoplayEnabled(!autoplayEnabled)}
                    />
                  </div>
                </section>
              </div>
            )}

            {/* 3. SESIÓN DJ */}
            {activeCategory === 'dj' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-bold pm-text-primary">
                    Motor inteligente DJ AutoMix y 3-Stems
                  </h3>
                  <p className="text-xs pm-text-secondary">
                    Estudia BPM, fase rítmica, energía vocal y curva de graves para esculpir cada mezcla entre 2 temas
                  </p>
                </div>

                <section
                  data-surface="content"
                  className="pm-surface-card space-y-4 rounded-[16px] p-4"
                >
                  <SwitchRow
                    title="Activar Modo Sesión DJ"
                    description="Mezclas automáticas sincronizadas sin silencios ni cortes bruscos"
                    checked={djMode.enabled}
                    onToggle={() => void toggleDjMode()}
                  />

                  <div className="grid grid-cols-1 gap-2.5 border-t pm-border pt-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void setDjSessionStyle('quick')}
                      className={`rounded-[14px] p-3.5 text-left ${
                        djMode.style === 'quick' ? 'pm-btn-primary' : 'pm-btn-secondary'
                      }`}
                    >
                      <div className="text-sm font-bold">Sesión rápida (45–90 s)</div>
                      <div className="mt-0.5 text-xs opacity-80">
                        Busca el mejor estribillo/drop y encadena temas con ritmo de set
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void setDjSessionStyle('full')}
                      className={`rounded-[14px] p-3.5 text-left ${
                        djMode.style === 'full' ? 'pm-btn-primary' : 'pm-btn-secondary'
                      }`}
                    >
                      <div className="text-sm font-bold">Sesión completa</div>
                      <div className="mt-0.5 text-xs opacity-80">
                        Respeta el tema íntegro y busca la ventana limpia al final
                      </div>
                    </button>
                  </div>

                  <div className="divide-y pm-border border-t pm-border pt-2">
                    <SwitchRow
                      title="Esculpido inteligente 3-Stems (Bajos / Voces / Agudos)"
                      description="Intercambia graves, abre platillos y ajusta sonoridad según la pareja de pistas"
                      checked={djMode.stemSculpting !== false}
                      onToggle={() => setDjStemSculpting(djMode.stemSculpting === false)}
                    />
                    <SwitchRow
                      title="Protección anti-choque vocal"
                      description="Recorta la presencia vocal saliente (-8 a -18 dB) cuando dos cantantes coinciden"
                      checked={djMode.vocalClashProtection !== false}
                      onToggle={() =>
                        setDjVocalClashProtection(djMode.vocalClashProtection === false)
                      }
                    />
                    <SwitchRow
                      title="Beatmatch de tempo (±4%)"
                      description="Alinea suavemente los BPM de canciones cercanas durante la transición"
                      checked={djMode.tempoMatching}
                      onToggle={() => toggleDjFx('eq_swap')}
                    />
                    <SwitchRow
                      title="Reordenación armónica automática"
                      description="Ordena la cola por compatibilidad Camelot, energía y BPM al activar DJ"
                      checked={djMode.autoReorderQueue}
                      onToggle={() => setDjAutoReorder(!djMode.autoReorderQueue)}
                    />
                  </div>
                </section>
              </div>
            )}

            {/* 4. DISCORD RICH PRESENCE */}
            {activeCategory === 'discord' && (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xl font-bold pm-text-primary">
                      Discord Rich Presence
                    </h3>
                    <p className="text-xs pm-text-secondary">
                      Muestra lo que escuchas en tu perfil de Discord con carátula real y barra de progreso
                    </p>
                  </div>
                  <span className="pm-panel inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        discordRpcStatus.connected
                          ? 'bg-[#34D399]'
                          : discordRpcStatus.status === 'needs_client_id'
                            ? 'bg-[#FBBF24]'
                            : 'bg-[#8E8E98]'
                      }`}
                    />
                    <span>{statusBadgeText}</span>
                  </span>
                </div>

                {/* Live Discord Activity Card Preview */}
                <section
                  data-surface="content"
                  className="pm-surface-card space-y-3 rounded-[16px] p-4"
                >
                  <div className="text-[11px] font-bold tracking-wider pm-text-tertiary">
                    VISTA PREVIA EN TU PERFIL DE DISCORD
                  </div>
                  <div className="pm-panel flex items-center gap-3.5 rounded-[14px] p-3.5">
                    {discordRpcConfig.showArtwork && (
                      <img
                        src={currentTrack.thumbnailHighUrl ?? currentTrack.thumbnailUrl}
                        alt={currentTrack.title}
                        className="h-16 w-16 shrink-0 rounded-[10px] object-cover shadow-md"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-[#5865F2]">
                        Escuchando {discordRpcConfig.displayMode === 'artist'
                          ? currentTrack.artists[0]?.name ?? 'pMusic'
                          : discordRpcConfig.displayMode === 'song'
                            ? currentTrack.title
                            : 'pMusic'}
                      </div>
                      <div className="truncate text-sm font-bold pm-text-primary">
                        {currentTrack.title}
                      </div>
                      <div className="truncate text-xs pm-text-secondary">
                        {currentTrack.artists.map((a) => a.name).join(', ')}
                      </div>
                      {discordRpcConfig.showTimestamps && (
                        <div className="tabular-nums text-[11px] pm-text-tertiary">
                          {formatDurationSec(positionSec)} / {formatDurationSec(durationSec)}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section
                  data-surface="content"
                  className="pm-surface-card space-y-4 rounded-[16px] p-4"
                >
                  <SwitchRow
                    title="Activar Discord Rich Presence"
                    description="Envía la pista actual a Discord Desktop mediante IPC local"
                    checked={discordRpcEnabled}
                    onToggle={() => setDiscordRpcEnabled(!discordRpcEnabled)}
                  />

                  <div className="space-y-2 border-t pm-border pt-3">
                    <label
                      htmlFor="discord-client-id"
                      className="block text-xs font-bold pm-text-primary"
                    >
                      Discord Application Client ID
                    </label>
                    <p className="text-[11.5px] pm-text-secondary">
                      Crea una aplicación gratuita llamada <strong>pMusic</strong> en{' '}
                      <code className="pm-panel rounded px-1.5 py-0.5">discord.com/developers/applications</code>{' '}
                      y pega aquí su <em>Application ID</em> para activar la conexión real en Windows.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="discord-client-id"
                        type="text"
                        placeholder="Ej. 1310364700018151526"
                        value={clientIdInput}
                        onChange={(e) => setClientIdInput(e.target.value)}
                        className="pm-input tabular-nums flex-1 rounded-full px-4 py-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await setDiscordRpcConfig({ clientId: clientIdInput.trim() }, true);
                          showToast('Configuración de Discord guardada');
                        }}
                        className="pm-btn-primary inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Guardar y reconectar</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await reconnectDiscordRpc();
                          showToast('Reconectando Discord RPC...');
                        }}
                        className="pm-btn-secondary rounded-full px-4 py-2 text-xs font-semibold"
                      >
                        Probar conexión
                      </button>
                    </div>
                    {discordRpcStatus.lastError && (
                      <p className="text-[11px] font-medium text-[#F87171]">
                        Detalle: {discordRpcStatus.lastError}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2 border-t pm-border pt-3">
                    <div className="text-xs font-bold pm-text-primary">
                      Qué mostrar junto a "Escuchando..."
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: 'song', label: 'Título de la canción' },
                          { id: 'artist', label: 'Nombre del artista' },
                          { id: 'app', label: 'Nombre pMusic' },
                        ] as const
                      ).map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => void setDiscordRpcConfig({ displayMode: mode.id })}
                          className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                            discordRpcConfig.displayMode === mode.id
                              ? 'pm-btn-primary'
                              : 'pm-btn-secondary'
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="divide-y pm-border border-t pm-border pt-2">
                    <SwitchRow
                      title="Mostrar carátula del álbum"
                      description="Envía la portada oficial de la canción en la tarjeta de Discord"
                      checked={discordRpcConfig.showArtwork}
                      onToggle={() =>
                        void setDiscordRpcConfig({ showArtwork: !discordRpcConfig.showArtwork })
                      }
                    />
                    <SwitchRow
                      title="Mostrar barra de tiempo y duración"
                      description="Calcula inicio y fin en directo en Discord"
                      checked={discordRpcConfig.showTimestamps}
                      onToggle={() =>
                        void setDiscordRpcConfig({
                          showTimestamps: !discordRpcConfig.showTimestamps,
                        })
                      }
                    />
                    <SwitchRow
                      title="Mantener presencia al pausar"
                      description="Si se desactiva, limpia tu estado de Discord al pulsar Pausa"
                      checked={discordRpcConfig.showWhenPaused}
                      onToggle={() =>
                        void setDiscordRpcConfig({
                          showWhenPaused: !discordRpcConfig.showWhenPaused,
                        })
                      }
                    />
                  </div>
                </section>
              </div>
            )}

            {/* 5. REPRODUCCIÓN Y SUEÑO */}
            {activeCategory === 'reproduccion' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-bold pm-text-primary">
                    Temporizador y Letras sincronizadas
                  </h3>
                  <p className="text-xs pm-text-secondary">
                    Detén la música automáticamente y personaliza cómo lees las letras
                  </p>
                </div>

                <section
                  data-surface="content"
                  className="pm-surface-card space-y-3 rounded-[16px] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold pm-text-primary">
                        Temporizador de sueño
                      </div>
                      <div className="text-xs pm-text-secondary">
                        {sleepTimerMode === 'minutes'
                          ? `Pausa automática en ${formatDurationSec(sleepTimerRemainingSec)}`
                          : sleepTimerMode === 'end_of_track'
                            ? 'Se pausará al terminar esta canción'
                            : 'Elige cuándo detener la música automáticamente'}
                      </div>
                    </div>
                    {sleepTimerMode !== 'off' && (
                      <button
                        type="button"
                        onClick={() => cancelSleepTimer()}
                        className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-bold text-[#F87171]"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[15, 30, 45, 60].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSleepTimer(m)}
                        className="pm-btn-secondary rounded-full px-4 py-1.5 text-xs font-bold"
                      >
                        {m} min
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSleepTimer('end_of_track')}
                      className={`rounded-full px-4 py-1.5 text-xs font-bold ${
                        sleepTimerMode === 'end_of_track' ? 'pm-btn-primary' : 'pm-btn-secondary'
                      }`}
                    >
                      Fin de canción
                    </button>
                  </div>
                </section>

                <section
                  data-surface="content"
                  className="pm-surface-card space-y-4 rounded-[16px] p-4"
                >
                  <div className="space-y-2">
                    <div className="text-sm font-bold pm-text-primary">
                      Tamaño de fuente en Letras Sing
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'normal', label: 'Compacto' },
                          { id: 'large', label: 'Grande' },
                          { id: 'xl', label: 'Gigante' },
                        ] as const
                      ).map((sz) => (
                        <button
                          key={sz.id}
                          type="button"
                          onClick={() => setLyricsSize(sz.id)}
                          className={`rounded-[12px] py-2 text-xs font-bold ${
                            lyricsSize === sz.id ? 'pm-btn-primary' : 'pm-btn-secondary'
                          }`}
                        >
                          {sz.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t pm-border pt-2">
                    <SwitchRow
                      title="Desenfoque de profundidad en versos inactivos"
                      description="Mantiene el foco visual sobre la frase exacta que está sonando"
                      checked={lyricsBlurEnabled}
                      onToggle={() => setLyricsBlurEnabled(!lyricsBlurEnabled)}
                    />
                  </div>
                </section>
              </div>
            )}

            {/* 6. CUENTA Y DATOS */}
            {activeCategory === 'cuenta' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-bold pm-text-primary">
                    Cuenta pMusic, Copia JSON y Almacenamiento
                  </h3>
                  <p className="text-xs pm-text-secondary">
                    Guarda tu biblioteca en la nube con tu cuenta pMusic para escuchar desde cualquier dispositivo o exporta tus listas
                  </p>
                </div>

                <section
                  data-surface="content"
                  className="pm-surface-card space-y-3 rounded-[16px] p-4"
                >
                  <div>
                    <h4 className="text-sm font-bold pm-text-primary">
                      Tu cuenta pMusic
                    </h4>
                    <p className="text-xs pm-text-secondary">
                      La sincronización entre PC y móvil se conecta automáticamente al iniciar sesión con tu cuenta
                    </p>
                  </div>

                  <div>
                    {authState.connected ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border pm-border px-3.5 py-2.5">
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-[#34D399]">
                            Sesión iniciada · Sincronización en la nube activa
                          </div>
                          <div className="text-xs pm-text-secondary">
                            {authState.email}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void signOutSupabase()}
                          className="pm-btn-secondary rounded-full px-3.5 py-1.5 text-xs font-semibold text-[#F87171]"
                        >
                          Cerrar sesión
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="email"
                          aria-label="Correo electrónico"
                          placeholder="tu@email.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pm-input min-w-[180px] flex-1 rounded-full px-4 py-2 text-xs"
                        />
                        <input
                          type="password"
                          aria-label="Contraseña"
                          placeholder="Contraseña"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pm-input min-w-[150px] flex-1 rounded-full px-4 py-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await signInSupabase(
                                email || 'pablo@pmusic.es',
                                password || 'pmusic123'
                              );
                              setAuthNotice('Sesión iniciada.');
                            } catch (err) {
                              setAuthNotice(
                                err instanceof Error ? err.message : 'Error de acceso'
                              );
                            }
                          }}
                          className="pm-btn-primary rounded-full px-4 py-2 text-xs font-bold"
                        >
                          Iniciar sesión
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await signUpSupabase(
                                email || 'pablo@pmusic.es',
                                password || 'pmusic123'
                              );
                              setAuthNotice('Cuenta creada.');
                            } catch (err) {
                              setAuthNotice(
                                err instanceof Error ? err.message : 'Error al registrar'
                              );
                            }
                          }}
                          className="pm-btn-secondary rounded-full px-4 py-2 text-xs font-semibold"
                        >
                          Crear cuenta
                        </button>
                      </div>
                    )}
                    {authNotice && (
                      <p className="mt-2 text-xs font-medium text-[#34D399]">{authNotice}</p>
                    )}
                  </div>
                </section>

                {/* Backup & Offline */}
                <section
                  data-surface="content"
                  className="pm-surface-card space-y-3 rounded-[16px] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold pm-text-primary">
                        Copia de seguridad portátil (JSON)
                      </div>
                      <div className="text-xs pm-text-secondary">
                        Guarda o restaura tus playlists locales y canciones que te gustan
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadJsonBackup}
                        className="pm-btn-primary inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Exportar JSON</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="pm-btn-secondary inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        <span>Restaurar JSON</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const text = await file.text();
                          await importLibraryJson(text);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t pm-border pt-3">
                    <div>
                      <div className="text-sm font-bold pm-text-primary">
                        Caché offline ({offlineEntries.length} canciones ·{' '}
                        {(totalOfflineBytes / 1024).toFixed(0)} KB)
                      </div>
                      <div className="text-xs pm-text-secondary">
                        Pistas descargadas en este dispositivo
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void clearOfflineCache()}
                      className="pm-btn-secondary rounded-full px-4 py-1.5 text-xs font-semibold text-[#F87171]"
                    >
                      Vaciar caché
                    </button>
                  </div>

                  <div className="border-t pm-border pt-3">
                    <div className="mb-2 text-xs font-bold pm-text-primary">
                      Atajos de teclado
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[11.5px] sm:grid-cols-3">
                      {[
                        ['Espacio', 'Play / Pausa'],
                        ['Ctrl+K / /', 'Buscador Spotlight'],
                        ['← / →', 'Canción anterior / siguiente'],
                        ['Shift + ← / →', 'Retroceder / Avanzar 5 s'],
                        ['↑ / ↓', 'Subir / Bajar volumen'],
                        ['L', 'Abrir Letras Sing'],
                        ['Q', 'Abrir Cola DJ'],
                        ['D', 'Activar / Pausar DJ'],
                        ['S / R', 'Aleatorio / Repetir'],
                        ['M', 'Silenciar'],
                      ].map(([key, desc]) => (
                        <div key={key} className="pm-panel flex items-center justify-between rounded-lg px-2.5 py-1.5">
                          <kbd className="font-bold pm-text-primary">{key}</kbd>
                          <span className="pm-text-secondary">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
