
<p align="center">
  <picture>
    <!-- Desktop Dark Mode -->
    <source media="(min-width: 769px) and (prefers-color-scheme: dark)" srcset="_includes/header-wide-dark-inline.svg">
    <!-- Desktop Light Mode -->
    <source media="(min-width: 769px) and (prefers-color-scheme: light)" srcset="_includes/header-wide-light-inline.svg">
    <!-- Mobile Dark Mode -->
    <source media="(max-width: 768px) and (prefers-color-scheme: dark)" srcset="_includes/header-stacked-dark-inline.svg">
    <!-- Mobile Light Mode -->
    <source media="(max-width: 768px) and (prefers-color-scheme: light)" srcset="_includes/header-stacked-light-inline.svg">
    <img src="_includes/header-wide-light-inline.svg" alt="
lovelace-frigate-event-feed" />
  </picture>
</p>

<p align="left">
  Part of the Crooked Sentry universe&nbsp;|&nbsp;
  <a href="https://github.com/josephmienko/
lovelace-frigate-event-feed/actions/workflows/validate.yml"><img src="https://github.com/josephmienko/
lovelace-frigate-event-feed/actions/workflows/validate.yml/badge.svg" alt="Validate" align="absmiddle" /></a>&nbsp;
  <a href="https://app.codecov.io/gh/josephmienko/
lovelace-frigate-event-feed"><img src="https://codecov.io/gh/josephmienko/crooked-sentry-appliances/badge.svg" alt="Codecov test coverage" align="absmiddle" /></a>
</p>


## Overview

`lovelace-frigate-event-feed` is the recommended extraction target for the Frigate event feed card that currently lives in this repo.

This repo ships one HACS dashboard/plugin artifact: `dist/lovelace-frigate-event-feed.js`.

## Runtime Model

This card is a standalone frontend card for browsing Frigate events in Lovelace.

It depends on:

- Home Assistant
- a working Frigate integration or Frigate websocket/API path exposed through Home Assistant

It does not take a direct Frigate host or IP. Backend server moves are handled in the Home Assistant Frigate integration, not in the card config.

It can optionally integrate with `advanced-camera-card` for jump-to-play flows, but that is not required for the main event listing UI.

## Repo Layout

```text
lovelace-frigate-event-feed/
  .github/
    workflows/
      validate.yml
  dist/
    lovelace-frigate-event-feed.js
  examples/
    frigate-event-feed-basic.yaml
  scripts/
    build_plugin.mjs
  screenshots/
  src/
    frigate-event-feed.js
  tests/
    validate-dist.mjs
  .gitignore
  README.md
  hacs.json
  package.json
```

## Included Card

- `custom:frigate-event-feed`

## HACS Install

1. Add the repository to HACS as a `Dashboard`.
2. Install `Frigate Event Feed`.
3. Add the resource if HACS does not do it automatically:

   ```text
   /hacsfiles/lovelace-frigate-event-feed/lovelace-frigate-event-feed.js
   ```

4. Use the card in Lovelace.

## Manual Install

1. Copy `dist/lovelace-frigate-event-feed.js` into your Home Assistant `www/` directory.
2. Add it as a Lovelace module resource:

   ```text
   /local/lovelace-frigate-event-feed.js
   ```

3. Use the card in Lovelace.

## Example

```yaml
type: custom:frigate-event-feed
instance_id: frigate
cameras:
  - front_door
  - driveway
labels:
  - person
  - car
title: Recent Events
limit: 12
media: thumbnail
show_camera: auto
has_clip: true
has_snapshot: true
poll_interval_seconds: 45
play_target_selector: advanced-camera-card
```

## Optional `advanced-camera-card` Integration

If you want clip playback handoff into `advanced-camera-card`, document that separately as optional setup:

- install `advanced-camera-card`
- set `play_target_selector`
- optionally set `play_select_entity`, `play_select_option`, or `play_select_map`

That playback integration should never be described as a hard dependency for basic feed usage.

## Maintainer Workflow

1. Edit `src/frigate-event-feed.js`.
2. Rebuild the install artifact:

   ```bash
   npm run build
   ```

3. Run validation:

   ```bash
   npm run check
   npm test
   ```

4. Commit both the source file and the generated `dist/lovelace-frigate-event-feed.js`.

The CI workflow fails if the built artifact is out of date.

## Packaging Rules

- `dist/` contains only installable runtime artifacts.
- `examples/` contains copy/paste Lovelace snippets only.
- `screenshots/` is for README assets only.
- Public examples should avoid private icon dependencies. Use stock `mdi:` icons unless the icon pack is explicitly part of the public install story.
- If the repo ever adds non-JS runtime assets, keep them under `dist/` with the main card artifact.

## Recommended Public Rename

Recommended public rename for the extracted card:

- `crooked-sentry-m3-detection-feed` -> `frigate-event-feed`

That applies to:

- the custom element tag
- `window.customCards` type name
- examples
- README docs

If you want to preserve the Material 3 styling cue in the public name, `m3-frigate-event-feed` is a reasonable alternative, but I would default to the simpler purpose-first name above.

## Extraction Mapping

Current source file in this monorepo maps to the extracted repo like this:

- `homeassistant/www/community/crooked-sentry-m3-detection-feed/crooked-sentry-m3-detection-feed.js` -> `src/frigate-event-feed.js`

The current implementation already behaves like a standalone frontend card and is a good fit for a separate repo.

## Notes

- This template now carries the current extracted implementation with the public `frigate-event-feed` tag and card type already applied.
- The existing advanced-camera-card interop remains optional and documented as such.
- The card talks to Home Assistant's Frigate websocket/API surface and does not hardcode a Frigate server address.
