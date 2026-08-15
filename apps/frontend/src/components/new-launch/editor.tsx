'use client';

import React, {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  ClipboardEvent,
  forwardRef,
  useImperativeHandle,
} from 'react';
import clsx from 'clsx';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import EmojiPicker from 'emoji-picker-react';
import { Theme } from 'emoji-picker-react';
import { BoldText } from '@gitroom/frontend/components/new-launch/bold.text';
import { UText } from '@gitroom/frontend/components/new-launch/u.text';
import { SignatureBox } from '@gitroom/frontend/components/signature';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  SelectedIntegrations,
  useLaunchStore,
} from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { AddPostButton } from '@gitroom/frontend/components/new-launch/add.post.button';
import { MultiMediaComponent } from '@gitroom/frontend/components/media/media.component';
import { UpDownArrow } from '@gitroom/frontend/components/launches/up.down.arrow';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';
import { useDropzone } from 'react-dropzone';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import { Dashboard } from '@uppy/react';
import { useEditor, EditorContent, mergeAttributes } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { History } from '@tiptap/extension-history';
import { Bullets } from '@gitroom/frontend/components/new-launch/bullets.component';
import { HeadingComponent } from '@gitroom/frontend/components/new-launch/heading.component';
import Mention from '@tiptap/extension-mention';
import { suggestion } from '@gitroom/frontend/components/new-launch/mention.component';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { AComponent } from '@gitroom/frontend/components/new-launch/a.component';
import { Placeholder } from '@tiptap/extensions';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { InformationComponent } from '@gitroom/frontend/components/launches/information.component';
import {
  LockIcon,
  ConnectionLineIcon,
  ResetIcon,
  TrashIcon,
  EmojiIcon,
  DelayIcon,
} from '@gitroom/frontend/components/ui/icons';
import { DelayComponent } from '@gitroom/frontend/components/new-launch/delay.component';
import { PlainTextPasteExtension } from '@gitroom/frontend/components/new-launch/plain-text-paste.extension';
import {
  getFormattingControls,
  resolveEditorCapabilities,
} from '@gitroom/frontend/components/new-launch/platform.editor.capabilities';
import {
  createCanonicalEditorExtensions,
  getEditorCreationPolicyKey,
} from '@gitroom/frontend/components/new-launch/platform.editor.extensions';
import {
  resolveIntegrationCapabilities,
  type PlatformCapabilities,
} from '@gitroom/helpers/utils/platform.capabilities';
import {
  analyzePlatformContent,
  analyzeSelectedPlatformContent,
  type PlatformContentAnalysis,
} from '@gitroom/helpers/utils/platform.content';
import { PlatformContentNotice } from '@gitroom/frontend/components/new-launch/platform.content.notice';
import { deriveGlobalTargets } from '@gitroom/frontend/components/new-launch/global.targets';

const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024; // 1 GB

const analyzeSourceOnlyContent = (
  input: Parameters<typeof analyzePlatformContent>[0]
): PlatformContentAnalysis => {
  const analysis = analyzePlatformContent(input);
  return { ...analysis, blocking: false, messages: [] };
};

