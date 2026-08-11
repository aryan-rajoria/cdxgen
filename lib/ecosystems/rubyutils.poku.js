import { readFileSync } from "node:fs";

import esmock from "esmock";
import { assert, it } from "poku";

import {
  enrichGemsFromLocalCache,
  isRubyPlatform,
  normalizeGemPlatform,
  parseBundleConfig,
  parseCompactIndexInfo,
  parseGemChecksumLine,
  parseGemfileLockData,
  parseGemspecData,
  simplifyRubyVersion,
  splitRubyVersionPlatform,
  toGemModuleNames,
  toGemPurl,
} from "./rubyutils.js";

const COMPACT_INDEX_CACHE = "./test/data/ruby-cache/compact_index";
const CACHED_GEM_HOME = "./test/data/ruby-cache/gemhome";

// Collect the purls of every component with the given name.
const purlsFor = (retMap, name) =>
  retMap.pkgList
    .filter((pkg) => pkg.name === name)
    .map((pkg) => pkg.purl)
    .sort();

it("splitRubyVersionPlatform", () => {
  // Plain versions are returned untouched
  for (const version of [
    "3.25.1",
    "1.0",
    "7.2.0.alpha",
    "2.0.0.pre.beta1",
    "16.10.0.0",
  ]) {
    assert.deepStrictEqual(splitRubyVersionPlatform(version), {
      version,
      platform: undefined,
    });
  }
  // cpu-os platforms
  assert.deepStrictEqual(splitRubyVersionPlatform("3.25.1-x86_64-linux"), {
    version: "3.25.1",
    platform: "x86_64-linux",
  });
  assert.deepStrictEqual(
    splitRubyVersionPlatform("1.19.4-aarch64-linux-musl"),
    {
      version: "1.19.4",
      platform: "aarch64-linux-musl",
    },
  );
  assert.deepStrictEqual(splitRubyVersionPlatform("3.23.4-arm64-darwin"), {
    version: "3.23.4",
    platform: "arm64-darwin",
  });
  assert.deepStrictEqual(splitRubyVersionPlatform("1.16.3-x64-mingw-ucrt"), {
    version: "1.16.3",
    platform: "x64-mingw-ucrt",
  });
  assert.deepStrictEqual(splitRubyVersionPlatform("1.1.0-x86-mingw32"), {
    version: "1.1.0",
    platform: "x86-mingw32",
  });
  // An os version suffix is part of the platform
  assert.deepStrictEqual(
    splitRubyVersionPlatform("16.10.0.0-universal-darwin-20"),
    { version: "16.10.0.0", platform: "universal-darwin-20" },
  );
  assert.deepStrictEqual(splitRubyVersionPlatform("1.8.6-x86-mswin32-60"), {
    version: "1.8.6",
    platform: "x86-mswin32-60",
  });
  // cpu-agnostic platforms
  assert.deepStrictEqual(splitRubyVersionPlatform("1.16.7-java"), {
    version: "1.16.7",
    platform: "java",
  });
  assert.deepStrictEqual(splitRubyVersionPlatform("1.0.0-universal-java-11"), {
    version: "1.0.0",
    platform: "universal-java-11",
  });
  // The cpu is an open token in RubyGems, so unknown platforms are supported
  assert.deepStrictEqual(splitRubyVersionPlatform("25.0.0-wasm32-wasi"), {
    version: "25.0.0",
    platform: "wasm32-wasi",
  });
  assert.deepStrictEqual(splitRubyVersionPlatform("0.7.7-x86_64-cygwin"), {
    version: "0.7.7",
    platform: "x86_64-cygwin",
  });
  // Degenerate input
  assert.deepStrictEqual(splitRubyVersionPlatform(undefined), {
    version: undefined,
    platform: undefined,
  });
  assert.deepStrictEqual(splitRubyVersionPlatform(""), {
    version: "",
    platform: undefined,
  });
  assert.deepStrictEqual(splitRubyVersionPlatform("-x86_64-linux"), {
    version: "-x86_64-linux",
    platform: undefined,
  });
  assert.deepStrictEqual(splitRubyVersionPlatform("1.0.0-"), {
    version: "1.0.0-",
    platform: undefined,
  });
  assert.deepStrictEqual(simplifyRubyVersion("3.25.1-x86_64-linux"), "3.25.1");
  assert.deepStrictEqual(simplifyRubyVersion("3.25.1"), "3.25.1");
});

