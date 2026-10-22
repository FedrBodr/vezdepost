'use client';

import React from 'react';
import clsx from 'clsx';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export const LegalRequisites = ({ className }: { className?: string }) => {
  const { legalRequisites } = useVariables();

  if (!legalRequisites) {
    return null;
  }

  return (
    <div className={clsx('text-[12px] leading-[18px]', className)}>
      {legalRequisites}
    </div>
  );
};
