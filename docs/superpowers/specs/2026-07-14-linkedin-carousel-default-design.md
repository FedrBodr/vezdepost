# LinkedIn Carousel Default Design

## Goal

Enable image carousels by default for LinkedIn personal profiles and LinkedIn
Pages without breaking posts that cannot be published as carousels.

## Scope

- Change the shared LinkedIn/LinkedIn Page composer setting
  `post_as_images_carousel` to default to `true` for newly composed posts.
- Preserve an explicit `post_as_images_carousel: false` choice from the UI or
  public API.
- Publish a PDF carousel only when carousel mode is requested and the main post
  contains at least two images and no videos.
- Fall back to a regular LinkedIn post when carousel mode is requested but the
  media is empty, contains one image, or contains a video.
- Keep the existing LinkedIn restriction that a post containing a video may
  have at most one media attachment.

Instagram and Threads are outside the implementation scope because their
providers already infer carousels from multiple media attachments. X,
Facebook, Instagram Standalone, VK, YouTube, TikTok, and Telegram expose no
carousel-specific setting in the reviewed provider documentation.

## Design

### Frontend default

The existing LinkedIn settings component is registered for both `linkedin` and
`linkedin-page`. Its React Hook Form registration will initialize
`post_as_images_carousel` to `true`. The checkbox remains visible so users can
opt out and request the existing multi-image collage behavior.

### Backend eligibility

The LinkedIn provider will derive one `useCarousel` decision for each main
post. It is true only when all of these conditions hold:

1. `post_as_images_carousel` is truthy according to the provider's existing
   boolean coercion.
2. The main post has at least two media attachments.
3. None of those attachments is a video.

Only an eligible post is converted into the PDF document used by LinkedIn
carousels. The same `useCarousel` value is passed to payload construction so a
fallback post is never mislabeled as a document carousel.

Carousel-specific validity errors for missing or incompatible media will be
removed because these cases now fall back safely. Independent media rules,
including rejection of multiple attachments when any attachment is a video,
remain unchanged.

### Compatibility

- Existing drafts and API requests with the setting omitted retain the
  backend's current non-carousel behavior; only the composer default changes.
- Existing drafts and API requests with the setting explicitly set to `false`
  remain regular posts.
- Existing requests with the setting set to `true` produce a carousel only
  when eligible and otherwise publish as regular posts.
- No DTO or database migration is required because the setting already exists
  and remains optional.

## Testing

Add focused regression coverage for the LinkedIn provider:

- two or more images plus a true setting uses PDF carousel conversion;
- one image plus a true setting skips conversion and publishes normally;
- one video plus a true setting skips conversion and publishes normally;
- a false setting with multiple images preserves regular collage publishing;
- multiple attachments containing a video remain invalid;
- carousel-ineligible media no longer produce the former carousel validation
  error.

Verify the shared frontend setting defaults to true and run focused tests,
root-level lint/type checks for touched packages, and the relevant build or
type-check commands supported by the repository.

## Non-goals

- Adding new carousel settings to providers whose public API does not expose
  one.
- Changing Instagram or Threads carousel behavior.
- Removing LinkedIn's explicit opt-out control.
- Changing LinkedIn's PDF generation, upload, or publishing protocol.
