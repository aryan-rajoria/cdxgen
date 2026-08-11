// build.zig is intentionally a stub: cdxgen parses build.zig.zon only, because
// evaluating build.zig requires the Zig toolchain. The file exists so the
// fixture directory looks like a real Zig project to file-based detection.
const std = @import("std");

pub fn build(b: *std.Build) void {
    _ = b;
}