it("isRubyPlatform", () => {
  for (const platform of [
    "x86_64-linux",
    "x86_64-linux-musl",
    "arm64-darwin",
    "universal-darwin-20",
    "x64-mingw-ucrt",
    "x86-mswin32-60",
    "java",
    "universal-java-11",
    "wasm32-wasi",
    "ruby",
  ]) {
    assert.ok(isRubyPlatform(platform), platform);
  }
  for (const notPlatform of ["", undefined, "beta1", "3.25.1", "CURRENT"]) {
    assert.ok(!isRubyPlatform(notPlatform), `${notPlatform}`);
  }
});

it("normalizeGemPlatform", () => {
  // Gem::Platform maps the jruby engine name onto the java os
  assert.deepStrictEqual(normalizeGemPlatform("jruby"), "java");
  assert.deepStrictEqual(normalizeGemPlatform("java"), "java");
  assert.deepStrictEqual(
    normalizeGemPlatform("universal-java-11"),
    "universal-java-11",
  );
  assert.deepStrictEqual(normalizeGemPlatform("x86_64-linux"), "x86_64-linux");
  assert.deepStrictEqual(normalizeGemPlatform(undefined), undefined);
  // A jruby suffix and a java suffix must not produce two different purls
  assert.deepStrictEqual(
    toGemPurl("jruby-launcher", "1.1.2", "jruby"),
    "pkg:gem/jruby-launcher@1.1.2?platform=java",
  );
  // truffleruby is not a Gem::Platform at all. Gem::Platform.new("truffleruby")
  // is `unknown`, and TruffleRuby reports a conventional platform such as
  // x86_64-linux, so it must never be treated as a platform suffix.
  assert.ok(!isRubyPlatform("truffleruby"));
  assert.deepStrictEqual(normalizeGemPlatform("truffleruby"), "truffleruby");
});

it("parseGemChecksumLine", () => {
  assert.deepStrictEqual(
    parseGemChecksumLine(
      "nokogiri (1.16.0) sha256=341388184e975d091e6e38ce3f3b3388bfb7e4ac3d790efd8e39124844040bd1",
    ),
    {
      lockName: "nokogiri (1.16.0)",
      hashes: [
        {
          alg: "SHA-256",
          content:
            "341388184e975d091e6e38ce3f3b3388bfb7e4ac3d790efd8e39124844040bd1",
        },
      ],
    },
  );
  // The lock name of a native gem carries the platform
  assert.deepStrictEqual(
    parseGemChecksumLine(
      "sqlite3 (2.9.5-arm64-darwin) sha256=d0cf444a70fc9395d513cfbcc1e6719e224aa645314e3824cb0474c721425aa2",
    )?.lockName,
    "sqlite3 (2.9.5-arm64-darwin)",
  );
  // Several algorithms may be recorded, comma joined
  assert.deepStrictEqual(
    parseGemChecksumLine("agem (1.0) sha256=abcdef,sha512=012345")?.hashes,
    [
      { alg: "SHA-256", content: "abcdef" },
      { alg: "SHA-512", content: "012345" },
    ],
  );
  // An entry may carry no checksum at all
  assert.deepStrictEqual(parseGemChecksumLine("agem (1.0)"), undefined);
  assert.deepStrictEqual(parseGemChecksumLine("not a checksum"), undefined);
  assert.deepStrictEqual(parseGemChecksumLine(""), undefined);
  assert.deepStrictEqual(parseGemChecksumLine(undefined), undefined);
  // Only hex digests are accepted
  assert.deepStrictEqual(
    parseGemChecksumLine("agem (1.0) sha256=not-hex!"),
    undefined,
  );
});

it("parseCompactIndexInfo", () => {
  const releases = parseCompactIndexInfo(
    readFileSync(
      `${COMPACT_INDEX_CACHE}/rubygems.org.443.b7f1e/info/nokogiri`,
      {
        encoding: "utf-8",
      },
    ),
  );
  assert.deepStrictEqual(Object.keys(releases).sort(), [
    "1.16.6",
    "1.16.7",
    "1.16.7-java",
    "1.16.7-x86_64-linux",
  ]);
  assert.deepStrictEqual(releases["1.16.7"], {
    checksum:
      "341388184e975d091e6e38ce3f3b3388bfb7e4ac3d790efd8e39124844040bd1",
    ruby: ">= 3.0",
    rubygems: ">= 3.3.22",
    created_at: "2024-07-01T10:00:00Z",
  });
  // Each native build has its own checksum, which is the whole point of
  // tracking the platform separately from the version
  assert.notDeepStrictEqual(
    releases["1.16.7-x86_64-linux"].checksum,
    releases["1.16.7-java"].checksum,
  );
  // Alternative requirements are joined with `&` by the compact index
  assert.deepStrictEqual(
    releases["1.16.7-x86_64-linux"].ruby,
    ">= 3.0&< 3.4.dev",
  );
  // A release with no dependencies still parses
  const ffi = parseCompactIndexInfo(
    readFileSync(`${COMPACT_INDEX_CACHE}/rubygems.org.443.b7f1e/info/ffi`, {
      encoding: "utf-8",
    }),
  );
  assert.deepStrictEqual(Object.keys(ffi), ["1.17.0"]);
  assert.deepStrictEqual(parseCompactIndexInfo(""), {});
  assert.deepStrictEqual(parseCompactIndexInfo(undefined), {});
});

