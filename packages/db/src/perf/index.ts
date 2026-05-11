/**
 * Track 4 Section T — Performance & observability helpers.
 *
 * Barrel-export for the perf module. Currently exposes the slow-query
 * monitor (#102); future entries (#103 client-error-log) sit alongside.
 */

export * from './slow-query-monitor.js';
