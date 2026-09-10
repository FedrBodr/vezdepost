'use client';

import React, { FC } from 'react';

export const StrikeText: FC<{ editor: any }> = ({ editor }) => {
  const toggle = () => {
    editor?.commands?.toggleStrike();
    editor?.commands?.focus();
  };

  return (
    <div
      data-tooltip-id="tooltip"
      data-tooltip-content="Strikethrough"
      onClick={toggle}
      className="select-none cursor-pointer rounded-[6px] w-[30px] h-[30px] bg-newColColor flex justify-center items-center line-through"
    >
      S
    </div>
  );
};
