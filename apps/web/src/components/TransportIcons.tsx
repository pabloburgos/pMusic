import React from 'react';

interface TransportIconProps {
  className?: string;
  animate?: boolean;
  filled?: boolean;
}

export const RoundedPlayIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M7.8 4.4C6.5 3.65 5 4.58 5 6.08V17.92C5 19.42 6.5 20.35 7.8 19.6L18.4 13.68C19.72 12.94 19.72 11.06 18.4 10.32L7.8 4.4Z" />
  </svg>
);

export const RoundedPauseIcon: React.FC<{ className?: string }> = ({
  className = 'h-5 w-5',
}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <rect x="5.5" y="4.2" width="4.8" height="15.6" rx="2.4" />
    <rect x="13.7" y="4.2" width="4.8" height="15.6" rx="2.4" />
  </svg>
);

export const AnimatedSkipForwardIcon: React.FC<TransportIconProps> = ({
  className = 'h-4 w-4',
  animate = false,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={`overflow-visible ${className} ${animate ? 'pm-skip-next-hyper' : ''}`}
  >
    {/* Incoming twin rounded chevron gliding in behind the outgoing chevron */}
    <path
      d="M5.6 5.4 C4.6 4.78 3.5 5.5 3.5 6.68 V17.32 C3.5 18.5 4.6 19.22 5.6 18.6 L14.4 13.28 C15.38 12.69 15.38 11.31 14.4 10.72 L5.6 5.4 Z"
      className={animate ? 'pm-skip-chevron-in' : 'opacity-0'}
    />
    {/* Primary rounded chevron shooting forward through the bumper */}
    <path
      d="M5.6 5.4 C4.6 4.78 3.5 5.5 3.5 6.68 V17.32 C3.5 18.5 4.6 19.22 5.6 18.6 L14.4 13.28 C15.38 12.69 15.38 11.31 14.4 10.72 L5.6 5.4 Z"
      className={animate ? 'pm-skip-chevron-out' : ''}
    />
    {/* Right vertical rounded pill bumper with magnetic recoil */}
    <rect
      x="17.2"
      y="5"
      width="2.8"
      height="14"
      rx="1.4"
      className={animate ? 'pm-skip-bumper-next' : ''}
    />
  </svg>
);

export const AnimatedSkipBackIcon: React.FC<TransportIconProps> = ({
  className = 'h-4 w-4',
  animate = false,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={`overflow-visible ${className} ${animate ? 'pm-skip-prev-hyper' : ''}`}
  >
    {/* Left vertical rounded pill bumper with magnetic recoil */}
    <rect
      x="4"
      y="5"
      width="2.8"
      height="14"
      rx="1.4"
      className={animate ? 'pm-skip-bumper-prev' : ''}
    />
    {/* Incoming twin left-pointing rounded chevron gliding in from right */}
    <path
      d="M18.4 5.4 C19.4 4.78 20.5 5.5 20.5 6.68 V17.32 C20.5 18.5 19.4 19.22 18.4 18.6 L9.6 13.28 C8.62 12.69 8.62 11.31 9.6 10.72 L18.4 5.4 Z"
      className={animate ? 'pm-skip-back-chevron-in' : 'opacity-0'}
    />
    {/* Primary left-pointing rounded chevron darting through the bumper */}
    <path
      d="M18.4 5.4 C19.4 4.78 20.5 5.5 20.5 6.68 V17.32 C20.5 18.5 19.4 19.22 18.4 18.6 L9.6 13.28 C8.62 12.69 8.62 11.31 9.6 10.72 L18.4 5.4 Z"
      className={animate ? 'pm-skip-back-chevron-out' : ''}
    />
  </svg>
);

export const AnimatedShuffleIcon: React.FC<{ className?: string; animate?: boolean }> = ({
  className = 'h-4 w-4',
  animate = false,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`overflow-visible ${className} ${animate ? 'pm-shuffle-chaos-epic' : ''}`}
  >
    {/* Lane A: Bottom-left to Top-right crossing curve */}
    <g className={animate ? 'pm-shuffle-lane-a' : ''}>
      <path
        pathLength={1}
        d="M2 18 H5.2 C7.8 18 9.2 15 12 12 C14.8 9 16.2 6 18.8 6 H21.5"
        className={animate ? 'pm-shuffle-stroke-a' : ''}
      />
      <polyline points="18.5 2.8 22 6 18.5 9.2" />
    </g>
    {/* Lane B: Top-left to Bottom-right crossing curve */}
    <g className={animate ? 'pm-shuffle-lane-b' : ''}>
      <path
        pathLength={1}
        d="M2 6 H5.2 C7.8 6 9.2 9 12 12 C14.8 15 16.2 18 18.8 18 H21.5"
        className={animate ? 'pm-shuffle-stroke-b' : ''}
      />
      <polyline points="18.5 14.8 22 18 18.5 21.2" />
    </g>
  </svg>
);
