# Third-party software

This application includes separately licensed dependencies. Their original licenses and notices apply.

| Component | Version | License | Source |
|---|---|---|---|
| FFmpeg WebAssembly core | 0.12.10 | GPL-2.0-or-later | https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10 |
| FFmpeg JavaScript wrapper | 0.12.15 | MIT | https://github.com/ffmpegwasm/ffmpeg.wasm |
| Lucide icons | 0.468.0 | ISC, including inherited Feather notices | https://github.com/lucide-icons/lucide |
| Vite | Version locked in package-lock.json | MIT | https://github.com/vitejs/vite |
| Playwright (development only) | Version locked in package-lock.json | Apache-2.0 | https://github.com/microsoft/playwright |

FFmpeg core is self-hosted under `ffmpeg/` in the build and runs in a separate worker. Its corresponding source, included-library references, compilation scripts and build configuration are published in the FFmpeg WebAssembly repository above. The project builds the unmodified, version-pinned `@ffmpeg/core` npm artifact. See that repository's `packages/core`, `build` and `Dockerfile` sources and FFmpeg's own licensing information: https://ffmpeg.org/legal.html.

This project includes GPL-2.0-or-later compatible source terms in LICENSE. Distribution of the built application must retain applicable third-party notices and comply with the bundled core's GPL obligations. The build copies dependency licenses to `third-party/`.
