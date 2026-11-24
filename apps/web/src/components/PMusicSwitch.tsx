import React from 'react';

export interface PMusicSwitchProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
  testId?: string;
  variant?: 'theme' | 'hud';
  className?: string;
}

/**
 * Canonical pMusic pill toggle switch modeled directly after the Ecualizador switch.
 * Explicitly exempt from global HIG touch min-height inflation via `.pm-switch-control`.
 */
export const PMusicSwitch: React.FC<PMusicSwitchProps> = ({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
  testId,
  variant = 'theme',
  className = '',
}) => {
  const isHud = variant === 'hud';

  const trackClass = checked
    ? isHud
      ? 'bg-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]'
      : 'bg-[var(--pm-accent-primary)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]'
    : isHud
      ? 'bg-white/25 ring-1 ring-inset ring-white/15'
      : 'bg-[var(--pm-text-primary)]/20 ring-1 ring-inset ring-[var(--pm-text-primary)]/18';

  const knobClass = checked
    ? isHud
      ? 'translate-x-5 bg-[#0A0A0F]'
      : 'translate-x-5 bg-[var(--pm-accent-fg)]'
    : isHud
      ? 'translate-x-0 bg-white'
      : 'translate-x-0 bg-[var(--pm-text-primary)] opacity-85';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange();
      }}
      className={`pm-switch-control relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pm-accent-primary)] disabled:cursor-not-allowed disabled:opacity-45 ${trackClass} ${className}`}
    >
      <span
        className={`pointer-events-none block h-5 w-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.45)] transition-transform duration-200 ${knobClass}`}
      />
    </button>
  );
};
