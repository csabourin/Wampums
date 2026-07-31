# Wampums Mobile App

The mobile client is an Expo/React Native application that uses the same Wampums API and permission model as the web SPA.

## Requirements

- Node.js 20.18 or newer; the root project uses Node.js 22.12 or newer
- npm
- An Android emulator, iOS simulator, or Expo-compatible device
- A running Wampums API reachable from the device

## Setup

```bash
cd mobile
npm install
```

Set the API base URL with Expo's public environment variable. The value includes `/api`; endpoint helpers add `/v1` where required.

```env
EXPO_PUBLIC_API_URL=http://localhost:5000/api
EXPO_PUBLIC_API_VERSION=v1
EXPO_PUBLIC_ENABLE_DEBUG_LOGGING=true
```

Use `10.0.2.2` instead of `localhost` for an Android emulator. A physical device needs the development machine's LAN address. The server defaults to port `5000`; make the URL match the server's configured `PORT`.

Start the app with one of the scripts defined in `mobile/package.json`:

```bash
npm start
npm run android
npm run ios
npm run web
npm test
```

## Architecture

- `App.js` and `index.js` — application entry points
- `src/navigation/` — authentication, tab, stack, and root navigation
- `src/screens/` — feature screens
- `src/components/` — reusable UI and form components
- `src/api/api-core.js` — authenticated requests, error handling, caching, and offline mutation queuing
- `src/api/api-endpoints.js` — endpoint wrappers
- `src/config/index.js` — environment-driven API, cache, UI, and feature configuration
- `src/i18n/index.js` — English/French translation integration
- `src/theme/` — shared design tokens and styles
- `src/utils/` — security, permissions, storage, formatting, validation, caching, and optimistic updates
- `src/**/__tests__/` — mobile unit tests

## Development rules

- Keep each screen in one language and keep English/French translation keys aligned.
- Build URLs through `src/config/index.js` and the shared API client; do not hardcode hosts in screens.
- Store authentication data through `StorageUtils`; sanitize untrusted display values through `SecurityUtils`.
- Gate UI actions with `PermissionUtils`, while treating server authorization as authoritative.
- Use locale-aware date and number utilities.
- Account for loading, empty, error, and offline states.
- Keep touch targets at least 44 points.

## Offline behavior

`CacheManager` stores cached reads and an offline mutation queue in AsyncStorage. `api-core.js` is the integration point: it determines network state, serves eligible cached data, queues writes, and replays queued mutations after connectivity returns. Tests beside these modules are the source of truth for edge cases; avoid duplicating cache keys or retry rules in documentation.

## API compatibility

Most feature endpoints use `/api/v1`. A small number of public and legacy endpoints remain centralized in `src/config/index.js`; new feature work must use versioned endpoints. The canonical server mounts live in the root project's `routes/index.js`.
