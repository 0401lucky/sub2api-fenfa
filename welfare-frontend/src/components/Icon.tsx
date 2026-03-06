import type { SVGProps } from 'react';

type IconName = 'chart' | 'gift' | 'link' | 'settings' | 'shield';

type IconProps = SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: number;
};

function IconPath({ name }: { name: IconName }) {
  switch (name) {
    case 'link':
      return (
        <>
          <path d="M10 14L8.5 15.5a3 3 0 1 1-4.24-4.24L7 8.5A3 3 0 0 1 11.24 8" />
          <path d="M14 10l1.5-1.5a3 3 0 1 1 4.24 4.24L17 15.5A3 3 0 0 1 12.76 16" />
          <path d="M9 12h6" />
        </>
      );
    case 'gift':
      return (
        <>
          <path d="M4 10h16v10H4z" />
          <path d="M12 10v10" />
          <path d="M3 10h18v-3H3z" />
          <path d="M12 7c0-1.66-1.12-3-2.5-3S7 5.34 7 7c0 1.1.9 2 2 2h3V7z" />
          <path d="M12 7c0-1.66 1.12-3 2.5-3S17 5.34 17 7c0 1.1-.9 2-2 2h-3V7z" />
        </>
      );
    case 'settings':
      return (
        <>
          <path d="M4 21v-7" />
          <path d="M4 10V3" />
          <path d="M12 21v-10" />
          <path d="M12 7V3" />
          <path d="M20 21v-4" />
          <path d="M20 13V3" />
          <path d="M2 14h4" />
          <path d="M10 7h4" />
          <path d="M18 13h4" />
        </>
      );
    case 'chart':
      return (
        <>
          <path d="M4 20V11" />
          <path d="M10 20V7" />
          <path d="M16 20V13" />
          <path d="M22 20V4" />
          <path d="M3 20h20" />
        </>
      );
    case 'shield':
      return (
        <>
          <path d="M12 3l7 3v6c0 4.55-2.92 7.71-7 9-4.08-1.29-7-4.45-7-9V6l7-3z" />
          <path d="M9.5 12.5l1.75 1.75L15 10.5" />
        </>
      );
  }
}

export function Icon({ name, size = 18, className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <IconPath name={name} />
    </svg>
  );
}
