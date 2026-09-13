package = "lua-resty-http"
version = "0.17.1-0"
source = {
   url = "git+https://github.com/ledgetech/lua-resty-http",
   tag = "v0.17.1",
}
description = {
   summary = "Lua HTTP client cosocket driver for OpenResty / ngx_lua.",
   homepage = "https://github.com/ledgetech/lua-resty-http",
   license = "BSD-2-Clause",
}
dependencies = {
   "lua >= 5.1",
   "net-url >= 0.9",
}
build = {
   type = "builtin",
   modules = {
      ["resty.http"] = "lib/resty/http.lua",
      ["resty.http_headers"] = "lib/resty/http_headers.lua",
   },
}
