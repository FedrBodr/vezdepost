'use client';

import { withContinueProvider } from '../with-continue-provider';

interface VkGroupItem {
  id: string;
  page: string;
  username: string;
  name: string;
  picture: string;
}

export const VkGroupContinue = withContinueProvider<VkGroupItem, string>({
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
