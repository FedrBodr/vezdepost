# Telegram: long text with media

## Problem

Telegram accepts up to 4096 characters in a text message but only 1024
characters in a media caption. Vezdepost currently validates every Telegram
post against the 4096-character limit and always sends the text as a caption
when media is attached. A post with one or more media items and 1025–4096
characters therefore passes validation and fails during publication with
`message caption is too long`.

## Desired behavior

- A text-only Telegram post keeps the 4096-character limit and is sent as one
  text message.
- A post with media and no more than 1024 caption characters keeps the current
  behavior: the text is the caption of the single media item or the first item
  in the album.
- A post with media and 1025–4096 characters is accepted. The media (or album)
  is sent first without a caption, then the complete text is sent as a second
  Telegram message.
- Text is never split in the middle and no content is discarded.
- The stored release URL continues to point to the first Telegram message,
  which is the media or album.
- Text over 4096 characters remains invalid.

## User warning

When the Telegram editor contains media and more than 1024 visible characters,
show a non-blocking warning:

> Telegram ограничивает подпись к медиа 1024 символами. Медиа и текст будут
> опубликованы двумя отдельными сообщениями.

The warning disappears when the text is reduced to 1024 characters or fewer,
or all media is removed. It does not prevent saving or publishing.

The server remains authoritative: publication uses the same conditional rule
even if a caller bypasses the web editor.

## Publishing flow

`TelegramProvider.sendMessage` normalizes the HTML text before deciding how to
send it.

1. No media: call `sendMessage` with the complete text.
2. Media and normalized text length <= 1024:
   - one item: call the matching `sendPhoto`, `sendVideo`, or `sendDocument`
     method with the text as its caption;
   - multiple items: call `sendMediaGroup`, placing the caption on the first
     item of the first group.
3. Media and normalized text length > 1024:
   - send the single media item or all media groups without captions;
   - after all media calls succeed, call `sendMessage` with the complete text;
   - return the ID of the first media message so the release URL points to the
     start of the two-message publication.

If media upload fails, the text message is not sent. If the media succeeds but
the subsequent text message fails, the provider reports an error through the
existing Temporal workflow. This partial-publication behavior is unavoidable
without Telegram-side transactions and must remain visible as an error rather
than being reported as success.

## Components

- Telegram backend provider: add a named caption-length constant and the
  conditional two-message publishing flow.
- Telegram editor/provider metadata: expose the 1024-character media-caption
  threshold and warning copy without reducing the overall 4096-character
  maximum.
- Shared editor/preview layer: display the provider warning based on current
  visible character count and media presence. Keep the condition scoped to
  Telegram rather than changing unrelated providers.

## Tests

Backend provider tests cover:

- text-only content up to 4096 uses one text message;
- one media item with text <= 1024 uses one media call with a caption;
- one media item with text > 1024 sends media without caption, then full text;
- multiple media items with text <= 1024 use an album caption;
- multiple media items with text > 1024 send captionless album group(s), then
  full text;
- the returned post ID for split publication is the first media message ID;
- a media failure prevents the text call;
- a text failure after media propagates as an error.

Frontend tests cover warning visibility for the threshold, media presence, and
its disappearance when either condition no longer applies.

## Out of scope

- Splitting text longer than 4096 characters.
- Automatically deleting media after a partial publication failure.
- Changing publication behavior for MAX or other providers.
- Adding retries beyond the existing Temporal/provider behavior.