it("parseBundleConfig", () => {
  assert.deepStrictEqual(parseBundleConfig("./test/data/bundle-config"), {
    BUNDLE_PATH: "vendor/bundle",
    BUNDLE_WITHOUT: "development:test",
    BUNDLE_JOBS: "4",
  });
  assert.deepStrictEqual(parseBundleConfig("./test/data/does-not-exist"), {});
  assert.deepStrictEqual(parseBundleConfig(undefined), {});
});

it("enrichGemsFromLocalCache", async () => {
  const pkgList = [
    {
      name: "nokogiri",
      version: "1.16.7",
      purl: "pkg:gem/nokogiri@1.16.7?platform=x86_64-linux",
      properties: [],
    },
    {
      name: "nokogiri",
      version: "1.16.7",
      purl: "pkg:gem/nokogiri@1.16.7?platform=java",
      properties: [],
    },
    {
      name: "nokogiri",
      version: "1.16.7",
      purl: "pkg:gem/nokogiri@1.16.7",
      properties: [],
    },
    {
      name: "ffi",
      version: "1.17.0",
      purl: "pkg:gem/ffi@1.17.0",
      properties: [],
    },
    // Not in either cache
    {
      name: "unknown-gem",
      version: "9.9.9",
      purl: "pkg:gem/unknown-gem@9.9.9",
      properties: [],
    },
  ];
  await enrichGemsFromLocalCache(pkgList, {
    gemHome: CACHED_GEM_HOME,
    compactIndexCacheDir: COMPACT_INDEX_CACHE,
  });
  const [nativeGem, javaGem, rubyGem, ffiGem, unknownGem] = pkgList;
  // Each platform resolves to its own checksum
  assert.deepStrictEqual(
    nativeGem._integrity,
    "sha256-aa1388184e975d091e6e38ce3f3b3388bfb7e4ac3d790efd8e39124844040bd1",
  );
  assert.deepStrictEqual(
    javaGem._integrity,
    "sha256-bb1388184e975d091e6e38ce3f3b3388bfb7e4ac3d790efd8e39124844040bd1",
  );
  assert.deepStrictEqual(
    rubyGem._integrity,
    "sha256-341388184e975d091e6e38ce3f3b3388bfb7e4ac3d790efd8e39124844040bd1",
  );
  // The compact index requirement separator is normalized
  assert.deepStrictEqual(
    nativeGem.properties.find(
      (prop) => prop.name === "cdx:gem:rubyVersionSpecifiers",
    )?.value,
    ">= 3.0, < 3.4.dev",
  );
  assert.deepStrictEqual(
    nativeGem.properties.find(
      (prop) => prop.name === "cdx:gem:rubygemsVersionSpecifiers",
    )?.value,
    ">= 3.3.22",
  );
  // `>= 0` carries no information and is not recorded
  assert.deepStrictEqual(
    ffiGem.properties.find(
      (prop) => prop.name === "cdx:gem:rubygemsVersionSpecifiers",
    ),
    undefined,
  );
  // The installed gemspec of the native build supplies the license
  assert.deepStrictEqual(nativeGem.license, ["MIT"]);
  assert.deepStrictEqual(nativeGem.description?.length > 0, true);
  // There is no installed gemspec for the java build
  assert.deepStrictEqual(javaGem.license, undefined);
  // An unknown gem is left untouched
  assert.deepStrictEqual(unknownGem._integrity, undefined);
  assert.deepStrictEqual(unknownGem.properties, []);
  // Absent caches are not an error
  assert.deepStrictEqual(await enrichGemsFromLocalCache([]), []);
  assert.deepStrictEqual(
    await enrichGemsFromLocalCache([{ name: "a", version: "1" }], {
      gemHome: "./test/data/does-not-exist",
      compactIndexCacheDir: "./test/data/does-not-exist",
    }),
    [{ name: "a", version: "1" }],
  );
});

