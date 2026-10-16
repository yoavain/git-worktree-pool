#!/usr/bin/env node
import { defaultIo } from "../cli/io.js";
import { main } from "../cli/main.js";

process.exitCode = await main(process.argv.slice(2), defaultIo());
