import { assert, describe, it } from "poku";

import { createBom } from "./index.js";

/**
 * End-to-end dispatch coverage for the newer ecosystem types. Each case hands
 * a fixture project to createBom with an explicit project type and checks
 * that the expected component and purl shape come back.
 */
describe("createBom() new ecosystem dispatch", () => {
  const cases = [
    {
      label: "julia",
      dir: "./test/data/julia-smoke",
      type: "julia",
      expectName: "JSON",
      expectPurlPrefix: "pkg:julia/JSON",
    },
    {
      label: "terraform",
      dir: "./test/data/terraform-smoke",
      type: "terraform",
      expectName: "aws",
      expectPurlPrefix: "pkg:generic/registry.terraform.io/hashicorp/aws",
    },
    {
      label: "r",
      dir: "./test/data/renv-smoke",
      type: "r",
      expectName: "dplyr",
      expectPurlPrefix: "pkg:cran/dplyr",
    },
    {
      label: "erlang",
      dir: "./test/data/rebar-smoke",
      type: "rebar3",
      expectName: "cowboy",
      expectPurlPrefix: "pkg:hex/cowboy",
    },
    {
      label: "ocaml",
      dir: "./test/data/opam-smoke",
      type: "ocaml",
      expectName: "dune",
      expectPurlPrefix: "pkg:opam/dune@3.16.0",
    },
    {
      label: "perl",
      dir: "./test/data/perl-smoke",
      type: "carton",
      expectName: "Plack",
      expectPurlPrefix: "pkg:cpan/MIYAGAWA/Plack",
    },
    {
      label: "elm",
      dir: "./test/data/elm-smoke",
      type: "elm",
      expectName: "http",
      expectPurlPrefix: "pkg:generic/elm/http@1.0.0",
    },
    {
      label: "crystal",
      dir: "./test/data/crystal-smoke",
      type: "crystal",
      expectName: "http-f",
      expectPurlPrefix: "pkg:generic/http-f@1.0.1",
    },
    {
      label: "nim",
      dir: "./test/data/nim-smoke",
      type: "nim",
      expectName: "semver",
      expectPurlPrefix: "pkg:generic/semver@1.0.0",
    },
    {
      label: "lua",
      dir: "./test/data/lua-smoke",
      type: "luarocks",
      expectName: "net-url",
      expectPurlPrefix: "pkg:luarocks/net-url@0.9-0",
    },
    {
      label: "spack",
      dir: "./test/data/spack-smoke",
      type: "spack",
      expectName: "zlib",
      expectPurlPrefix: "pkg:generic/spack/zlib@1.3.1",
    },
    {
      label: "haskell stack",
      dir: "./test/data/stack-smoke",
      type: "stack",
      expectName: "acme-missiles",
      expectPurlPrefix: "pkg:hackage/acme-missiles@0.3",
    },
  ];
  for (const testCase of cases) {
    it(`generates a BOM for ${testCase.label} projects`, async () => {
      const bomNSData = await createBom(testCase.dir, {
        projectType: [testCase.type],
        multiProject: true,
      });
      assert.ok(bomNSData?.bomJson, "bomJson should be present");
      const components = bomNSData.bomJson.components || [];
      const target = components.find((c) => c.name === testCase.expectName);
      assert.ok(target, `expected a component named ${testCase.expectName}`);
      assert.ok(
        target.purl?.startsWith(testCase.expectPurlPrefix),
        `unexpected purl ${target.purl}`,
      );
    });
  }
});