it("toGemPurl", () => {
  assert.deepStrictEqual(
    toGemPurl("ruby-advisory-db-check", "0.12.4", undefined),
    "pkg:gem/ruby-advisory-db-check@0.12.4",
  );
  // Matches the example in the purl specification for the gem type
  assert.deepStrictEqual(
    toGemPurl("jruby-launcher", "1.1.2", "java"),
    "pkg:gem/jruby-launcher@1.1.2?platform=java",
  );
  assert.deepStrictEqual(
    toGemPurl("google-protobuf", "3.25.1", "x86_64-linux"),
    "pkg:gem/google-protobuf@3.25.1?platform=x86_64-linux",
  );
  // `ruby` is the implied default platform and must not be emitted
  assert.deepStrictEqual(
    toGemPurl("rake", "13.0.6", "ruby"),
    "pkg:gem/rake@13.0.6",
  );
  assert.deepStrictEqual(toGemPurl("wdm", null, null), "pkg:gem/wdm");
});

it("parseGemfileLockData platform qualifiers", async () => {
  const lockFile = "./test/data/Gemfile-platforms.lock";
  const retMap = await parseGemfileLockData(
    readFileSync(lockFile, { encoding: "utf-8" }),
    lockFile,
  );
  assert.deepStrictEqual(retMap.pkgList.length, 27);
  assert.deepStrictEqual(retMap.dependenciesList.length, 27);
  // Every native variant is tracked as a distinct component, distinguished by
  // the platform qualifier rather than by a platform suffix in the version.
  assert.deepStrictEqual(purlsFor(retMap, "ffi"), [
    "pkg:gem/ffi@1.17.0",
    "pkg:gem/ffi@1.17.0?platform=aarch64-linux-gnu",
    "pkg:gem/ffi@1.17.0?platform=arm64-darwin",
    "pkg:gem/ffi@1.17.0?platform=java",
    "pkg:gem/ffi@1.17.0?platform=x64-mingw-ucrt",
    "pkg:gem/ffi@1.17.0?platform=x86_64-linux-gnu",
    "pkg:gem/ffi@1.17.0?platform=x86_64-linux-musl",
  ]);
  for (const pkg of retMap.pkgList.filter((p) => p.name === "ffi")) {
    assert.deepStrictEqual(pkg.version, "1.17.0");
  }
  // The reported issue: the version must not retain the platform suffix
  const protobuf = retMap.pkgList.find(
    (pkg) =>
      pkg.purl === "pkg:gem/google-protobuf@3.25.1?platform=x86_64-linux",
  );
  assert.deepStrictEqual(protobuf.version, "3.25.1");
  assert.deepStrictEqual(
    protobuf["bom-ref"],
    "pkg:gem/google-protobuf@3.25.1?platform=x86_64-linux",
  );
  // A prerelease version is never mistaken for a platform
  assert.deepStrictEqual(purlsFor(retMap, "prerelease-gem"), [
    "pkg:gem/prerelease-gem@2.0.0.pre.beta1",
  ]);
  assert.deepStrictEqual(purlsFor(retMap, "rails"), [
    "pkg:gem/rails@7.2.0.alpha",
  ]);
  // An open ended cpu token and an os version suffix are both preserved
  assert.deepStrictEqual(purlsFor(retMap, "wasmtime"), [
    "pkg:gem/wasmtime@25.0.0?platform=wasm32-wasi",
  ]);
  assert.deepStrictEqual(purlsFor(retMap, "libv8-node"), [
    "pkg:gem/libv8-node@16.10.0.0?platform=universal-darwin-20",
  ]);
  assert.deepStrictEqual(purlsFor(retMap, "json"), [
    "pkg:gem/json@1.8.6?platform=x86-mswin32-60",
  ]);
  // PATH and GIT sourced gems keep their platform too
  assert.deepStrictEqual(purlsFor(retMap, "local-gem"), [
    "pkg:gem/local-gem@0.1.0?platform=x86_64-linux",
  ]);
  // The platform qualifier is no longer duplicated as a property
  for (const pkg of retMap.pkgList) {
    assert.deepStrictEqual(
      pkg.properties.filter((prop) => prop.name === "cdx:gem:platform"),
      [],
    );
  }
  // Bundler 2.5 records a sha256 per gem in the CHECKSUMS section
  const withHashes = retMap.pkgList.filter((pkg) => pkg.hashes?.length);
  assert.deepStrictEqual(withHashes.map((pkg) => pkg.purl).sort(), [
    "pkg:gem/concurrent-ruby@1.3.4",
    "pkg:gem/ffi@1.17.0",
  ]);
  assert.deepStrictEqual(
    retMap.pkgList.find((pkg) => pkg.purl === "pkg:gem/concurrent-ruby@1.3.4")
      .hashes,
    [
      {
        alg: "SHA-256",
        content:
          "1a1bb9b4ea9e94d8b8b0a8ea2a4d0a5e9e0a1a5d3f5cb1a3f2b0e8b7a6c5d4e3",
      },
    ],
  );
  // No component is left without a version now that the native builds present
  // in the lockfile are reported instead of a phantom placeholder
  assert.deepStrictEqual(
    retMap.pkgList.filter((pkg) => !pkg.version),
    [],
  );
  // Both native variants of a gem resolve their pure ruby dependency
  const dependsOn = (ref) =>
    retMap.dependenciesList.find((d) => d.ref === ref)?.dependsOn;
  assert.deepStrictEqual(dependsOn("pkg:gem/nokogiri@1.16.7?platform=java"), [
    "pkg:gem/racc@1.8.1",
  ]);
  assert.deepStrictEqual(
    dependsOn("pkg:gem/nokogiri@1.16.7?platform=x86_64-linux"),
    ["pkg:gem/racc@1.8.1"],
  );
  assert.deepStrictEqual(
    dependsOn("pkg:gem/sqlite3@2.0.4?platform=x86_64-linux-gnu"),
    ["pkg:gem/mini_portile2@2.8.7"],
  );
});

