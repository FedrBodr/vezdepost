import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import Link from 'next/link';
import { CommentsComponents } from '@gitroom/frontend/components/preview/comments.components';
import { PreviewCommentsProvider } from '@gitroom/frontend/components/preview/preview.comments.context';
import { PostContentClient } from '@gitroom/frontend/components/preview/post.content.client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { CopyClient } from '@gitroom/frontend/components/preview/copy.client';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { RenderPreviewDateClient } from '@gitroom/frontend/components/preview/render.preview.date.client';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';

dayjs.extend(utc);
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Vezdepost' : 'Gitroom'} Preview`,
  description: '',
};
export default async function Auth(
  props: {
    params: Promise<{
      id: string;
    }>;
    searchParams?: Promise<{
      share?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    id
  } = params;

  const post = await (await internalFetch(`/public/posts/${id}`)).json();
  const t = await getT();
  if (!post.length) {
    return (
      <div className="text-newTextColor fixed start-0 top-0 w-full h-full flex justify-center items-center text-[20px]">
        {t('post_not_found', 'Post not found')}
      </div>
    );
  }
  return (
    <PreviewCommentsProvider
      previewId={id}
      postIds={post.map((p: any) => p.id)}
      organizationId={post[0].organizationId}
    >
      <div className="mx-auto w-full max-w-[1346px] p-[12px] flex flex-col gap-[8px] text-newTextColor">
        <div className="flex bg-newBgColorInner rounded-[12px] min-h-[80px] px-[20px] py-[12px] items-center gap-[20px] flex-wrap">
          <Link
            href="/"
            className="flex items-center gap-[10px] text-textColor"
          >
            <LogoTextComponent />
          </Link>
          <div className="flex-1" />
          <div className="flex items-center gap-[20px] text-[14px] text-textItemBlur">
            <div>
              {t('publication_date', 'Publication Date:')}{' '}
              <span className="text-newTextColor">
                <RenderPreviewDateClient date={post[0].publishDate} />
              </span>
            </div>
            {!!searchParams?.share && (
              <>
                <div className="w-[1px] h-[20px] bg-blockSeparator" />
                <CopyClient />
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-[8px]">
          <div className="flex-1 flex flex-col gap-[8px]">
            {post.map((p: any, index: number) => (
              <div
                key={String(p.id)}
                className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px]"
              >
                <div className="flex gap-[12px]">
                  <div>
                    <div className="flex shrink-0 rounded-full relative">
                      <div className="w-[50px] h-[50px] z-[20]">
                        <img
                          className="w-full h-full relative z-[20] bg-newBgColor aspect-square rounded-full"
                          alt={post[0].integration.name}
                          src={post[0].integration.picture}
                        />
                      </div>
                      <div className="absolute -end-[5px] -bottom-[5px] w-[24px] h-[24px] z-[20]">
                        <img
                          className="w-full h-full bg-newBgColor aspect-square rounded-full"
                          alt={post[0].integration.providerIdentifier}
                          src={`/icons/platforms/${post[0].integration.providerIdentifier}.png`}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-[8px] min-w-0">
                    <div className="flex items-center gap-[8px]">
                      <h2 className="text-[14px] font-[600]">
                        {post[0].integration.name}
                      </h2>
                      <span className="text-[14px] text-textItemBlur">
                        @{post[0].integration.profile}
                      </span>
                      {index === 0 && (
                        <CreationMethodBadge
                          creationMethod={p.creationMethod}
                          size="md"
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-[16px]">
                      <PostContentClient
                        postId={p.id}
                        content={p.content}
                      />
                      {!!JSON.parse(p?.image || '[]').length && (
                        <div className="flex w-full gap-[10px]">
                          {JSON.parse(p?.image || '[]').map((p: any) => (
                            <div
                              key={p.name}
                              className="flex-1 rounded-[10px] max-h-[500px] overflow-hidden"
                            >
                              <VideoOrImage
                                isContain={true}
                                src={p.path}
                                autoplay={true}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="w-full lg:w-[380px] lg:flex-shrink-0">
            <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px] lg:sticky lg:top-[12px]">
              <CommentsComponents previewId={id} />
            </div>
          </div>
        </div>
      </div>
    </PreviewCommentsProvider>
  );
}
