Minimal single-chart fixture for the build-introspection fixture matrix: a
helm chart has no resolver for cdxgen to drive, so the ecosystem grades
manifest (at-ceiling) whatever the environment looks like. Asserted by
lib/stages/postgen/introspection/e2e.poku.js (Group C1) and
ci/introspection-tests.sh.
