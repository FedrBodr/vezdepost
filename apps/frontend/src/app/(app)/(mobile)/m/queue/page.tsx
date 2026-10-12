export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { MobileQueueScreen } from '@gitroom/frontend/components/mobile/mobile.queue.screen';

export const metadata: Metadata = {
  title: 'Vezdepost — очередь',
  description: '',
};

export default function MobileQueuePage() {
  return <MobileQueueScreen />;
}
