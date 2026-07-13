'use client';

import { withContinueProvider } from '../with-continue-provider';

interface VkGroupItem {
  id: string; // negative group id as string, e.g. "-123"
  username: string;
  name: string;
  picture: string;
}

interface VkGroupSelection {
  id: string;
}

export const VkGroupContinue = withContinueProvider<
  VkGroupItem,
  VkGroupSelection
>({
  endpoint: 'pages',
  swrKey: 'load-vk-groups',
  titleKey: 'select_vk_group',
  titleDefault: 'Select VK Group:',
  emptyStateMessages: [
    {
      key: 'we_couldn_t_find_any_vk_group_you_can_post_to',
      text: "We couldn't find any VK group you can post to.",
    },
    {
      key: 'please_make_sure_you_are_an_admin_or_editor_of_a_group_and_add_a_new_channel_again',
      text: 'Please make sure you are an admin or editor of a group, and add a new channel again.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id }),
  transformSaveData: (selection) => ({ page: selection.id }),
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => (
    <>
      <div>
        <img className="w-full" src={item.picture} alt="group" />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
