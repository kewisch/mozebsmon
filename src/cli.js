/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2019 */

import os from "os";
import path from "path";

import yargs from "yargs";

import {
  ADDON_TYPE_STRINGS, ADDON_CHANNEL_STRINGS, ADDON_STATUS_STRINGS, ADDON_FILE_STATUS_STRINGS,
  AMORedashClient,
  getConfig
} from "amolib";

import Ripgrep from "./ripgrep";
import MozEbsMon from "./mozebsmon";
import PushNotifications from "./push";
import { DEFAULT_EBS_UNZIPPED_PATH } from "./constants";


/**
 * The main program executed when called.
 */
(async function() {
  process.stdin.setEncoding("utf8");

  let config = getConfig();

  function searchYargs(subyargs) {
    subyargs.option("c", {
      alias: "channel",
      choices: [
        ...Object.keys(ADDON_CHANNEL_STRINGS),
        ...Object.values(ADDON_CHANNEL_STRINGS)
      ],
      nargs: 1,
      describe: "The channel to limit to"
    })
      .option("d", {
        alias: "after",
        nargs: 1,
        describe: "The date to search after"
      })
      .option("u", {
        alias: "until",
        nargs: 1,
        describe: "The date to search up to"
      })
      .option("s", {
        alias: "status",
        type: "array",
        nargs: 1,
        choices: [
          ...Object.keys(ADDON_FILE_STATUS_STRINGS),
          ...Object.values(ADDON_FILE_STATUS_STRINGS)
        ],
        describe: "The file status that must be set"
      })
      .option("a", {
        alias: "addonstatus",
        type: "array",
        nargs: 1,
        choices: [
          ...Object.keys(ADDON_STATUS_STRINGS),
          ...Object.values(ADDON_STATUS_STRINGS)
        ],
        describe: "The addon status that must be set"
      })
      .option("t", {
        "alias": "addontype",
        "type": "array",
        "nargs": 1,
        "choices": [
          ...Object.keys(ADDON_TYPE_STRINGS),
          ...Object.values(ADDON_TYPE_STRINGS),
          "all"
        ],
        "default": ["extension"],
        "describe": "The addon types to search for"
      });
  }

  function rgYargs(subyargs) {
    subyargs.option("g", {
      "alias": "glob",
      "nargs": 1,
      "default": [],
      "type": "array"
    })
      .option("F", {
        "alias": "fixed-strings",
        "boolean": true
      })
      .option("C", {
        alias: "context",
        nargs: 1,
        type: "number"
      });
  }

  let argv = yargs
    .option("debug", {
      "boolean": true,
      "global": true,
      "describe": "Enable debugging"
    })
    .option("unzipped", {
      "nargs": 1,
      "global": true,
      "default": DEFAULT_EBS_UNZIPPED_PATH
    })
    .command("paths", "Show paths for the subset of add-ons", (subyargs) => {
      searchYargs(subyargs);
    })
    .command("search [patterns...]", "Find something within a subset of add-ons", (subyargs) => {
      searchYargs(subyargs);
      rgYargs(subyargs);
    })
    .command("searchrun", "Start a search run with tracked patterns", (subyargs) => {
      subyargs.option("o", {
        "alias": "outdir",
        "nargs": 1,
        "default": ".",
        "coerce": (arg) => {
          if (arg.startsWith("~/")) {
            arg = path.join(os.homedir(), arg.substr(2));
          }
          return arg;
        }
      });
    })
    .command("track [pattern]", "Track a specific pattern", (subyargs) => {
      rgYargs(subyargs);
    })
    .demandCommand(1, 1, "Error: Missing required command")
    .config((config && config.mozebsmon && config.mozebsmon.defaults) || {})
    .wrap(120)
    .argv;


  let mozebsmon = new MozEbsMon({
    redash: new AMORedashClient({
      apiToken: config.auth && config.auth.redash_key,
      debug: argv.debug
    }),
    ripgrep: new Ripgrep(argv.unzipped, { debug: argv.debug }),
    push: new PushNotifications(config.mozebsmon && config.mozebsmon.push)
  });

  switch (argv._[0]) {
    case "search":
      await mozebsmon.search(argv);
      break;
    case "searchrun":
      await mozebsmon.searchRun(argv);
      break;
    case "paths":
      console.log((await mozebsmon.getpaths(argv)).join("\n"));
      break;
    case "track":
      await mozebsmon.track(argv.pattern, argv);
      break;
    case "testnotify":
      await mozebsmon.push.notify("testnotify", "Notifications work!");
      break;
    default:
      yargs.showHelp();
      break;
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
