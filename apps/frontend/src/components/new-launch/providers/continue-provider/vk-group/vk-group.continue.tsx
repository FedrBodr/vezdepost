'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  ContinueProviderProps,
  withContinueProvider,
} from '../with-continue-provider';

interface VkGroupItem {
  id: string;
  page: string;
  username: string;
  name: string;
  picture: string;
}

const VkGroupSelector = withContinueProvider<VkGroupItem, string>({
  endpoint: 'pages',
  swrKey: 'load-vk-group-communities',
  titleKey: 'vk_group_select_community',
  titleDefault: 'Select a VK community:',
  emptyStateMessages: [
    {
      key: 'vk_group_no_managed_communities',
      text: 'No managed VK communities were found.',
    },
    {
      key: 'vk_group_admin_required',
      text: 'Sign in with a VK account that is an administrator of at least one community.',
    },
    {
      key: 'vk_group_legacy_reconnect',
      text: 'Already connected VK Group with a community key? Delete that integration and reconnect through VK authorization.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => item.id,
  transformSaveData: (selection) => ({ page: selection }),
  isSelected: (item, selection) => selection === item.id,
  renderItem: (item) => (
    <>
      <div className="flex justify-center">
        <img
          className="w-[80px] h-[80px] object-cover rounded-full"
          src={item.picture}
          alt={item.name}
        />
      </div>
      <div className="text-sm font-medium">{item.name}</div>
      {item.username ? (
        <div className="text-xs text-gray-500">
          @{item.username.replace(/^@/, '')}
        </div>
      ) : null}
    </>
  ),
});

export const VkGroupOAuthGuide: FC = () => {
  const t = useT();

  return (
    <details className="rounded-[8px] border border-newTableBorder bg-newBgLineColor px-[16px] py-[12px] text-[14px]">
      <summary className="cursor-pointer font-medium">
        {t('vk_group_oauth_guide_title', 'How VK Group authorization works')}
      </summary>
      <ul className="mt-[12px] list-disc space-y-[8px] ps-[20px] text-textItemBlur">
        <li>
          {t(
            'vk_group_oauth_minimal_permissions',
            'Authorize with VK. Postiz requests basic account information plus only the communities, wall, and photos permissions needed for this integration.'
          )}
        </li>
        <li>
          {t(
            'vk_group_oauth_admin_selection',
            'Choose one community where this VK account is an administrator.'
          )}
        </li>
        <li>
          {t(
            'vk_group_community_authorship',
            'Posts are published on behalf of the selected community.'
          )}
        </li>
        <li>
          {t(
            'vk_group_photo_limit',
            'VK Group supports up to 10 photographs per post.'
          )}
        </li>
        <li>
          {t(
            'vk_group_video_unsupported',
            'VK Group does not support video posts.'
          )}
        </li>
      </ul>
    </details>
  );
};

export const VkGroupContinue: FC<ContinueProviderProps> = (props) => (
  <div className="flex flex-col gap-[20px]">
    <VkGroupOAuthGuide />
    <VkGroupSelector {...props} />
  </div>
);
