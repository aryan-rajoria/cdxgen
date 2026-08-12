import { assert, describe, it } from "poku";

import {
  isGitHubUrl,
  modulePathHost,
  parseUrl,
  urlHostMatches,
} from "./urls.js";

describe("parseUrl", () => {
  it("parses absolute, scheme-relative and scheme-less inputs", () => {
    assert.equal(parseUrl("https://github.com/o/r").hostname, "github.com");
    assert.equal(parseUrl("//github.com/o/r").hostname, "github.com");
    assert.equal(parseUrl("github.com/o/r").hostname, "github.com");
    assert.equal(parseUrl("  https://github.com/o/r  ").hostname, "github.com");
  });

  it("returns undefined for values that are not urls", () => {
    assert.equal(parseUrl(undefined), undefined);
    assert.equal(parseUrl(""), undefined);
    assert.equal(parseUrl(42), undefined);
  });
});

describe("urlHostMatches", () => {
  it("matches the host and its subdomains", () => {
    assert.ok(
      urlHostMatches("https://opensource.org/licenses/MIT", "opensource.org"),
    );
    assert.ok(
      urlHostMatches(
        "http://www.apache.org/licenses/LICENSE-2.0",
        "apache.org",
      ),
    );
    assert.ok(urlHostMatches("https://APACHE.ORG/licenses/", "apache.org"));
  });

  it("rejects lookalike hosts and path-only mentions", () => {
    assert.ok(
      !urlHostMatches("https://apache.org.example.com/x", "apache.org"),
    );
    assert.ok(!urlHostMatches("https://notapache.org/x", "apache.org"));
    assert.ok(
      !urlHostMatches("https://example.com/mirror/apache.org/x", "apache.org"),
    );
  });
});

describe("isGitHubUrl", () => {
  it("accepts github.com repository urls", () => {
    assert.ok(isGitHubUrl("https://github.com/owner/repo"));
    assert.ok(isGitHubUrl("git+https://github.com/owner/repo.git"));
    assert.ok(isGitHubUrl("https://raw.github.com/owner/repo/main/LICENSE"));
  });

  it("rejects lookalike hosts, path mentions and bare module paths", () => {
    assert.ok(!isGitHubUrl("https://github.com.evil.example/owner/repo"));
    assert.ok(!isGitHubUrl("https://evil.example/?u=https://github.com/o/r"));
    assert.ok(!isGitHubUrl("https://evil.example/github.com/owner/repo"));
    assert.ok(!isGitHubUrl("github.com/owner/repo"));
    assert.ok(!isGitHubUrl(undefined));
  });
});

describe("modulePathHost", () => {
  it("matches only the first path segment", () => {
    assert.ok(modulePathHost("github.com/owner/repo", "github.com"));
    assert.ok(modulePathHost("gitlab.com/owner/repo", "gitlab.com"));
    assert.ok(!modulePathHost("example.com/github.com/owner", "github.com"));
    assert.ok(!modulePathHost("github.com.evil/owner", "github.com"));
    assert.ok(!modulePathHost(undefined, "github.com"));
  });
});
