Marker-only fixture for the build-introspection fixture matrix: one file per
ecosystem cdxgen cannot parse (elm.json, shard.yml, a .nimble, cpanfile,
DESCRIPTION). Every scan of it must report exactly these five ecosystems as
coverage gaps with no score row and no remediations. Asserted by
lib/stages/postgen/introspection/e2e.poku.js (Group C2) and
ci/introspection-tests.sh.
