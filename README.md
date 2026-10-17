# Media Cleaner

A private, browser-based image and video metadata cleaner. Select a file, see its preview, press **Clean metadata**, compare the result, then **Save cleaned file** or **Delete output**.

**Intended GitHub Pages URL:** https://Kksrlr03.github.io/media-cleaner/

## What it does

- Drag-and-drop or browse for an image/video, with an immediate original preview when the browser supports the format.
- Removes supported descriptive metadata: camera/GPS/EXIF fields, software information, comments, generation prompts, XMP, embedded file-level provenance, timestamps and trailing image payloads.
- Preserves the image's encoded picture data for PNG, JPEG, WebP and GIF, including animation.
- Copies original video and audio streams without re-encoding, checking their SHA-256 stream fingerprints before and after.
- Retains the technical color, orientation, alpha, HDR, animation and codec information required for correct playback.
- Provides Original/Cleaned views, an editable download name, native Save As where supported, normal downloads elsewhere, and an optional verification report.
- Delete revokes previews, releases in-tab media, deletes the video engine's temporary virtual files and terminates its worker. It cannot delete the original or previously downloaded copies from your device.
- No media uploads, accounts, database, analytics or external processing service. Media is held in browser memory only.

## Formats and quality

| Input | Output | Quality handling |
|---|---|---|
| PNG, including 16-bit and APNG | PNG | Original encoded picture/animation chunks retained and hashed |
| JPEG, including progressive | JPEG | Original encoded picture data retained and hashed |
| WebP, including animation | WebP | Original encoded picture/animation chunks retained and hashed |
| GIF, including animation | GIF | Original image data, frame timing and loop behavior retained |
| Ordinary BMP / single-page TIFF | PNG | Lossless export, decoded pixel hashes compared at original precision |
| MP4, MOV, M4V, WebM, MKV, AVI | Same container (M4V uses MP4) | Video/audio stream copy; SHA-256 packet fingerprints and playback properties checked |

Limits: images 50 MB, videos 100 MB. BMP/TIFF decoding is limited to 40 megapixels. TIFFs with custom profiles, special orientation, floating point or multiple pages fail safely instead of being silently downgraded. Browsers may not preview every supported container/codec; preview failure does not imply conversion. A video that cannot pass the lossless checks is rejected, never automatically re-encoded. Video subtitles, chapters, attached artwork and non-media data streams are excluded. Necessary structural tags may remain and appear in the report.

Cleaning does **not** remove visible/pixel-level watermarks, promise an AI-detector bypass, change labels already applied to social posts, or remove every item inside compressed codec payloads. This is file metadata cleanup, not an origin-verification or secure-erasure product. Color profiles may contain descriptive text; they are retained to preserve accurate appearance.

## Run locally

Requires Node.js 22.12+ (Node 24 recommended).

```sh
npm ci
npm run build
npm run preview
```

Open the printed localhost URL. For development, run `npm run build` once to copy the video engine, then `npm run dev`. Serve the site over HTTPS or localhost for Web Crypto and worker support. Opening `index.html` with `file://` is not supported.

Video/BMP/TIFF tools download about 31 MB on first use. The single-thread FFmpeg core runs in a Web Worker and does not require special COOP/COEP headers, making it compatible with GitHub Pages. Processing speed and maximum practical file size depend on device memory. No media is put into localStorage, IndexedDB or a service-worker cache.

## Publish using GitHub Pages

1. Push this project to the `main` branch of `Kksrlr03/media-cleaner`.
2. Open **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The **Test and deploy GitHub Pages** workflow installs dependencies, runs unit tests, builds the site and publishes `dist`.
4. Open the deployment URL reported by the workflow. For this repository it should be `https://Kksrlr03.github.io/media-cleaner/`.

The app uses relative asset URLs and self-hosts its video engine. It can also be deployed by uploading the `dist/` folder to any static HTTPS host. Do not deploy the source folder as-is: `npm run build` generates the compiled app and copies the video engine.

## Checks

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

On Windows the browser suite uses installed Microsoft Edge; on Linux it uses Playwright Chromium. Browser checks exercise original preview, unchanged rendered image pixels, before/after switching, real video stream cleanup, BMP/TIFF pixel verification, named downloads, canceled Save As, deletion, responsive layout and absence of media uploads. Fixtures are synthetic and contain no user photos.

## Implementation

- `src/image-cleaner.mjs`: audited image-container parsing, removal, checksums and encoded-data verification.
- `src/video-cleaner.js`: lazy FFmpeg WebAssembly, stream-copy remuxing and hash/property verification; safe raster conversion.
- `src/main.js`: local previews, lifecycle, downloads, deletion and interface state.
- `scripts/copy-core.mjs`: bundles the single-thread engine for static hosting.
- `.github/workflows/pages.yml`: tests, build and GitHub Pages deployment.

Third-party software and licensing are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


### Deeper cleaning (optional)

The checkbox adds a fresh, browser-rendered sRGB PNG export for supported still JPEG/PNG/WebP images. Original container/application/profile payloads are replaced. Browser-rendered RGBA hashes must match; the original encoding/color space is not preserved and output can be larger. Animated and 16-bit sources are rejected in this mode. Standard cleaning retains their original containers.

For supported SDR H.264 and HEVC/H.265 videos (8/10/12-bit) up to 60 seconds, deeper cleaning removes SEI supplemental units without re-encoding video/audio. This can remove embedded captions and timing/user-data messages. Every decoded video frame is compared in its original pixel format/bit depth and every audio block is compared, together with codec, color, orientation and duration checks. Unsupported codecs, HDR, long videos or a failed comparison produce no output; use standard cleaning instead. This is deliberately narrower than desktop lossy re-encoding to honor quality preservation.

Neither mode removes pixel-embedded watermarks, visual AI signals, third-party server records or existing social-platform labels. The report distinguishes removed blocks, essential preserved data and unchecked signals. It does not claim universal metadata coverage.

Deep video mode also converts other supported, decodable SDR codecs to H.264/AAC MP4 (CRF 18, 192 kb/s audio). This fallback is lossy and is labeled accordingly. Resolution, duration, stream layout and full output decoding are checked; equality of pixels/audio is not claimed. HDR and rotated conversion inputs are rejected. Normal cleaning never uses this conversion.

For regular MP4/MOV HEVC configuration records, deep cleaning additionally removes optional prefix/suffix SEI arrays from hvcC without relocating sample data, then remuxes and checks the output configuration. Extended-size or unsupported container structures are not rewritten by that parser. Limits and unsupported cases remain explicit rather than claiming every video is supported.
