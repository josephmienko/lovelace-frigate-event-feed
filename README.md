<picture align="center">
  <!-- Desktop Dark Mode -->
  <source media="(min-width: 769px) and (prefers-color-scheme: dark)" srcset="assets/header-wide-dark-inline.svg">
  <!-- Desktop Light Mode -->
  <source media="(min-width: 769px) and (prefers-color-scheme: light)" srcset="assets/header-wide-light-inline.svg">
  <!-- Mobile Dark Mode -->
  <source media="(max-width: 768px) and (prefers-color-scheme: dark)" srcset="assets/header-stacked-dark-inline.svg">
  <!-- Mobile Light Mode -->
  <source media="(max-width: 768px) and (prefers-color-scheme: light)" srcset="assets/header-stacked-light-inline.svg">
  <img src="assets/header-wide-light-inline.svg" alt="lovelace-frigate-event-feed">
</picture>
<b align="left" class="cs-repo-meta">
  <span class="cs-repo-subtitle">Part of the Crooked Sentry universe</span>
  <span class="cs-repo-meta-separator" aria-hidden="true">|</span>
  <span class="cs-repo-badges">
    <a href="https://github.com/josephmienko/lovelace-frigate-event-feed/actions/workflows/validate.yml"><img src="https://github.com/josephmienko/lovelace-frigate-event-feed/actions/workflows/validate.yml/badge.svg" alt="Validate" align="absmiddle" /></a>
    <a href="https://app.codecov.io/gh/josephmienko/lovelace-frigate-event-feed"><img src="https://codecov.io/gh/josephmienko/lovelace-frigate-event-feed/badge.svg" alt="Codecov test coverage" align="absmiddle" /></a>
  </span>
</b>

Standalone Lovelace card for browsing Frigate detection events. Requires Home Assistant with an active Frigate integration or exposed Frigate API.

## Configuration

### Installation Instructions

#### HACS Install

1. Add the repository to HACS as a `Dashboard`.
2. Install `Frigate Event Feed`.
3. Add the resource if HACS does not do it automatically:

   ```text
   /hacsfiles/lovelace-frigate-event-feed/lovelace-frigate-event-feed.js
   ```

4. Use the card in Lovelace.

#### Manual Install

1. Copy `dist/lovelace-frigate-event-feed.js` into your Home Assistant `www/` directory.
2. Add it as a Lovelace module resource:

   ```text
   /local/lovelace-frigate-event-feed.js
   ```

3. Use the card in Lovelace.

### Basic Configuration

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
```

### Optional: advanced-camera-card Integration

If you want clip playback handoff to `advanced-camera-card`:

- Install `advanced-camera-card` separately
- Set `play_target_selector: advanced-camera-card`
- Optionally configure `play_select_entity`, `play_select_option`, or `play_select_map`

This is optional and not required for basic event listing.

### Maintainer Workflow

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

# Design Notes

The card does not accept direct Frigate host/IP parameters. Backend routing is handled by the Home Assistant Frigate integration, keeping the card logic simple and consistent with HA's architecture
