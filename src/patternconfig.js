/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2019 */

import fs from "fs";

export default class PatternConfig {
  constructor(filename) {
    this.filename = filename;
    this.load();
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