it("parseGemspecData platform qualifiers", async () => {
  // Installed gemspecs of native gems use the marshalled Gem::Platform form
  let deps = await parseGemspecData(
    readFileSync("./test/data/gem-native.gemspec", { encoding: "utf-8" }),
    "./test/data/gem-native.gemspec",
  );
  assert.deepStrictEqual(deps.length, 1);
  assert.deepStrictEqual(deps[0].name, "nokogiri");
  assert.deepStrictEqual(deps[0].version, "1.16.7");
  assert.deepStrictEqual(
    deps[0].purl,
    "pkg:gem/nokogiri@1.16.7?platform=x86_64-linux",
  );
  assert.deepStrictEqual(
    deps[0]["bom-ref"],
    "pkg:gem/nokogiri@1.16.7?platform=x86_64-linux",
  );
  // A plain string platform is also supported
  deps = await parseGemspecData(
    readFileSync("./test/data/gem-java.gemspec", { encoding: "utf-8" }),
    "./test/data/gem-java.gemspec",
  );
  assert.deepStrictEqual(
    deps[0].purl,
    "pkg:gem/jruby-launcher@1.1.2?platform=java",
  );
  // A pure ruby gem declares no platform
  deps = await parseGemspecData(
    readFileSync("./test/data/nokogiri-1.10.10.gemspec", { encoding: "utf-8" }),
    "./test/data/nokogiri-1.10.10.gemspec",
  );
  assert.deepStrictEqual(deps[0].purl, "pkg:gem/nokogiri@1.10.10");
});

