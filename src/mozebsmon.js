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

import { DEFAULT_EBS_BANNED_PATH } from "./constants";

export default class MozEbsMon {
  constructor({ redash, ripgrep, patternconfig, push }) {
    this.redash = redash;
    this.ripgrep = ripgrep;
    this.patternconfig = patternconfig;
    this.push = push;
  }

  async getpaths({ channel, after, until, addontype, status, addonstatus, maxid, minid, aspath = true }) {
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

    if (maxid) {
      query.where("f.id <= " + JSON.stringify(maxid));
    }

    if (minid) {
      query.where("f.id >= " + JSON.stringify(minid));
    }

    let result = await query.run(2 * REDASH_POLLING_TIMEOUT_MS);
    if (aspath) {
      return result.query_result.data.rows.map(row => {
        return `${row.addontype_id}/${row.addon_id}/${row.channel}/${row.version_id}/${row.file_id}`;
      });
    } else {
      return result.query_result.data.rows;
    }
  }

  async getMaxId({ addontype, unzipped }) {
    let startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let rows = await this.getpaths({ after: startOfDay.toISOString(), addontype: addontype, aspath: false });

    let maxid = 0;
    let maxdate = null;
    for (let row of rows) {
      let filepath = `${row.addontype_id}/${row.addon_id}/${row.channel}/${row.version_id}/${row.file_id}`;
      let file_id = parseInt(row.file_id, 10);

      if ((fs.existsSync(path.join(unzipped, filepath)) ||
           fs.existsSync(path.join(DEFAULT_EBS_BANNED_PATH, filepath))) &&
          file_id > maxid) {
        maxid = file_id;
        maxdate = row.created;
      }
    }

    return { maxid, maxdate };
  }

  async search(argv) {
    let paths;
    if (argv.channel || argv.after || argv.until || argv.status || argv.addonstatus) {
      paths = await this.getpaths(argv);
    }

    let options = this.ripgrep.constructor.argsToOptions(argv);

    let files = [];

    if (paths && paths.length == 0) {
      console.warn(`No files found between ${argv.after || "the beginning"} and ${nowisodate}`);
    } else if (paths) {
      console.warn(`Searching ${paths.length} files for ${argv.patterns.length} pattern` +
                   ` between ${argv.after || "the beginning"} and ${nowisodate}`);
      files = await this.ripgrep.run(paths, argv.patterns, options);
    } else {
      let { maxid, maxdate } = await this.getMaxId(argv);
      console.warn(`Maximum file id is ${maxid} at ${maxdate}`);
      console.warn(`Searching all files for ${argv.patterns.length} pattern(s)`);
      let addonTypeIds = argv.addontype.map(type => ADDON_TYPE_STRINGS[type] || type);
      files = await this.ripgrep.run(addonTypeIds, argv.patterns, options);
    }

    if (files.length > 0) {
      await this.push.notify(`Found ${files.length} files`, `Patterns ${argv.patterns}`);
    }
  }

  async searchRun({ outdir, unzipped }) {
    function multilog(...args) {
      console.log(...args);
      output.write(args.join(" ") + "\n");
    }

    let { maxid, maxdate } = await this.getMaxId({ unzipped });

    let totalfiles = 0;
    let outpath = path.join(outdir, `mozebs-${maxdate}.txt`);
    console.log("Writing results to " + outpath);

    let output = fs.createWriteStream(outpath);
    let foundAddons = new Set();
    let byDate = {};

    multilog(`Newest available add-on file is ${maxid} at ${maxdate}`);

    for (let [pattern, data] of Object.entries(this.patternconfig.data)) {
      if (data.disabled) {
        continue;
      }

      let lastid = typeof data.lastrun == "number" ? data.lastrun : null;
      let lastdate = typeof data.lastrun == "string" ? data.lastrun : null;

      if (lastid && lastid >= maxid) {
        continue;
      }

      if (!(data.lastrun in byDate)) {
        if (data.lastrun) {
          multilog(`Getting new files between ${data.lastrun} and ${maxid}`);
          byDate[data.lastrun] = {
            paths: await this.getpaths({ minid: lastid, maxid: maxid, after: lastdate }),
            data: []
          };
        } else {
          byDate[data.lastrun] = {
            paths: ["."],
            data: []
          };
        }
      }

      byDate[data.lastrun].data.push({ pattern: pattern, options: data.options });
    }

    try {
      for (let { paths, data } of Object.values(byDate)) {
        for (let { options, pattern } of data) {
          if (paths.length) {
            let optionsString = this.ripgrep.constructor.optionsToString(options);
            let pathname = paths.length == 1 && paths[0] == "." ? "all" : paths.length;
            multilog(`Running ${pattern} on ${pathname} paths with options ${optionsString}`);

            let files;

            try {
              files = await this.ripgrep.run(paths, [pattern], options, output, foundAddons);
            } catch (e) {
              multilog("Error during ripgrep run: " + e);
              continue;
            }

            multilog(`Found ${files.length} files`);
            totalfiles += files.length;

            // This push can go ahead and fail, don't wait on it.
            if (files.length > 0) {
              this.push.notify(`Found ${files.length} files`, `Pattern ${pattern}`);
            }
          } else {
            multilog("No new files for " + pattern);
          }

          this.patternconfig.markrun(pattern, maxid);
        }
      }

      if (Object.keys(byDate).length == 0) {
        multilog("Nothing to be done");
      } else {
        this.push.notify(`Search run complete, found ${totalfiles} files`, `${Object.keys(byDate).length} patterns`);
      }
    } finally {
      this.patternconfig.save();
      output.close();
    }
  }

  async track(pattern, argv) {
    let added = this.patternconfig.add(pattern, this.ripgrep.constructor.argsToOptions(argv));

    if (added) {
      if (argv.maxid) {
        this.patternconfig.markrun(pattern, argv.maxid);
      }
      this.patternconfig.save();
    } else {
      console.log("Pattern already tracked");
    }
  }
}
