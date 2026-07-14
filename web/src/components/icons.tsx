type IconProps = { size?: number };

const strokeProps = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconX({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...strokeProps} aria-hidden="true">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

export function IconPlus({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...strokeProps} aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconSidebarToggle({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} {...strokeProps} aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6.5 3v10" />
    </svg>
  );
}

export function IconStop({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" rx="1.5" />
    </svg>
  );
}