it("parseGemfileLockData", async () => {
  let retMap = await parseGemfileLockData(
    readFileSync("./test/data/Gemfile.lock", { encoding: "utf-8" }),
    "./test/data/Gemfile.lock",
  );
  assert.deepStrictEqual(retMap.pkgList.length, 140);
  assert.deepStrictEqual(retMap.rootList.length, 42);
  assert.deepStrictEqual(retMap.dependenciesList.length, 140);
  assert.deepStrictEqual(retMap.pkgList[0], {
    name: "actioncable",
    version: "6.0.0",
    purl: "pkg:gem/actioncable@6.0.0",
    "bom-ref": "pkg:gem/actioncable@6.0.0",
    properties: [
      { name: "internal:SrcFile", value: "./test/data/Gemfile.lock" },
      {
        name: "cdx:gem:remote",
        value: "https://rubygems.org/",
      },
    ],
    evidence: {
      identity: {
        field: "purl",
        confidence: 0.8,
        methods: [
          {
            technique: "manifest-analysis",
            confidence: 0.8,
            value: "./test/data/Gemfile.lock",
          },
        ],
      },
    },
  });
  retMap = await parseGemfileLockData(
    readFileSync("./test/data/Gemfile1.lock", { encoding: "utf-8" }),
    "./test/data/Gemfile1.lock",
  );
  assert.deepStrictEqual(retMap.pkgList.length, 36);
  assert.deepStrictEqual(retMap.rootList.length, 2);
  assert.deepStrictEqual(retMap.dependenciesList.length, 36);
  retMap = await parseGemfileLockData(
    readFileSync("./test/data/Gemfile2.lock", { encoding: "utf-8" }),
    "./test/data/Gemfile2.lock",
  );
  assert.deepStrictEqual(retMap.pkgList.length, 89);
  assert.deepStrictEqual(retMap.rootList.length, 2);
  assert.deepStrictEqual(retMap.dependenciesList.length, 89);
  retMap = await parseGemfileLockData(
    readFileSync("./test/data/Gemfile4.lock", { encoding: "utf-8" }),
    "./test/data/Gemfile4.lock",
  );
  assert.deepStrictEqual(retMap.pkgList.length, 182);
  assert.deepStrictEqual(retMap.rootList.length, 78);
  assert.deepStrictEqual(retMap.dependenciesList.length, 182);
  retMap = await parseGemfileLockData(
    readFileSync("./test/data/Gemfile5.lock", { encoding: "utf-8" }),
    "./test/data/Gemfile5.lock",
  );
  assert.deepStrictEqual(retMap.pkgList.length, 42);
  assert.deepStrictEqual(retMap.rootList.length, 11);
  assert.deepStrictEqual(retMap.dependenciesList.length, 42);
  assert.deepStrictEqual(purlsFor(retMap, "google-protobuf"), [
    "pkg:gem/google-protobuf@3.25.1?platform=x64-mingw-ucrt",
    "pkg:gem/google-protobuf@3.25.1?platform=x86_64-linux",
  ]);
  // sass-embedded is only referenced as a version constrained child of a
  // platform independent parent. Since the lockfile has no pure ruby build, we
  // report the native builds that do exist rather than a versionless component.
  assert.deepStrictEqual(purlsFor(retMap, "sass-embedded"), [
    "pkg:gem/sass-embedded@1.69.5?platform=x64-mingw-ucrt",
    "pkg:gem/sass-embedded@1.69.5?platform=x86_64-linux-gnu",
  ]);
  retMap = await parseGemfileLockData(
    readFileSync("./test/data/Gemfile6.lock", { encoding: "utf-8" }),
    "./test/data/Gemfile6.lock",
  );
  assert.deepStrictEqual(retMap.pkgList.length, 139);
  // Every native variant of a direct dependency is itself a direct dependency,
  // so bcrypt_pbkdf and ffi contribute their mingw builds here too.
  assert.deepStrictEqual(retMap.rootList.length, 25);
  assert.deepStrictEqual(retMap.dependenciesList.length, 139);
  // Multiple native variants of the same version remain distinct components
  assert.deepStrictEqual(purlsFor(retMap, "bcrypt_pbkdf"), [
    "pkg:gem/bcrypt_pbkdf@1.1.0",
    "pkg:gem/bcrypt_pbkdf@1.1.0?platform=x64-mingw32",
    "pkg:gem/bcrypt_pbkdf@1.1.0?platform=x86-mingw32",
  ]);
  assert.deepStrictEqual(purlsFor(retMap, "mixlib-shellout"), [
    "pkg:gem/mixlib-shellout@3.2.5",
    "pkg:gem/mixlib-shellout@3.2.5?platform=universal-mingw32",
  ]);
  retMap = await parseGemfileLockData(
    readFileSync("./test/data/Gemfile-opt.lock", { encoding: "utf-8" }),
    "./test/data/Gemfile-opt.lock",
  );
  assert.deepStrictEqual(retMap.pkgList.length, 36);
  assert.deepStrictEqual(retMap.rootList.length, 8);
  assert.deepStrictEqual(purlsFor(retMap, "google-protobuf"), [
    "pkg:gem/google-protobuf@3.23.4?platform=arm64-darwin",
    "pkg:gem/google-protobuf@3.23.4?platform=x86_64-linux",
  ]);
  assert.deepStrictEqual(retMap.rootList, [
    "pkg:gem/http_parser.rb@0.8.0",
    "pkg:gem/jekyll@4.3.4",
    "pkg:gem/jekyll-feed@0.17.0",
    "pkg:gem/jekyll-readme-index@0.3.0",
    "pkg:gem/tzinfo@2.0.6",
    "pkg:gem/tzinfo-data",
    "pkg:gem/wdm",
    "pkg:gem/webrick@1.8.2",
  ]);
  assert.deepStrictEqual(retMap.dependenciesList.length, 36);
});

it("toGemModuleName", () => {
  assert.deepStrictEqual(toGemModuleNames("ruby_parser"), ["RubyParser"]);
  assert.deepStrictEqual(toGemModuleNames("public_suffix"), ["PublicSuffix"]);
  assert.deepStrictEqual(toGemModuleNames("unicode-display_width"), [
    "Unicode",
    "Unicode::DisplayWidth",
  ]);
  assert.deepStrictEqual(toGemModuleNames("net-http-persistent"), [
    "Net",
    "Net::Http",
    "Net::Http::Persistent",
  ]);
  assert.deepStrictEqual(toGemModuleNames("ruby-prof"), ["RubyProf"]);
  assert.deepStrictEqual(toGemModuleNames("thread_safe"), ["ThreadSafe"]);
  assert.deepStrictEqual(toGemModuleNames("pluck_to_hash"), ["PluckToHash"]);
  assert.deepStrictEqual(toGemModuleNames("sinatra"), ["Sinatra"]);
  assert.deepStrictEqual(toGemModuleNames("passenger"), ["Passenger"]);
  assert.deepStrictEqual(toGemModuleNames("simplecov-html"), [
    "Simplecov",
    "Simplecov::Html",
  ]);
});

