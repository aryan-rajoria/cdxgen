const debug = require("debug");
const isNumber = require("is-number");

debug("app")(isNumber(42));
