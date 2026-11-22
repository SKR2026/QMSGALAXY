/**
 * utilities/dateUtils.js
 * Time zone-aware date helpers for Cloud Functions.
 *
 * All date calculations use the organization's configured time zone (IST by default).
 * Never rely on the Cloud Functions server's local time.
 */

'use strict';

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Get today's date in IST as a Date object (time = midnight IST).
 */
function getTodayIST(timezone = DEFAULT_TIMEZONE) {
  const now       = new Date();
  const istString = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  return new Date(istString + 'T00:00:00Z');
}

/**
 * Add (or subtract) days to a Date object.
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Format a Date to YYYY-MM-DD string.
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Parse a YYYY-MM-DD string to a Date (midnight UTC).
 */
function parseDate(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

/**
 * Check if a YYYY-MM-DD string is overdue relative to today in IST.
 */
function isOverdue(dateStr, timezone = DEFAULT_TIMEZONE) {
  if (!dateStr) return false;
  const today    = getTodayIST(timezone);
  const dueDate  = parseDate(dateStr);
  return dueDate < today;
}

/**
 * Days remaining until a due date (negative = overdue).
 */
function daysUntil(dateStr, timezone = DEFAULT_TIMEZONE) {
  if (!dateStr) return null;
  const today   = getTodayIST(timezone);
  const dueDate = parseDate(dateStr);
  return Math.ceil((dueDate - today) / 86400000);
}

module.exports = { getTodayIST, addDays, formatDate, parseDate, isOverdue, daysUntil };
