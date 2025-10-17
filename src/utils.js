/**
 * Utility Functions
 *
 * Helper functions for formatting, date handling, and common operations.
 */

const { format } = require('date-fns');

/**
 * Format duration in milliseconds to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Format file size in bytes to human-readable string
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} bytes`;
  } else if (bytes < 1048576) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else {
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }
}

/**
 * Generate timestamp-based filename
 * @param {string} baseName - Base filename without extension
 * @param {string} extension - File extension (with dot)
 * @returns {string} Filename with timestamp
 */
function generateTimestampedFilename(baseName, extension) {
  const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');
  return `${baseName}-${timestamp}${extension}`;
}

/**
 * Format date to ISO string in UTC
 * @param {Date} date - Date object
 * @returns {string} ISO formatted date string
 */
function formatDateUTC(date) {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

/**
 * Format date to EST/EDT timezone with format: YYYY-MM-DD HH:mm:ss EST/EDT
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} Formatted date string in EST/EDT
 */
function formatDateEST(date) {
  const dateObj = typeof date === 'string' ? new Date(date) : date;

  // Format using US Eastern timezone
  const options = {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(dateObj);
  const partMap = {};
  parts.forEach(part => {
    partMap[part.type] = part.value;
  });

  // Determine if it's EST or EDT
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  });
  const tzName = formatter.formatToParts(dateObj).find(part => part.type === 'timeZoneName')?.value || 'EST';

  return `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second} ${tzName}`;
}

/**
 * Calculate days difference between two dates
 * @param {Date} date1 - First date
 * @param {Date} date2 - Second date
 * @returns {number} Days difference
 */
function daysDifference(date1, date2) {
  const diffTime = Math.abs(date2 - date1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

module.exports = {
  formatDuration,
  formatFileSize,
  generateTimestampedFilename,
  formatDateUTC,
  formatDateEST,
  daysDifference
};
