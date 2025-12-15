# Changelog

## [0.0.3] - 2025-12-14

### Added

- Added support for .PLS, .M3U, and .XSPF radio streams in the Radio module.
- Added CHANGELOG.md

## Changed

- Renamed Shoutcast module to Radio module
- Changed Radio commands to start with "radio!" instead of "shout!"

## [0.0.2] - 2025-09-27

### Added

- Refactored app to load "Media modules" so we can support multiple commands.
- Media module for streaming Shoutcast radio: shout!start, shout!stop.

## [0.0.1] - 2025-09-20

### Added

- Initial commit: README.md; Color chart.
- Initial app only announces a stream going on in another channel: !watching.
- Added CI/CD tech to automatically pull the latest version from Github on launch.