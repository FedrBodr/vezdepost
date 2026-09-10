'use client';

import React, { FC } from 'react';

export const OrderedList: FC<{ editor: any }> = ({ editor }) => {
  const toggle = () => {
    editor?.commands?.toggleOrderedList();
    editor?.commands?.focus();
  };

  return (
    <div
      data-tooltip-id="tooltip"
      data-tooltip-content="Numbered list"
      onClick={toggle}
      className="select-none cursor-pointer rounded-[6px] w-[30px] h-[30px] bg-newColColor flex justify-center items-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M6 4H14M6 8H14M6 12H14M2 3H3V5M2 8H3M2 12H3"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