it("parseGemspecData", async () => {
  let deps = await parseGemspecData(
    readFileSync("./test/data/xmlrpc.gemspec", { encoding: "utf-8" }),
    "./test/data/xmlrpc.gemspec",
  );
  assert.deepStrictEqual(deps.length, 1);
  assert.deepStrictEqual(deps[0], {
    authors: [
      {
        name: "SHIBATA Hiroshi",
      },
    ],
    "bom-ref": "pkg:gem/xmlrpc@0.3.0",
    licenses: [
      {
        license: {
          name: "Ruby",
        },
      },
    ],
    description:
      "XMLRPC is a lightweight protocol that enables remote procedure calls over HTTP.",
    evidence: {
      identity: {
        confidence: 0.5,
        field: "purl",
        methods: [
          {
            confidence: 0.5,
            technique: "manifest-analysis",
            value: "./test/data/xmlrpc.gemspec",
          },
        ],
      },
    },
    homepage: "https://github.com/ruby/xmlrpc",
    name: "xmlrpc",
    properties: [
      {
        name: "cdx:gem:rubyVersionSpecifiers",
        value: ">= 2.3",
      },
      {
        name: "internal:SrcFile",
        value: "./test/data/xmlrpc.gemspec",
      },
    ],
    purl: "pkg:gem/xmlrpc@0.3.0",
    version: "0.3.0",
  });
  deps = await parseGemspecData(
    readFileSync("./test/data/loofah-2.3.1.gemspec", { encoding: "utf-8" }),
    "./test/data/loofah-2.3.1.gemspec",
  );
  assert.deepStrictEqual(deps.length, 1);
  assert.deepStrictEqual(deps[0], {
    authors: [
      {
        name: "Mike Dalessio",
      },
      {
        name: "Bryan Helmkamp",
      },
    ],
    "bom-ref": "pkg:gem/loofah@2.3.1",
    licenses: [
      {
        license: {
          name: "MIT",
        },
      },
    ],
    description:
      "Loofah is a general library for manipulating and transforming HTML/XML documents and fragments, built on top of Nokogiri.\\n\\nLoofah excels at HTML sanitization (XSS prevention). It includes some nice HTML sanitizers, which are based on HTML5lib's safelist, so it most likely won't make your codes less secure. (These statements have not been evaluated by Netexperts.)\\n\\nActiveRecord extensions for sanitization are available in the [`loofah-activerecord` gem](https://github.com/flavorjones/loofah-activerecord).",
    evidence: {
      identity: {
        confidence: 0.5,
        field: "purl",
        methods: [
          {
            confidence: 0.5,
            technique: "manifest-analysis",
            value: "./test/data/loofah-2.3.1.gemspec",
          },
        ],
      },
    },
    homepage: "https://github.com/flavorjones/loofah",
    name: "loofah",
    properties: [
      {
        name: "internal:SrcFile",
        value: "./test/data/loofah-2.3.1.gemspec",
      },
    ],
    purl: "pkg:gem/loofah@2.3.1",
    version: "2.3.1",
  });
  deps = await parseGemspecData(
    readFileSync("./test/data/nokogiri-1.10.10.gemspec", { encoding: "utf-8" }),
    "./test/data/nokogiri-1.10.10.gemspec",
  );
  assert.deepStrictEqual(deps.length, 1);
  assert.deepStrictEqual(deps[0], {
    authors: [
      {
        name: "Aaron Patterson",
      },
      {
        name: "Mike Dalessio",
      },
      {
        name: "Yoko Harada",
      },
      {
        name: "Tim Elliott",
      },
      {
        name: "Akinori MUSHA",
      },
      {
        name: "John Shahid",
      },
      {
        name: "Lars Kanis",
      },
    ],
    "bom-ref": "pkg:gem/nokogiri@1.10.10",
    licenses: [
      {
        license: {
          name: "MIT",
        },
      },
    ],
    description:
      "Nokogiri (\\u92F8) is an HTML, XML, SAX, and Reader parser. Among\\nNokogiri's many features is the ability to search documents via XPath\\nor CSS3 selectors.",
    evidence: {
      identity: {
        confidence: 0.5,
        field: "purl",
        methods: [
          {
            confidence: 0.5,
            technique: "manifest-analysis",
            value: "./test/data/nokogiri-1.10.10.gemspec",
          },
        ],
      },
    },
    externalReferences: [
      {
        type: "issue-tracker",
        url: "https://github.com/sparklemotion/nokogiri/issues",
        comment: "bug_tracker_uri",
      },
      {
        type: "release-notes",
        url: "https://nokogiri.org/CHANGELOG.html",
        comment: "changelog_uri",
      },
      {
        type: "documentation",
        url: "https://nokogiri.org/rdoc/index.html",
        comment: "documentation_uri",
      },
      {
        type: "website",
        url: "https://nokogiri.org",
        comment: "homepage_uri",
      },
      {
        type: "vcs",
        url: "https://github.com/sparklemotion/nokogiri",
        comment: "source_code_uri",
      },
    ],
    homepage: "https://nokogiri.org",
    name: "nokogiri",
    properties: [
      {
        name: "cdx:gem:executables",
        value: "nokogiri",
      },
      {
        name: "cdx:gem:extensions",
        value: "ext/nokogiri/extconf.rb",
      },
      {
        name: "cdx:gem:rubyVersionSpecifiers",
        value: ">= 2.3.0",
      },
      {
        name: "internal:SrcFile",
        value: "./test/data/nokogiri-1.10.10.gemspec",
      },
    ],
    purl: "pkg:gem/nokogiri@1.10.10",
    version: "1.10.10",
  });
  deps = await parseGemspecData(
    readFileSync("./test/data/activerecord-import.gemspec", {
      encoding: "utf-8",
    }),
    "./test/data/activerecord-import.gemspec",
  );
  assert.deepStrictEqual(deps.length, 1);
  assert.deepStrictEqual(deps[0], {
    authors: [
      {
        name: "Zach Dennis",
      },
    ],
    "bom-ref": "pkg:gem/activerecord-import",
    version: undefined,
    description: "A library for bulk inserting data using ActiveRecord.",
    evidence: {
      identity: {
        confidence: 0.2,
        field: "purl",
        methods: [
          {
            confidence: 0.2,
            technique: "manifest-analysis",
            value: "./test/data/activerecord-import.gemspec",
          },
        ],
      },
    },
    externalReferences: [
      {
        type: "release-notes",
        url: "https://github.com/zdennis/activerecord-import/blob/master/CHANGELOG.md",
        comment: "changelog_uri",
      },
    ],
    homepage: "https://github.com/zdennis/activerecord-import",
    name: "activerecord-import",
    properties: [
      {
        name: "cdx:gem:rubyVersionSpecifiers",
        value: ">= 2.4.0",
      },
      {
        name: "internal:SrcFile",
        value: "./test/data/activerecord-import.gemspec",
      },
    ],
    purl: "pkg:gem/activerecord-import",
  });
});

