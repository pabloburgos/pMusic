import React from 'react';

interface TransportIconProps {
  className?: string;
  animate?: boolean;
  filled?: boolean;
}

export const AnimatedSkipForwardIcon: React.FC<TransportIconProps> = ({
  className = 'h-4 w-4',
  animate = false,
  filled = false,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`overflow-visible ${className} ${animate ? 'pm-skip-next-hyper' : ''}`}
  >
    {/* Incoming triangle sliding from left to replace the outgoing one */}
    <polygon
      points="5 4 15 12 5 20 5 4"
      fill={filled ? 'currentColor' : 'none'}
      className={animate ? 'pm-skip-tri-in' : 'opacity-0'}
    />
    {/* Primary triangle darting into the bumper bar */}
    <polygon
      points="5 4 15 12 5 20 5 4"
      fill={filled ? 'currentColor' : 'none'}
      className={animate ? 'pm-skip-tri-out' : ''}
    />
    {/* Vertical bumper bar reacting on impact */}
    <line
      x1="19"
      y1="5"
      x2="19"
      y2="19"
      className={animate ? 'pm-skip-bar-bump' : ''}
    />
  </svg>
);

export const AnimatedSkipBackIcon: React.FC<TransportIconProps> = ({
  className = 'h-4 w-4',
  animate = false,
  filled = false,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`overflow-visible ${className} ${animate ? 'pm-skip-prev-hyper' : ''}`}
  >
    {/* Vertical bumper bar reacting on impact */}
    <line
      x1="5"
      y1="19"
      x2="5"
      y2="5"
      className={animate ? 'pm-skip-back-bar-bump' : ''}
    />
    {/* Incoming triangle sliding from right */}
    <polygon
      points="19 20 9 12 19 4 19 20"
      fill={filled ? 'currentColor' : 'none'}
      className={animate ? 'pm-skip-back-tri-in' : 'opacity-0'}
    />
    {/* Primary triangle darting left into the bar */}
    <polygon
      points="19 20 9 12 19 4 19 20"
      fill={filled ? 'currentColor' : 'none'}
      className={animate ? 'pm-skip-back-tri-out' : ''}
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
