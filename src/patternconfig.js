/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2019 */

import path from "path";
import os from "os";
import fs from "fs";

const DEFAULT_CONFIG = path.join(os.homedir(), ".amo_ebs_patterns");

var gConfig = null;

export function getPatternConfig(filename) {
  if (!gConfig) {
    gConfig = new PatternConfig(filename || DEFAULT_CONFIG);
    gConfig.load();
  }
  return gConfig;
}


class PatternConfig {
  constructor(filename=DEFAULT_CONFIG) {
    this.filename = filename;
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.filename, "utf-8"));
    } catch (e) {
      if (e.code == "ENOENT") {
        this.data = {};
      } else {
        throw e;
      }
    }
  }

  save() {
    fs.writeFileSync(this.filename, JSON.stringify(this.data, null, 2));
  }

  add(pattern, options={}) {
    if (this.data.hasOwnProperty(pattern)) {
      return false;
    }
    this.data[pattern] = { lastrun: null, options };
    return true;
  }

  markrun(pattern, thisrun) {
    this.data[pattern].lastrun = thisrun;
  }
}