it("gem parsing and local cache enrichment work in dry-run mode", async () => {
  // Dry-run blocks writes, subprocesses and network calls. Lockfile parsing and
  // local cache enrichment only read files, so both must still work, which is
  // what makes the cached metadata valuable when the registry is unreachable.
  const {
    enrichGemsFromLocalCache: dryEnrich,
    parseGemfileLockData: dryParse,
  } = await esmock("./rubyutils.js", {
    "../core/env.js": { shouldFetchLicense: () => false, isDryRun: true },
  });
  const lockFile = "./test/data/Gemfile-platforms.lock";
  const retMap = await dryParse(
    readFileSync(lockFile, { encoding: "utf-8" }),
    lockFile,
  );
  assert.deepStrictEqual(retMap.pkgList.length, 27);
  assert.deepStrictEqual(
    retMap.pkgList.filter((pkg) => pkg.hashes?.length).length,
    2,
  );
  const pkgList = [
    {
      name: "nokogiri",
      version: "1.16.7",
      purl: "pkg:gem/nokogiri@1.16.7?platform=x86_64-linux",
      properties: [],
    },
  ];
  await dryEnrich(pkgList, {
    gemHome: CACHED_GEM_HOME,
    compactIndexCacheDir: COMPACT_INDEX_CACHE,
  });
  assert.deepStrictEqual(
    pkgList[0]._integrity,
    "sha256-aa1388184e975d091e6e38ce3f3b3388bfb7e4ac3d790efd8e39124844040bd1",
  );
  assert.deepStrictEqual(pkgList[0].license, ["MIT"]);
});

it("collectGemModuleNames is blocked in dry-run mode", async () => {
  // The module collection shells out to `bundle exec ruby`, which safeSpawnSync
  // refuses to run in dry-run mode. It must degrade to the name based guess
  // rather than throw.
  const { collectGemModuleNames: dryCollect } = await esmock("./rubyutils.js", {
    "../core/fs.js": {
      safeSpawnSync: () => ({
        status: 1,
        stdout: undefined,
        stderr: undefined,
        error: new Error("dry run"),
      }),
      isDryRun: true,
    },
  });
  assert.deepStrictEqual(
    dryCollect("ruby", "bundle", "/tmp/gem-home", "public_suffix", "/tmp"),
    ["PublicSuffix"],
  );
});
