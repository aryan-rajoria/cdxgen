import { assert } from "@std/assert";
import { fileServer } from "@std/http/file-server";
import chalk from "chalk";
import lodash from "lodash";

console.log(chalk.green("hello"));
console.log(typeof lodash);
console.log(typeof fileServer);
assert(true);
