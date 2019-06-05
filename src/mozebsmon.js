/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2019 */

import fs from "fs";
import path from "path";

import {
  ADDON_TYPE_STRINGS, ADDON_CHANNEL_STRINGS,
  ADDON_STATUS_STRINGS, ADDON_FILE_STATUS_STRINGS,
  REDASH_POLLING_TIMEOUT_MS
} from "amolib";

export default class MozEbsMon {
  constructor({ redash, ripgrep, patternconfig, push }) {
    this.redash = redash;
    this.ripgrep = ripgrep;
    this.patternconfig = patternconfig;
    this.push = push;
  }

  async getpaths({ channel, after, until, addontype, status, addonstatus }) {
    let query = this.redash.buildQuery()
      .select("f.created", "a.addontype_id", "a.id AS addon_id", "v.channel",
        "v.id AS version_id", "f.id AS file_id")
      .from("files")
      .join("versions")
      .join("addons")
      .orderby("f.created")
      .where("f.is_webextension = 1");


    if (addontype && addontype != "all") {
      let addonTypeIds = addontype.map(type => ADDON_TYPE_STRINGS[type] || type);
      query.where(`a.addontype_id IN (${addonTypeIds.join(",")})`);
    }

    if (addonstatus) {
      let statusIds = addonstatus.map(value => ADDON_STATUS_STRINGS[value] || value);
      query.where(`a.status IN (${statusIds.join(",")})`);
    }

    if (status) {
      let statusIds = status.map(value => ADDON_FILE_STATUS_STRINGS[value] || value);
      query.where(`f.status IN (${statusIds.join(",")})`);
    }

    if (channel) {
      query.where("v.channel = " + (ADDON_CHANNEL_STRINGS[channel] || channel));
    }

    if (after) {
      query.where("f.created > " + JSON.stringify(after));
    }

    if (until) {
      query.where("f.created <= " + JSON.stringify(until));
    }

    let result = await query.run(2 * REDASH_POLLING_TIMEOUT_MS);
    return result.query_result.data.rows.map(row => {
      return `${row.addontype_id}/${row.addon_id}/${row.channel}/${row.version_id}/${row.file_id}`;
    });
  }

  async search(argv) {
    let nowdate = new Date();
    nowdate.setHours(0, 0, 0, 0);
    nowdate = nowdate.toISOString();

    if (!argv.until) {
      argv.until = nowdate;
    }

    let paths = await this.getpaths(argv);
    let options = this.ripgrep.constructor.argsToOptions(argv);

    if (paths.length == 0) {
      console.warn(`No files found between ${argv.after || "the beginning"} and ${nowdate}`);
    } else {
      console.warn(`Searching ${paths.length} files for ${argv.patterns.length} pattern` +
                   ` between ${argv.after || "the beginning"} and ${nowdate}`);
      await this.ripgrep.run(paths, argv.patterns, options);
    }
  }

  async searchRun({ outdir }) {
    function multilog(...args) {
      console.log(...args);
      output.write(args.join(" ") + "\n");
    }

    // EBS volume only unzips every 24 hours, gotta go back to the start of today
    let nowdate = new Date();
    nowdate.setHours(0, 0, 0, 0);
    nowdate = nowdate.toISOString();

    let byDate = {};
    for (let [pattern, data] of Object.entries(this.patternconfig.data)) {
      let { lastrun, options } = data;
      let key = lastrun + "#" + JSON.stringify(options); // TODO not a great key

      if (!(key in byDate)) {
        byDate[key] = { patterns: [], options: options, date: lastrun };
      }

      byDate[key].patterns.push(pattern);
    }

    let output = fs.createWriteStream(path.join(outdir, `mozebs-${nowdate}.txt`));

    try {
      for (let { patterns, options, date } of Object.values(byDate)) {
        multilog(`Getting new files between ${date} and ${nowdate}`);
        let paths = await this.getpaths({ after: date, until: nowdate });

        if (paths.length) {
          let optionsString = this.ripgrep.constructor.optionsToString(options);
          multilog(`Running the following patterns on ${paths.length} paths` +
                   ` with options ${optionsString}:`);
          multilog("\t" + patterns.join("\n\t"));

          let files;

          try {
            files = await this.ripgrep.run(paths, patterns, options, output);
          } catch (e) {
            multilog("Error during ripgrep run: " + e);
            continue;
          }

          multilog(`Found ${files.length} files`);

          // This push can go ahead and fail, don't wait on it.
          this.push.notify(`Found ${files.length} files`, `Patterns ${patterns.join(",")}`);
        } else {
          multilog("No new files for the following patterns:");
          multilog("\t" + patterns.join("\n\t"));
        }

        for (let pattern of patterns) {
          this.patternconfig.markrun(pattern, nowdate);
        }
      }
    } finally {
      this.patternconfig.save();
      output.close();
    }
  }

  async track(pattern, argv) {
    let added = this.patternconfig.add(pattern, this.ripgrep.constructor.argsToOptions(argv));

    if (added) {
      this.patternconfig.save();
    } else {
      console.log("Pattern already tracked");
    }
  }
}
