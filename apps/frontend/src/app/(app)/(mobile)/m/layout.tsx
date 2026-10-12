export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import { Viewport } from 'next';
import { MobileLayoutComponent } from '@gitroom/frontend/components/mobile/mobile.layout.component';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function MobileLayout({ children }: { children: ReactNode }) {
  return <MobileLayoutComponent>{children}</MobileLayoutComponent>;
}