export const EditorWrapper: FC<{
  totalPosts: number;
  value: string;
}> = () => {
  const t = useT();
  const {
    setGlobalValueText,
    setInternalValueText,
    addRemoveInternal,
    internal,
    internalChannels,
    global,
    current,
    setCurrent,
    addInternalValue,
    addGlobalValue,
    setInternalValueMedia,
    appendInternalValueMedia,
    appendGlobalValueMedia,
    setGlobalValueMedia,
    changeOrderGlobal,
    changeOrderInternal,
    isCreateSet,
    deleteGlobalValue,
    deleteInternalValue,
    setGlobalValue,
    setInternalValue,
    setInternalDelay,
    setGlobalDelay,
    postComment,
    dummy,
    editor,
    loadedState,
    setLoadedState,
    selectedIntegration,
    chars,
    comments,
  } = useLaunchStore(
    useShallow((state) => ({
      internal: state.internal.find((p) => p.integration.id === state.current),
      internalChannels: state.internal,
      global: state.global,
      comments: state.comments,
      current: state.current,
      setCurrent: state.setCurrent,
      addRemoveInternal: state.addRemoveInternal,
      dummy: state.dummy,
      setInternalValueText: state.setInternalValueText,
      setGlobalValueText: state.setGlobalValueText,
      addInternalValue: state.addInternalValue,
      addGlobalValue: state.addGlobalValue,
      setGlobalValueMedia: state.setGlobalValueMedia,
      setInternalValueMedia: state.setInternalValueMedia,
      changeOrderGlobal: state.changeOrderGlobal,
      changeOrderInternal: state.changeOrderInternal,
      isCreateSet: state.isCreateSet,
      deleteGlobalValue: state.deleteGlobalValue,
      deleteInternalValue: state.deleteInternalValue,
      setGlobalValue: state.setGlobalValue,
      setInternalValue: state.setInternalValue,
      setGlobalDelay: state.setGlobalDelay,
      setInternalDelay: state.setInternalDelay,
      appendInternalValueMedia: state.appendInternalValueMedia,
      appendGlobalValueMedia: state.appendGlobalValueMedia,
      postComment: state.postComment,
      editor: state.editor,
      loadedState: state.loaded,
      setLoadedState: state.setLoaded,
      selectedIntegration: state.selectedIntegrations,
      chars: state.chars,
    }))
  );

  const existingData = useExistingData();
  const [loaded, setLoaded] = useState(true);

  useEffect(() => {
    if (loaded && loadedState) {
      return;
    }

    setLoadedState(true);
    setLoaded(true);
  }, [loaded, loadedState]);

  const canEdit = useMemo(() => {
    return current === 'global' || !!internal;
  }, [current, internal]);

  const globalTargets = useMemo(
    () => deriveGlobalTargets(selectedIntegration, internalChannels),
    [selectedIntegration, internalChannels]
  );

  const capabilities = useMemo(
    () =>
      resolveEditorCapabilities(
        current,
        selectedIntegration,
        internalChannels,
        chars
      ),
    [current, selectedIntegration, internalChannels, chars]
  );

  const customizePlatform = useCallback(
    (targetIntegrationId: string) => {
      const target = selectedIntegration.find(
        (item) => item.integration.id === targetIntegrationId
      );
      if (!target) return;
      if (
        !internalChannels.some(
          (item) => item.integration.id === target.integration.id
        )
      ) {
        addRemoveInternal(target.integration.id);
      }
      setCurrent(target.integration.id);
    },
    [selectedIntegration, internalChannels, addRemoveInternal, setCurrent]
  );

  const items = useMemo(() => {
    if (internal) {
      return internal.integrationValue;
    }

    return global;
  }, [internal, global]);

  const setValue = useCallback(
    (value: string[]) => {
      const newValue = value.map((p, index) => {
        return {
          id: makeId(10),
          delay: 0,
          ...(items?.[index]?.media
            ? { media: items[index].media }
            : { media: [] }),
          content: p,
        };
      });
      if (internal) {
        return setInternalValue(current, newValue);
      }

      return setGlobalValue(newValue);
    },
    [internal, items]
  );

  useCopilotReadable({
    description: 'Current content of posts',
    value: items.map((p) => p.content),
  });

  useCopilotAction({
    name: 'setPosts',
    description: 'a thread of posts',
    parameters: [
      {
        name: 'content',
        type: 'string[]',
        description: 'a thread of posts',
      },
    ],
    handler: async ({ content }) => {
      setValue(content);
    },
  });

  const changeValue = useCallback(
    (index: number) => (value: string) => {
      if (internal) {
        return setInternalValueText(current, index, value);
      }

      return setGlobalValueText(index, value);
    },
    [current, global, internal]
  );

  const changeImages = useCallback(
    (index: number) => (value: any[]) => {
      if (internal) {
        return setInternalValueMedia(current, index, value);
      }

      return setGlobalValueMedia(index, value);
    },
    [current, global, internal]
  );

  const appendImages = useCallback(
    (index: number) => (value: any[]) => {
      if (internal) {
        return appendInternalValueMedia(current, index, value);
      }

      return appendGlobalValueMedia(index, value);
    },
    [current, global, internal]
  );

  const changeOrder = useCallback(
    (index: number) => (direction: 'up' | 'down') => {
      if (internal) {
        changeOrderInternal(current, index, direction);
        return setLoaded(false);
      }

      changeOrderGlobal(index, direction);
      setLoaded(false);
    },
    [changeOrderInternal, changeOrderGlobal, current, global, internal]
  );

  const goBackToGlobal = useCallback(async () => {
    if (
      await deleteDialog(
        t(
          'are_you_sure_go_back_to_global_mode',
          'This action is irreversible. Are you sure you want to go back to global mode?'
        ),
        t('yes_go_back_to_global_mode', 'Yes, go back to global mode')
      )
    ) {
      setLoaded(false);
      addRemoveInternal(current);
    }
  }, [addRemoveInternal, current, t]);

  const addValue = useCallback(
    (index: number) => () => {
      setTimeout(() => {
        // scroll the the bottom
        document.querySelector('#social-content').scrollTo({
          top: document.querySelector('#social-content').scrollHeight,
        });
      }, 20);
      if (internal) {
        return addInternalValue(index, current, [
          {
            delay: 0,
            content: '',
            id: makeId(10),
            media: [],
          },
        ]);
      }

      return addGlobalValue(index, [
        {
          delay: 0,
          content: '',
          id: makeId(10),
          media: [],
        },
      ]);
    },
    [current, global, internal]
  );

  const deletePost = useCallback(
    (index: number) => async () => {
      if (
        !(await deleteDialog(
          t(
            'are_you_sure_delete_this_post',
            'Are you sure you want to delete this post?'
          ),
          t('yes_delete_it', 'Yes, delete it!')
        ))
      ) {
        return;
      }

      if (internal) {
        deleteInternalValue(current, index);
        return setLoaded(false);
      }

      deleteGlobalValue(index);
      setLoaded(false);
    },
    [current, global, internal, t]
  );

  if (!loaded || !loadedState) {
    return null;
  }

  return (
    <div
      className={clsx(
        'relative flex-col gap-[20px] flex-1',
        (items.length === 1 || !canEdit || !comments) && 'flex',
        ((!canEdit && !isCreateSet) || !comments) &&
          'bg-newSettings rounded-[12px]'
      )}
    >
      {isCreateSet && current !== 'global' && (
        <>
          <div className="text-center absolute w-full h-full left-0 top-0 items-center justify-center flex z-[101] flex-col gap-[16px]">
            <div>
              <div className="w-[54px] h-[54px] rounded-full absolute z-[101] flex justify-center items-center">
                <LockIcon />
              </div>
              <div className="w-[54px] h-[54px] rounded-full bg-newSettings opacity-80" />
            </div>
            <div className="text-[14px] font-[600] text-white">
              {t(
                'cant_edit_networks_when_creating_set',
                "You can't edit networks when creating a set"
              )}
            </div>
          </div>
          <div className="absolute w-full h-full left-0 top-0 bg-newBackdrop opacity-60 z-[100] rounded-[12px]" />
        </>
      )}
      {!canEdit && !isCreateSet && (
        <>
          <div
            onClick={() => {
              setLoaded(false);
              addRemoveInternal(current);
            }}
            className="text-center absolute w-full h-full p-[20px] left-0 top-0 items-center justify-center flex z-[101] flex-col gap-[16px]"
          >
            <div>
              <div className="w-[54px] h-[54px] rounded-full absolute z-[101] flex justify-center items-center">
                <LockIcon />
              </div>
              <div className="w-[54px] h-[54px] rounded-full bg-newSettings opacity-80" />
            </div>
            <div className="text-[14px] font-[600] text-white">
              {t(
                'click_to_exit_global_editing',
                'Click this button to exit global editing and customize the post for this channel'
              )}
            </div>
            <div>
              <div className="text-white rounded-[8px] h-[44px] px-[20px] bg-[#D82D7E] cursor-pointer flex justify-center items-center">
                {t('edit_content', 'Edit content')}
              </div>
            </div>
          </div>
          <div className="absolute w-full h-full left-0 top-0 bg-newBackdrop opacity-60 z-[100] rounded-[12px]" />
        </>
      )}
      {items.map((g, index) => (
        <div
          key={g.id}
          className={clsx(
            'relative flex flex-col gap-[20px] flex-1 bg-newSettings',
            index === 0 && 'rounded-t-[12px]',
            (index === items.length - 1 || !comments) && 'rounded-b-[12px]',
            !canEdit && !isCreateSet && 'blur-s',
            ((!canEdit && index > 0) || (!comments && index > 0)) && 'hidden'
          )}
        >
          <div className="flex gap-[5px] flex-1 w-full">
            <div className="flex-1 flex w-full">
              {index > 0 && (
                <div className="flex justify-center pl-[12px] text-newSep">
                  <ConnectionLineIcon />
                </div>
              )}
              <Editor
                comments={comments}
                editorType={editor}
                identifier={current}
                contentOwnerId={current}
                postId={g.id}
                capabilities={capabilities}
                allValues={items}
                onChange={changeValue(index)}
                key={index}
                num={index}
                totalPosts={global.length}
                value={g.content}
                pictures={g.media}
                setImages={changeImages(index)}
                autoComplete={canEdit}
                validateChars={true}
                totalChars={capabilities.text.max}
                appendImages={appendImages(index)}
                dummy={dummy}
                selectedIntegration={
                  current === 'global' ? globalTargets : selectedIntegration
                }
                onCustomize={
                  current === 'global' ? customizePlatform : undefined
                }
                chars={chars}
                childButton={
                  <>
                    {(canEdit && items.length - 1 === index) || !comments ? (
                      <div className="flex items-center">
                        <div className="flex-1">
                          {comments && (
                            <AddPostButton
                              num={index}
                              onClick={addValue(index)}
                              postComment={postComment}
                            />
                          )}
                        </div>
                        {!!internal && !existingData?.integration && (
                          <div
                            className="mt-[12px] flex gap-[20px] items-center cursor-pointer select-none"
                            onClick={goBackToGlobal}
                          >
                            <div className="flex gap-[6px] items-center">
                              <div className="w-[8px] h-[8px] rounded-full bg-[#FC69FF]" />
                              <div className="text-[14px] font-[600]">
                                {t(
                                  'editing_a_specific_network',
                                  'Editing a Specific Network'
                                )}
                              </div>
                            </div>
                            <div className="flex gap-[6px] items-center">
                              <div>
                                <ResetIcon />
                              </div>
                              <div className="text-[13px] font-[600]">
                                {t('back_to_global', 'Back to global')}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </>
                }
              />
            </div>
            {comments && (
              <div className="flex flex-col items-center gap-[10px] pe-[12px]">
                <UpDownArrow
                  isUp={index !== 0}
                  isDown={index !== items.length - 1}
                  onChange={changeOrder(index)}
                />
                {items.length > 1 && (
                  <TrashIcon
                    onClick={deletePost(index)}
                    data-tooltip-id="tooltip"
                    data-tooltip-content={t(
                      'delete_post_tooltip',
                      'Delete Post'
                    )}
                    className="cursor-pointer text-[#FF3F3F]"
                  />
                )}
                {index > 0 && (
                  <DelayComponent currentIndex={index} currentDelay={g.delay} />
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export const Editor: FC<{
  editorType?: 'none' | 'normal' | 'markdown' | 'html';
  identifier?: string;
  contentOwnerId?: string;
  postId?: string;
  capabilities?: PlatformCapabilities;
  totalPosts: number;
  value: string;
  num?: number;
  pictures?: any[];
  allValues?: any[];
  onChange: (value: string) => void;
  setImages?: (value: any[]) => void;
  appendImages?: (value: any[]) => void;
  autoComplete?: boolean;
  validateChars?: boolean;
  comments: boolean | 'no-media';
  totalChars?: number;
  selectedIntegration: SelectedIntegrations[];
  dummy: boolean;
  chars: Record<string, number>;
  onCustomize?: (targetIntegrationId: string) => void;
  childButton?: React.ReactNode;
}> = (props) => {
  const {
    editorType = 'normal',
    allValues,
    pictures,
    setImages,
    num,
    appendImages,
    dummy,
    chars,
    childButton,
    comments,
  } = props;
  const capabilities = useMemo(
    () =>
      props.capabilities ||
      resolveEditorCapabilities('global', props.selectedIntegration, [], chars),
    [props.capabilities, props.selectedIntegration, chars]
  );
  const formattingControls = useMemo(
    () => getFormattingControls(capabilities),
    [capabilities]
  );
  const editorCreationPolicyKey = useMemo(
    () => getEditorCreationPolicyKey(capabilities),
    [capabilities]
  );
  const analysis = useMemo(
    () =>
      props.identifier === 'global'
        ? props.selectedIntegration.length
          ? analyzeSelectedPlatformContent({
              content: props.value || '',
              media: props.pictures || [],
              capabilities: props.selectedIntegration.map((item) =>
                resolveIntegrationCapabilities(
                  item.integration,
                  chars[item.integration.id]
                )
              ),
              targetIntegrationIds: props.selectedIntegration.map(
                (item) => item.integration.id
              ),
            })
          : analyzeSourceOnlyContent({
              content: props.value || '',
              media: props.pictures || [],
              capabilities,
            })
        : analyzePlatformContent({
            content: props.value || '',
            media: props.pictures || [],
            capabilities,
          }),
    [
      props.identifier,
      props.value,
      props.pictures,
      props.selectedIntegration,
      capabilities,
      chars,
    ]
  );
  const [id] = useState(makeId(10));
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const t = useT();
  const toaster = useToaster();
  const editorRef = useRef<undefined | { editor: any }>(undefined);
  const [activeEditor, setActiveEditor] = useState<any>();
  const [loading, setLoading] = useState(false);

  const uppy = useUppyUploader({
    onUploadSuccess: (result: any) => {
      appendImages(result);
      uppy.clear();
    },
    allowedFileTypes: 'image/*,video/mp4',
    onStart: () => {},
    onEnd: () => setLoading(false),
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const totalSize = acceptedFiles.reduce((acc, file) => acc + file.size, 0);

      if (totalSize > MAX_UPLOAD_SIZE) {
        toaster.show(
          t(
            'upload_size_limit_exceeded',
            'Upload size limit exceeded. Maximum 1 GB per upload session.'
          ),
          'warning'
        );
        return;
      }

      setLoading(true);

      for (const file of acceptedFiles) {
        uppy.addFile(file);
      }
    },
    [uppy, toaster, t]
  );

  const paste = useCallback(
    async (event: ClipboardEvent | File[]) => {
      if (num > 0 && comments === 'no-media') {
        return;
      }
      // @ts-ignore
      const clipboardItems = event.clipboardData?.items;
      if (!clipboardItems) {
        return;
      }

      const files: File[] = [];
      // @ts-ignore
      for (const item of clipboardItems) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      const totalSize = files.reduce((acc, file) => acc + file.size, 0);

      if (totalSize > MAX_UPLOAD_SIZE) {
        toaster.show(
          t(
            'upload_size_limit_exceeded',
            'Upload size limit exceeded. Maximum 1 GB per upload session.'
          ),
          'warning'
        );
        return;
      }

      if (files.length > 0) {
        setLoading(true);
      }

      for (const file of files) {
        uppy.addFile(file);
      }
    },
    [uppy, num, comments, toaster, t]
  );

  const { getRootProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      if (loading) {
        toaster.show(
          'Upload current in progress, please wait and then try again.',
          'warning'
        );
        return;
      }
      onDrop(files);
    },
    noDrag: num > 0 && comments === 'no-media',
  });

  const valueWithoutHtml = useMemo(() => {
    return stripHtmlValidation('normal', props.value || '', true);
  }, [props.value]);

  const addText = useCallback(
    (emoji: string) => {
      activeEditor?.commands?.insertContent(emoji);
      activeEditor?.commands?.focus();
    },
    [activeEditor]
  );

  const [loadedEditor, setLoadedEditor] = useState(editorType);
  const [showEditor, setShowEditor] = useState(true);
  useEffect(() => {
    if (editorType === loadedEditor) {
      return;
    }
    setLoadedEditor(editorType);
    setShowEditor(false);
  }, [editorType]);

  useEffect(() => {
    if (showEditor) {
      return;
    }
    setTimeout(() => {
      setShowEditor(true);
    }, 20);
  }, [showEditor]);

  if (!showEditor) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[20px] flex-1">
      <div
        className={clsx(
          'relative flex-1 px-[12px] pt-[12px] pb-[12px] flex flex-col',
          num > 0 && '!rounded-bs-[0]'
        )}
        id={id}
      >
        <div className="relative cursor-text flex flex-1 flex-col">
          <div {...getRootProps()} className="flex flex-1 flex-col">
            <div
              className={clsx(
                'absolute left-0 top-0 w-full h-full bg-black/70 z-[300] transition-all items-center justify-center flex text-white text-sm',
                !isDragActive ? 'pointer-events-none opacity-0' : 'opacity-100'
              )}
            >
              {t('drop_files_here_to_upload', 'Drop your files here to upload')}
            </div>
            <div className="px-[10px] pt-[10px] bg-newBgColorInner rounded-t-[6px] relative z-[99]">
              <OnlyEditor
                key={JSON.stringify([
                  props.contentOwnerId ?? props.identifier ?? 'standalone',
                  props.postId ?? id,
                  editorCreationPolicyKey,
                ])}
                value={props.value}
                capabilities={capabilities}
                onChange={props.onChange}
                onEditorChange={setActiveEditor}
                paste={paste}
                ref={editorRef}
              />
            </div>
            <div
              className="bg-newBgColorInner flex-1"
              onClick={() => {
                if (editorRef?.current?.editor?.isFocused) {
                  return;
                }
                editorRef?.current?.editor?.commands?.focus('end');
              }}
            />
            <div className="w-full pointer-events-none">
              <div className="w-full h-[46px] overflow-hidden absolute left-0 bg-newBgColorInner uppyChange">
                <Dashboard
                  height={46}
                  uppy={uppy}
                  id={`prog-${num}`}
                  showProgressDetails={true}
                  hideUploadButton={true}
                  hideRetryButton={true}
                  hidePauseResumeButton={true}
                  hideCancelButton={true}
                  hideProgressAfterFinish={true}
                />
              </div>
            </div>
            <div
              className="w-full h-[46px] bg-newBgColorInner cursor-text"
              onClick={() => {
                if (editorRef?.current?.editor?.isFocused) {
                  return;
                }
                editorRef?.current?.editor?.commands?.focus('end');
              }}
            />
            <div className="flex bg-newBgColorInner rounded-b-[6px] cursor-default">
              {setImages && (
                <MultiMediaComponent
                  mediaNotAvailable={num > 0 && comments === 'no-media'}
                  allData={allValues}
                  text={valueWithoutHtml}
                  label={t('attachments', 'Attachments')}
                  description=""
                  value={props.pictures}
                  dummy={dummy}
                  name="image"
                  information={
                    <InformationComponent
                      analysis={analysis}
                      isPicture={pictures?.length > 0}
                      chars={chars}
                      totalChars={analysis.visibleLength}
                      totalAllowedChars={capabilities.text.max}
                    />
                  }
                  toolBar={
                    <div className="flex gap-[5px]">
                      <SignatureBox editor={activeEditor} />
                      {formattingControls.includes('underline') && (
                        <UText
                          editor={activeEditor}
                          currentValue={props.value!}
                        />
                      )}
                      {formattingControls.includes('bold') && (
                        <BoldText
                          editor={activeEditor}
                          currentValue={props.value!}
                        />
                      )}
                      {formattingControls.includes('link') && (
                        <AComponent
                          editor={activeEditor}
                          currentValue={props.value!}
                        />
                      )}
                      {formattingControls.includes('list') && (
                        <Bullets
                          editor={activeEditor}
                          currentValue={props.value!}
                        />
                      )}
                      {formattingControls.includes('heading') && (
                        <HeadingComponent
                          editor={activeEditor}
                          currentValue={props.value!}
                        />
                      )}
                      <div
                        data-tooltip-id="tooltip"
                        data-tooltip-content={t('insert_emoji', 'Insert Emoji')}
                        className="select-none cursor-pointer rounded-[6px] w-[30px] h-[30px] bg-newColColor flex justify-center items-center"
                        onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                      >
                        <EmojiIcon />
                      </div>
                      <div className="relative">
                        <div
                          className={clsx(
                            'absolute z-[500] -start-[50px]',
                            num === 0 && allValues?.length > 1
                              ? 'top-[35px]'
                              : 'bottom-[35px]'
                          )}
                        >
                          <EmojiPicker
                            height={400}
                            theme={
                              (localStorage.getItem('mode') as Theme) ||
                              Theme.DARK
                            }
                            onEmojiClick={(e) => {
                              addText(e.emoji);
                              setEmojiPickerOpen(false);
                            }}
                            open={emojiPickerOpen}
                          />
                        </div>
                      </div>
                    </div>
                  }
                  onChange={(value) => {
                    setImages(value.target.value);
                  }}
                  onOpen={() => {}}
                  onClose={() => {}}
                />
              )}
            </div>
            <div>{childButton}</div>
          </div>
        </div>
      </div>
      {!!analysis.messages.length && (
        <PlatformContentNotice
          messages={analysis.messages}
          onCustomize={props.onCustomize}
        />
      )}
    </div>
  );
};

export const OnlyEditor = forwardRef<
  any,
  {
    capabilities: PlatformCapabilities;
    value: string;
    onChange: (value: string) => void;
    onEditorChange?: (editor: any) => void;
    paste?: (event: ClipboardEvent | File[]) => void;
  }
>(({ capabilities, value, onChange, onEditorChange, paste }, ref) => {
  const t = useT();
  const fetch = useFetch();
  const canonicalEditorExtensions = useMemo(
    () => createCanonicalEditorExtensions(capabilities),
    [capabilities]
  );

  const { internal } = useLaunchStore(
    useShallow((state) => ({
      internal: state.internal.find((p) => p.integration.id === state.current),
    }))
  );

  const loadList = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        return [];
      }

      if (!internal?.integration.id) {
        return [];
      }

      try {
        const load = await fetch('/integrations/mentions', {
          method: 'POST',
          body: JSON.stringify({
            name: 'mention',
            id: internal.integration.id,
            data: { query },
          }),
        });

        const result = await load.json();
        return result;
      } catch (error) {
        console.error('Error loading mentions:', error);
        return [];
      }
    },
    [internal, fetch]
  );

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      PlainTextPasteExtension,
      ...canonicalEditorExtensions,
      Placeholder.configure({
        placeholder: t('write_something', 'Write something …'),
        emptyEditorClass: 'is-editor-empty',
      }),
      ...(internal?.integration?.id
        ? [
            Mention.configure({
              HTMLAttributes: {
                class: 'mention',
              },
              renderHTML({ options, node }) {
                return [
                  'span',
                  mergeAttributes(options.HTMLAttributes, {
                    'data-mention-id': node.attrs.id || '',
                    'data-mention-label': node.attrs.label || '',
                  }),
                  `@${node.attrs.label}`,
                ];
              },
              suggestion: suggestion(loadList),
            }),
          ]
        : []),
      History.configure({
        depth: 100, // default is 100
        newGroupDelay: 100, // default is 500ms
      }),
    ],
    content: value || '',
    shouldRerenderOnTransaction: true,
    immediatelyRender: false,
    // @ts-ignore
    onPaste: paste,
    onUpdate: (innerProps) => {
      onChange?.(innerProps.editor.getHTML());
    },
  });

  useImperativeHandle(ref, () => ({
    editor,
  }));

  useLayoutEffect(() => {
    onEditorChange?.(editor);
    return () => onEditorChange?.(undefined);
  }, [editor, onEditorChange]);

  return <EditorContent editor={editor} />;
});
