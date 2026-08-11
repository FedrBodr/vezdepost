'use client';

import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
import React from 'react';

export const SanitizedPostContent = ({ content }: { content: unknown }) => {
  return (
    <div
      className="text-sm whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: sanitizePostContent(content) }}
    />
  );
};
