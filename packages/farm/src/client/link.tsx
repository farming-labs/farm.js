import type React from 'react';
import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { useBasePath } from '../provider';

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string;
  prefetch?: boolean;
}

/**
 * Next.js-style Link component for client-side navigation
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(
  ({ href, prefetch = true, onClick, ...props }, ref) => {
    const basePath = useBasePath();

    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Call custom onClick if provided
      if (onClick) {
        onClick(event);
      }

      // Handle client-side navigation
      if (!event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        event.preventDefault();

        // Use browser's navigation API if available, otherwise fallback to location
        if (typeof window !== 'undefined') {
          const url = href.startsWith('/') ? basePath + href : href;
          window.location.href = url;
        }
      }
    };

    // Combine base path with href
    const fullHref = href.startsWith('/') ? basePath + href : href;

    return <a ref={ref} href={fullHref} onClick={handleClick} {...props} />;
  }
);

Link.displayName = 'Link';
