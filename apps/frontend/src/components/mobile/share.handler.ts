import { encodeSharePayload } from '@gitroom/frontend/components/mobile/share.payload';

type Uploaded = { id: string; path: string } | null;

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
};

/** Builds the /m redirect for a Web Share Target POST. */
export const handleShare = async (
  form: FormData,
  deps: { upload: (file: File) => Promise<Uploaded> }
): Promise<string> => {
  const parts = [
    text(form, 'title'),
    text(form, 'text'),
    text(form, 'url'),
  ].filter(Boolean);
  const files = form
    .getAll('media')
    .filter(
      (entry): entry is File => typeof entry !== 'string' && entry.size > 0
    );

  const media: { id: string; path: string }[] = [];
  for (const file of files) {
    const uploaded = await deps.upload(file);
    if (uploaded) {
      media.push(uploaded);
    }
  }

  const joined = parts.join('\n');
  if (!joined && media.length === 0) {
    return '/m';
  }
  return `/m?shared=${encodeSharePayload({ text: joined, media })}`;
};
