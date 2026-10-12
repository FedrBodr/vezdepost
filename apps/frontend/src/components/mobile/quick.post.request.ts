export type QuickPostMedia = { id: string; path: string };
export type QuickPostSchedule =
  | { type: 'now' }
  | { type: 'queue' }
  | { type: 'date'; date: string };
export type QuickPostDraft = {
  text: string;
  media: QuickPostMedia[];
  selected: string[];
  schedule: QuickPostSchedule;
};

export const emptyDraft = (): QuickPostDraft => ({
  text: '',
  media: [],
  selected: [],
  schedule: { type: 'now' },
});

/** Russian reason the draft cannot be sent, or null when it can. */
export const draftProblem = (draft: QuickPostDraft): string | null => {
  if (!draft.text.trim() && draft.media.length === 0) {
    return 'Добавьте текст или фото';
  }
  if (draft.selected.length === 0) {
    return 'Выберите хотя бы один канал';
  }
  if (draft.schedule.type === 'date' && !draft.schedule.date) {
    return 'Выберите дату';
  }
  return null;
};

export const toQuickPostBody = (draft: QuickPostDraft) => ({
  text: draft.text,
  media: draft.media.map(({ id, path }) => ({ id, path })),
  integrationIds: draft.selected,
  schedule:
    draft.schedule.type === 'date'
      ? { type: 'date' as const, date: draft.schedule.date }
      : { type: draft.schedule.type },
});

/** datetime-local gives local wall time without a zone; the API wants ISO. */
export const localDateTimeToIso = (value: string) =>
  new Date(value).toISOString();
