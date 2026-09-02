#!/bin/sh
# A stand-in maven command for the D-redaction-secret matrix cell. It fails
# the way a build against a credential-protected registry fails: real error
# output that carries the planted, deliberately fake credentials the cell
# asserts never survive into either report.
echo "[ERROR] Failed to execute goal org.apache.maven.plugins:maven-dependency-plugin:3.6.1:tree on project introspect-redaction-secret" >&2
echo "[ERROR] x-registry-token: $PLANT_MATRIX_TOKEN" >&2
echo "[ERROR] mvn deploy --password cdxgen-plant-hunter2" >&2
echo "[ERROR] blocked: https://cdxplant:cdxplantsecret@registry.cdxgen-invalid.test/v1/" >&2
exit 1
