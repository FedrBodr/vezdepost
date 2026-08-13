# Tumblr Multipart Upload Fix Design

## Goal

Make image and video publication through the existing Vezdepost Tumblr
provider conform to Tumblr's official Neue Post Format multipart contract.
Text-only publication and OAuth behavior must remain unchanged.

## Confirmed Failure

Production accepted Tumblr OAuth and published a text-only post. Two attempts
to publish a valid PNG failed with Tumblr HTTP `400`, subcode `8005`, and the
detail `Sorry, we don't support this media format yet.`

The uploaded asset itself is valid: PNG, 117409 bytes, 912 by 978 pixels, sRGB.
The provider currently appends the JSON payload as a native `Blob`. Node's
native `FormData` serializes that part as:

```text
Content-Disposition: form-data; name="json"; filename="blob"
Content-Type: application/json
```

Tumblr's official contract requires the JSON part to have no filename, followed
by separate file parts keyed by the identifiers referenced in the JSON body.
The extra JSON filename is therefore the only confirmed request-format
difference and the leading root-cause hypothesis for Tumblr treating the JSON
part as unsupported uploaded media.

## Selected Approach

Build the multipart body explicitly rather than using native `FormData`.

The provider will create a unique boundary and concatenate:

1. A `json` part with `Content-Type: application/json` and no `filename`.
2. One binary part per media item whose form field name equals the NPF media
   `identifier` (`media-0`, `media-1`, and so on).
3. A closing boundary.

The request will set `Content-Type: multipart/form-data; boundary=...` itself.
The existing bearer authorization, user agent, API endpoint, payload shape,
media download behavior, and Tumblr error mapping remain unchanged.

## Component Boundaries

### Multipart builder

A small private helper in `tumblr.provider.ts` accepts the JSON payload and an
array of downloaded media parts. It returns the boundary content type and a
`Buffer` request body. It has no network or OAuth responsibilities.

Media filenames are derived from the stored path after removing query strings.
Characters outside letters, digits, `.`, `_`, and `-` are replaced with `_` so
that quotes, newlines, or URL syntax cannot alter multipart headers. A fallback
name based on the media identifier is used when the path has no usable basename.

### Provider upload flow

`createMultipartPost` continues to download each media asset as an array buffer
and determine its MIME type from the path. It passes those bytes to the builder,
then calls the existing guarded provider `fetch` with the returned body and
content type.

## Testing

Add focused Tumblr provider tests that inspect the actual multipart bytes and
headers before implementation:

- the JSON part has `name="json"`, `Content-Type: application/json`, and no
  filename;
- an image part uses the matching `media-0` identifier, a sanitized `.png`
  filename, `Content-Type: image/png`, and unchanged binary bytes;
- the body ends with the correct closing boundary;
- text-only posts still use `application/json` and do not enter the multipart
  builder;
- Tumblr `8005` continues to produce the existing safe user-facing message.

The regression test must fail against the current native `FormData`
implementation before production code changes are made.

## Deployment and Verification

The fix changes runtime TypeScript and therefore requires building a new image.
Deploy only the `postiz` Compose service; it contains the backend, frontend, and
orchestrator processes used by this installation. Do not restart database,
Redis, Temporal, Caddy, or other services.

Before deployment, preserve the server configuration already backed up during
Tumblr setup and verify that the Mastra spans table remains healthy. After the
minimal recreate, verify ports 3000, 4200, and 5000, public API readiness, the
Temporal `main` poller, Tumblr environment-variable presence, and PM2 process
stability.

After the user explicitly confirms the public retry, publish one PNG to the
test Tumblr blog and verify the release URL, image rendering, text, and absence
of duplicates.

## Non-goals

- No changes to Tumblr OAuth, scopes, callback URLs, or credentials.
- No conversion or recompression of valid media.
- No changes to other social providers.
- No automatic retry of the two already failed calendar posts.
- No deletion of failed posts or published Tumblr content.
