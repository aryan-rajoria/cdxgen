@echo off
rem Stand-in maven wrapper for Windows, mirroring the POSIX ./mvnw beside it:
rem the readiness probe succeeds and the build fails the way a build with an
rem unreachable registry does, so the run exercises the wrapper path end to
rem end with real [ERROR] output.
if "%~1"=="--version" (
  echo Apache Maven 3.9.9 ^(introspect-maven-wrapper stand-in^)
  exit /b 0
)
echo [ERROR] Failed to execute goal org.apache.maven.plugins:maven-dependency-plugin:3.6.1:tree on project sbom-fidelity-maven-wrapper: Could not resolve dependencies for project com.example:introspect-maven-wrapper:jar:1.0.0: Could not transfer artifact org.apache:x:y from/to central: The remote repository's server has not been configured 1>&2
exit /b 1
