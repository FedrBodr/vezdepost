export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { MobilePostScreen } from '@gitroom/frontend/components/mobile/mobile.post.screen';

export const metadata: Metadata = { title: 'Vezdepost', description: '' };

export default function MobilePostPage() {
  return <MobilePostScreen />;
}
