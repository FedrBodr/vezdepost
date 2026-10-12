import { NextRequest, NextResponse } from 'next/server';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { handleShare } from '@gitroom/frontend/components/mobile/share.handler';

export const dynamic = 'force-dynamic';

const upload = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file, file.name);
  const response = await internalFetch('/media/upload-simple', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return typeof data?.id === 'string' && typeof data?.path === 'string'
    ? { id: data.id, path: data.path }
    : null;
};

/** Android Web Share Target: files and text arrive here as multipart/form-data. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const target = await handleShare(form, { upload });
  return NextResponse.redirect(new URL(target, request.nextUrl.href), 303);
}

/** A plain GET (someone typing the URL) just opens the editor. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/m', request.nextUrl.href), 307);
}
