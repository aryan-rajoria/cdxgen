Manifest-only JavaScript fixture for the build-introspection fixture matrix:
package.json with no lockfile and no node_modules, so a --no-install-deps scan
produces nothing (tier absent) and ranks js.no-node-modules with an `npm
install` build action. The Group A transition executes that action and
re-scans. Asserted by lib/stages/postgen/introspection/e2e.poku.js and
ci/introspection-tests.sh.
