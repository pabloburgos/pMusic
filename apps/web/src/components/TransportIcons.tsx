import React from 'react';

interface TransportIconProps {
  className?: string;
  animate?: boolean;
  filled?: boolean;
}

export const RoundedPlayIcon: React.FC<{ className?: string }> = ({
  className = 'h-6 w-6',
}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M6.4 3.4C5.0 2.58 3.4 3.6 3.4 5.2V18.8C3.4 20.4 5.0 21.42 6.4 20.6L19.4 13.8C20.85 13.04 20.85 10.96 19.4 10.2L6.4 3.4Z" />
  </svg>
);

export const RoundedPauseIcon: React.FC<{ className?: string }> = ({
  className = 'h-6 w-6',
}) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <rect x="4.6" y="3" width="5.6" height="18" rx="2.8" />
    <rect x="13.8" y="3" width="5.6" height="18" rx="2.8" />
  </svg>
);

export const AnimatedSkipForwardIcon: React.FC<TransportIconProps> = ({
  className = 'h-5 w-5',
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
      d="M4.8 4.4 C3.7 3.72 2.4 4.52 2.4 5.82 V18.18 C2.4 19.48 3.7 20.28 4.8 19.6 L14.8 13.42 C15.88 12.76 15.88 11.24 14.8 10.58 L4.8 4.4 Z"
      className={animate ? 'pm-skip-chevron-in' : 'opacity-0'}
    />
    {/* Primary rounded chevron shooting forward through the bumper */}
    <path
      d="M4.8 4.4 C3.7 3.72 2.4 4.52 2.4 5.82 V18.18 C2.4 19.48 3.7 20.28 4.8 19.6 L14.8 13.42 C15.88 12.76 15.88 11.24 14.8 10.58 L4.8 4.4 Z"
      className={animate ? 'pm-skip-chevron-out' : ''}
    />
    {/* Right vertical rounded pill bumper with magnetic recoil */}
    <rect
      x="17.8"
      y="4.2"
      width="3.2"
      height="15.6"
      rx="1.6"
      className={animate ? 'pm-skip-bumper-next' : ''}
    />
  </svg>
);

export const AnimatedSkipBackIcon: React.FC<TransportIconProps> = ({
  className = 'h-5 w-5',
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
      x="3.0"
      y="4.2"
      width="3.2"
      height="15.6"
      rx="1.6"
      className={animate ? 'pm-skip-bumper-prev' : ''}
    />
    {/* Incoming twin left-pointing rounded chevron gliding in from right */}
    <path
      d="M19.2 4.4 C20.3 3.72 21.6 4.52 21.6 5.82 V18.18 C21.6 19.48 20.3 20.28 19.2 19.6 L9.2 13.42 C8.12 12.76 8.12 11.24 9.2 10.58 L19.2 4.4 Z"
      className={animate ? 'pm-skip-back-chevron-in' : 'opacity-0'}
    />
    {/* Primary left-pointing rounded chevron darting through the bumper */}
    <path
      d="M19.2 4.4 C20.3 3.72 21.6 4.52 21.6 5.82 V18.18 C21.6 19.48 20.3 20.28 19.2 19.6 L9.2 13.42 C8.12 12.76 8.12 11.24 9.2 10.58 L19.2 4.4 Z"
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
