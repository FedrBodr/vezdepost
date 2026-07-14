import React, { FC } from 'react';

export type CustomFieldsInstructionsData = {
  title: string;
  items: string[];
  note?: string;
};

export const CustomFieldsInstructions: FC<{
  instructions?: CustomFieldsInstructionsData;
}> = ({ instructions }) => {
  if (!instructions) {
    return null;
  }

  return (
    <div className="rounded-[8px] border border-tableBorder bg-sixth p-[14px] text-[14px] text-textColor">
      <p>{instructions.title}</p>
      <ul className="mt-[8px] list-disc space-y-[4px] ps-[20px]">
        {instructions.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {instructions.note ? (
        <p className="mt-[8px] text-textColor/70">{instructions.note}</p>
      ) : null}
    </div>
  );
};
