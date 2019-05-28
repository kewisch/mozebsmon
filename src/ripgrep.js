/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2019 */

import child_process from "child_process";
import path from "path";
import readline from "readline";
import os from "os";
import fs from "fs";
import del from "del";
import util from "util";

const RIPGREP_DEFAULTS = "--no-ignore --no-heading --with-filename --line-number";

const mkdtemp = util.promisify(fs.mkdtemp);
const writeFile = util.promisify(fs.writeFile);

export default class Ripgrep {
  static argsToOptions(argv) {
    return {
      "fixed-strings": argv["fixed-strings"],
      "glob": argv.glob,
      "context": argv.context
    };
  }

  static optionsToString(options) {
    let stringOptions = [];
    for (let [name, value] of Object.entries(options)) {
      if (typeof value == "boolean" || typeof value == "undefined") {
        stringOptions.push(`--${name}`);
      } else if (Array.isArray(value)) {
        stringOptions.push(...value.map(option => `--${name} ${option}`));
      } else {
        stringOptions.push(`--${name} ${value}`);
      }
    }
    return stringOptions.join(" ");
  }

  constructor(cwd, { debug }) {
    this.debug = debug;
    this.cwd = cwd;
  }

  async run(paths, patterns, extraOptions, outStream=null) {
    let folder = await mkdtemp(path.join(os.tmpdir(), "mozebs"));

    let rgfiles = path.join(folder, "rgfiles");
    await writeFile(rgfiles, paths.join("\n") + "\n");

    let patternfile = path.join(folder, "patternfile");
    await writeFile(patternfile, patterns.join("\n") + "\n");

    let response;
    try {
      response = await this.runFiles(rgfiles, patternfile, extraOptions, outStream);
    } finally {
      if (this.debug) {
        console.warn(`Debugging is on, temporary folder ${folder} not deleted`);
      } else {
        await del([folder], { force: true });
      }
    }
    return response;
  }

  async runFiles(paths, patterns, extraOptions, outStream=null) {
    let options = Ripgrep.optionsToString(extraOptions);
    let rgcmd = `rg -f ${path.resolve(patterns)} ${RIPGREP_DEFAULTS} ${options}`;
    let xargscmd = `cat ${paths} | xargs ${rgcmd}`;
    if (this.debug) {
      console.warn("RIPGREP:", xargscmd);
    }

    let foundFiles = [];

    await new Promise((resolve, reject) => {
      let rgproc = child_process.spawn("sh", ["-c", xargscmd], {
        cwd: path.resolve(this.cwd),
        env: { PATH: process.env.PATH },
        // stdio: ["ignore", "pipe", this.debug ? "inherit" : "ignore"],
        stdio: ["ignore", "pipe", "inherit"],
      });

      let rli = readline.createInterface({ input: rgproc.stdout });

      rli.on("line", (input) => {
        let file = input.substr(0, input.indexOf(":"));
        let [addontype_id, addon_id, version_id, file_id] =
          file.split("/", 4).map(part => parseInt(part, 10));

        foundFiles.push({ addontype_id, addon_id, version_id, file_id });

        if (outStream) {
          outStream.write(input + "\n");
        } else {
          console.log(input);
        }
      });

      rgproc.on("close", (code) => {
        if (code < 2) {
          resolve();
        } else if (code == 123) {
          reject("Some files were not found, likely they were not yet unzipped." +
                 " Run with --debug for details.");
        } else {
          reject(`Ripgrep error ${code}. Run with --debug for details.`);
        }
      });
    });

    return foundFiles;
  }
}
