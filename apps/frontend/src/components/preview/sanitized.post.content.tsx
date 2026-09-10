'use client';

import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
import React, { type CSSProperties } from 'react';

export const SanitizedPostContent = ({
  content,
  as: Component = 'div',
  className = 'text-sm whitespace-pre-wrap',
  style,
}: {
  content: unknown;
  as?: 'div' | 'span';
  className?: string;
  style?: CSSProperties;
}) => {
  return (
    <Component
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: sanitizePostContent(content) }}
    />
  );
};
