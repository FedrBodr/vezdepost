export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { MobileChannelsScreen } from '@gitroom/frontend/components/mobile/mobile.channels.screen';

export const metadata: Metadata = {
  title: 'Vezdepost — каналы',
  description: '',
};

export default function MobileChannelsPage() {
  return <MobileChannelsScreen />;
}
