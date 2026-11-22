/**
 * config.js
 * Cloud Functions configuration helpers.
 * Reads from Firebase Functions environment config.
 * NEVER hardcode secrets here.
 */

'use strict';

const functions = require('firebase-functions');

module.exports = {
  APP_ROOT:   'apps/lpa',
  TIMEZONE:   'Asia/Kolkata',

  getEmailConfig: () => functions.config().email || {},
  getFCMConfig:   () => functions.config().fcm   || {}
};
