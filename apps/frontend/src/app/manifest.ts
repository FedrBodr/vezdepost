import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vezdepost',
    short_name: 'Vezdepost',
    description: 'Публикуйте в Telegram, VK, MAX и другие каналы с телефона',
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    background_color: '#0e0e0e',
    theme_color: '#0e0e0e',
    lang: 'ru',
    icons: [
      {
        src: '/icons/vezdepost-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/vezdepost-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    share_target: {
      action: '/m/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'media', accept: ['image/*', 'video/*'] }],
      },
    },
  };
}
