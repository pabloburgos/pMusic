# Contributing to pMusic

Thank you for helping improve **pMusic**. This guide explains how to set up your local environment, follow our coding standards, and submit a clean pull request.

## Prerequisites

- **Node.js** `>= 22.12.0` and **npm** `>= 10.0.0`
- **Windows 10/11** (for Electron desktop builds) and/or **Android SDK Build-Tools + JDK 17+** (for Android APK builds)

## Local Setup

```bash
git clone https://github.com/pabloburgos/pMusic.git
cd pMusic
npm install
```

Copy `.env.example` if you want to connect your own Supabase project for cloud sync and Jam testing.

## Workspace Verification

Every pull request must keep strict TypeScript checks and all unit/integration tests green:

```bash
npm run typecheck
npm run test
npm run build:web
```

## Guidelines

1. **Keep shared logic in `packages/*`:** platform-agnostic audio, recommendation, provider, and sync logic belongs under `packages/core`, `packages/providers`, `packages/recommendations`, `packages/audio-engine`, or `packages/sync`.
2. **Preserve platform compatibility:** test Web/Electron/Android code paths when changing audio playback, storage bridges, or OTA manifests (`minNativeVersion`).
3. **Never commit secrets or binaries:** do not commit `.env`, signing keystores, `.exe` installers, or `.apk` artifacts. Binary builds belong on GitHub Releases.
4. **Add targeted tests:** new features or bug fixes in providers, recommendations, or UI should include focused Vitest tests in the corresponding workspace.
