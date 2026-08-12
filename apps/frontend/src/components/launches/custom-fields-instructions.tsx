import type { CustomFieldsInstructionsDefinition } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import React, { FC, useId, useState } from 'react';

export type CustomFieldsInstructionsData = CustomFieldsInstructionsDefinition;

export const CustomFieldsInstructions: FC<{
  instructions?: CustomFieldsInstructionsData;
}> = ({ instructions }) => {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  if (!instructions) {
    return null;
  }

  const copy = (value: string) => t(value, value);
  const guideBody = (
    <div className="p-[14px] text-[14px] text-textColor">
      <p>{copy(instructions.title)}</p>
      <ol className="mt-[8px] list-decimal space-y-[6px] ps-[20px]">
        {instructions.items.map((item) => (
          <li key={item}>{copy(item)}</li>
        ))}
      </ol>
      {instructions.note ? (
        <p className="mt-[8px] text-textColor/70">{copy(instructions.note)}</p>
      ) : null}
      {instructions.notRequired ? (
        <p className="mt-[8px]">{copy(instructions.notRequired)}</p>
      ) : null}
      {instructions.warning ? (
        <p className="mt-[8px]">{copy(instructions.warning)}</p>
      ) : null}
    </div>
  );

  if (instructions.collapsible) {
    return (
      <div className="w-full rounded-[8px] border border-tableBorder bg-sixth">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
          className="w-full cursor-pointer p-[14px] text-start text-[14px] text-textColor"
        >
          {copy(instructions.summary || instructions.title)}
        </button>
        {expanded ? <div id={contentId}>{guideBody}</div> : null}
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-tableBorder bg-sixth p-[14px] text-[14px] text-textColor">
      <p>{copy(instructions.title)}</p>
      <ul className="mt-[8px] list-disc space-y-[4px] ps-[20px]">
        {instructions.items.map((item) => (
          <li key={item}>{copy(item)}</li>
        ))}
      </ul>
      {instructions.note ? (
        <p className="mt-[8px] text-textColor/70">{copy(instructions.note)}</p>
      ) : null}
      {instructions.notRequired ? (
        <p className="mt-[8px]">{copy(instructions.notRequired)}</p>
      ) : null}
      {instructions.warning ? (
        <p className="mt-[8px]">{copy(instructions.warning)}</p>
      ) : null}
    </div>
  );
};
