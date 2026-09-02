#!/bin/sh
# A stand-in gradle command for the D-version-gradle-javaskew matrix cell. It
# fails the way a JVM does when it is handed classes compiled for a newer
# release: the launcher's UnsupportedClassVersionError names both the class
# file version it was asked to load and the version it recognises, which the
# introspection parses into a tool mismatch (needs Java 17, found Java 8).
echo "Picked up JAVA_TOOL_OPTIONS: -Dfile.encoding=UTF-8" >&2
echo "Error: A JNI error has occurred, please check your installation and try again" >&2
echo 'Exception in thread "main" java.lang.UnsupportedClassVersionError: org/gradle/launcher/daemon/client/DaemonClient has been compiled by a more recent version of the Java Runtime (class file version 61.0), this version of the Java Runtime only recognizes class file versions up to 52.0' >&2
exit 1
