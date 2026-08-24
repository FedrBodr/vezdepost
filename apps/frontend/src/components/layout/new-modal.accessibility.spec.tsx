// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalManager, useModals } from './new-modal';

afterEach(cleanup);

const Harness = () => {
  const modal = useModals();
  return (
    <button
      type="button"
      onClick={() =>
        modal.openModal({
          id: 'language-dialog',
          title: 'Change Language',
          closeButtonAriaLabel: 'Close',
          children: (
            <>
              <button type="button">First language</button>
              <button type="button">Last language</button>
              <OpenStackedDialog />
            </>
          ),
        })
      }
    >
      Open language dialog
    </button>
  );
};

const OpenStackedDialog = () => {
  const modal = useModals();
  return (
    <button
      type="button"
      onClick={() =>
        modal.openModal({
          id: 'stacked-dialog',
          title: 'Second Dialog',
          closeButtonAriaLabel: 'Close second',
          children: (
            <>
              <button type="button">Second first</button>
              <button type="button">Second last</button>
              <CloseAllDialogs />
            </>
          ),
        })
      }
    >
      Open second dialog
    </button>
  );
};

const CloseAllDialogs = () => {
  const modal = useModals();
  return (
    <button type="button" onClick={modal.closeAll}>
      Close all dialogs
    </button>
  );
};

const RemoveLayoutHarness = () => {
  const modal = useModals();
  return (
    <button
      type="button"
      onClick={() =>
        modal.openModal({
          id: 'remove-layout-dialog',
          ariaLabel: 'Fullscreen onboarding',
          removeLayout: true,
          fullScreen: true,
          children: (
            <>
              <button type="button">First fullscreen control</button>
              <button type="button">Last fullscreen control</button>
              <OpenStackedDialog />
              <CloseAllDialogs />
            </>
          ),
        })
      }
    >
      Open fullscreen dialog
    </button>
  );
};

describe('new modal accessibility', () => {
  it('names and focuses a dialog, then restores trigger focus on close', async () => {
    render(
      <ModalManager>
        <Harness />
      </ModalManager>
    );
    const trigger = screen.getByRole('button', {
      name: 'Open language dialog',
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);

    const focusableButtons = within(dialog).getAllByRole('button');
    const firstFocusable = focusableButtons[0];
    const lastFocusable = focusableButtons[focusableButtons.length - 1];

    lastFocusable.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(firstFocusable);

    firstFocusable.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(
      false
    );
    expect(document.activeElement).toBe(lastFocusable);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('contains focus only in the last-open dialog', async () => {
    render(
      <ModalManager>
        <Harness />
      </ModalManager>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open language dialog' })
    );
    const firstDialog = await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    fireEvent.click(
      within(firstDialog).getByRole('button', {
        name: 'Open second dialog',
      })
    );
    const secondDialog = await screen.findByRole('dialog', {
      name: 'Second Dialog',
    });

    const backgroundButtons = within(firstDialog).getAllByRole('button');
    backgroundButtons[backgroundButtons.length - 1].focus();
    expect(fireEvent.keyDown(firstDialog, { key: 'Tab' })).toBe(true);

    fireEvent.click(
      within(secondDialog).getByRole('button', { name: 'Close all dialogs' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('restores the external trigger when stacked dialogs close together', async () => {
    render(
      <ModalManager>
        <Harness />
      </ModalManager>
    );
    const trigger = screen.getByRole('button', {
      name: 'Open language dialog',
    });
    trigger.focus();
    fireEvent.click(trigger);

    const firstDialog = await screen.findByRole('dialog', {
      name: 'Change Language',
    });
    fireEvent.click(
      within(firstDialog).getByRole('button', {
        name: 'Open second dialog',
      })
    );
    const secondDialog = await screen.findByRole('dialog', {
      name: 'Second Dialog',
    });

    fireEvent.click(
      within(secondDialog).getByRole('button', { name: 'Close all dialogs' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('gives remove-layout dialogs equivalent semantics and focus containment', async () => {
    render(
      <ModalManager>
        <RemoveLayoutHarness />
      </ModalManager>
    );
    const trigger = screen.getByRole('button', {
      name: 'Open fullscreen dialog',
    });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', {
      name: 'Fullscreen onboarding',
    });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);

    const firstFocusable = within(dialog).getByRole('button', {
      name: 'First fullscreen control',
    });
    const focusableButtons = within(dialog).getAllByRole('button');
    const lastFocusable = focusableButtons[focusableButtons.length - 1];

    lastFocusable.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(firstFocusable);

    firstFocusable.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(
      false
    );
    expect(document.activeElement).toBe(lastFocusable);

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Open second dialog' })
    );
    const secondDialog = await screen.findByRole('dialog', {
      name: 'Second Dialog',
    });
    lastFocusable.focus();
    expect(fireEvent.keyDown(dialog, { key: 'Tab' })).toBe(true);

    fireEvent.click(
      within(secondDialog).getByRole('button', { name: 'Close all dialogs' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
