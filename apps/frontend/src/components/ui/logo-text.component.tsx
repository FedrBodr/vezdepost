import React from 'react';

export const LogoTextComponent = () => {
  return (
    <div className="flex items-center gap-[10px]">
      <img
        src="/vezdepost-icon.png"
        width={33}
        height={33}
        alt=""
        className="w-[33px] h-[33px]"
      />
      <span className="text-[22px] font-[600] leading-none">Vezdepost</span>
    </div>
  );
};
