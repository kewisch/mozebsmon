/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2019 */

import PushBullet from "pushbullet";

export default class PushNotifications {
  constructor(config) {
    this.config = config || {};
    this.pushbullet = config && config.apikey ? new PushBullet(config.apikey) : null;
  }

  async initialize() {
    if (this.initialized) {
      return true;
    } else if (!this.config.apikey) {
      return false;
    }

    this.userinfo = await this.pushbullet.me();
    if (this.config.e2ePassword) {
      await this.pushbullet.enableEncryption(this.config.e2ePassword, this.userinfo.iden);
    } else {
      console.warn("Consider turning on end to end encryption for pushes");
    }

    this.initialized = true;
    return true;
  }

  async notify(title, message) {
    if (!await this.initialize()) {
      return;
    }

    this.pushbullet.sendEphemeral({
      type: "mirror",
      title: title,
      body: message,
      source_user_iden: this.userinfo.iden,
      application_name: "mozebsmon",
      dismissable: true,
      package_name: "com.pushbullet.android"
    });
  }
}
