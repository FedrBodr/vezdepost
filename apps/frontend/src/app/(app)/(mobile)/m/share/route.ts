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

/**
 * Android Web Share Target: files and text arrive here as multipart/form-data.
 * The path is excluded from the proxy matcher (its body clone is capped at
 * 10 MB), so the auth check happens here.
 */
export async function POST(request: NextRequest) {
  if (!request.cookies.get('auth') && !request.headers.get('auth')) {
    return NextResponse.redirect(
      new URL('/auth?returnUrl=%2Fm', request.nextUrl.href),
      303
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.redirect(
      new URL('/m?share_error=1', request.nextUrl.href),
      303
    );
  }
  const target = await handleShare(form, { upload });
  return NextResponse.redirect(new URL(target, request.nextUrl.href), 303);
}

/** A plain GET (someone typing the URL) just opens the editor. */
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/m', request.nextUrl.href), 307);
}
