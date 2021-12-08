# Changelog

All notable changes to this project will be documented in this file.

## unreleased

* Changed
  * Renamed `bin/cyclonedx-bom` to `bin/make-bom.js` (via [#216])  
    This is considered a none-breaking change,
    as the CLI use of `npx cyclonedx-node`/`npx cyclonedx-bom`
    is untouched.

[#216]: https://github.com/CycloneDX/cyclonedx-node-module/pull/216

## 3.2.0

* Added
  * CLI endpoint `cyclonedx-node` is now available. ([#193] via [#197])  
    Already existing `cyclonedx-bom` stayed as is.
* Fixed
  * CLI no fails longer silently in case of errors. ([#168] via [#210])  
    Instead the exit code is non-zero and a proper error message is displayed.

[#193]: https://github.com/CycloneDX/cyclonedx-node-module/issues/193
[#197]: https://github.com/CycloneDX/cyclonedx-node-module/pull/197
[#168]: https://github.com/CycloneDX/cyclonedx-node-module/issues/168
[#210]: https://github.com/CycloneDX/cyclonedx-node-module/pull/210

## 3.1.3
## 3.1.3
## 3.1.1
## 3.1.0
## 3.0.7
## 3.0.6
## 3.0.5
## 3.0.4
## 3.0.3
## 3.0.2
## 3.0.1
## 3.0.0