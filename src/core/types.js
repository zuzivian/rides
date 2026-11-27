// Shared shapes, documented once. Mirrors what a Swift `struct Trip` would hold.

/**
 * @typedef {Object} Trip
 * @property {string} id
 * @property {'uber'|'lyft'|'email'|'generic'|'manual'} source
 * @property {number} start          UTC ms. Pickup time, or request time if pickup is missing.
 * @property {number|null} end       UTC ms of dropoff.
 * @property {number|null} requested UTC ms of request.
 * @property {string} tz             IANA zone used for local-time stats.
 * @property {number|null} fromLat
 * @property {number|null} fromLng
 * @property {number|null} toLat
 * @property {number|null} toLng
 * @property {string} fromAddress
 * @property {string} toAddress
 * @property {number|null} km
 * @property {number|null} fare
 * @property {string} currency       ISO 4217, '' if unknown.
 * @property {string} product        Normalised ride type, e.g. "UberX".
 * @property {string} city
 * @property {boolean} [estimated]  Distance and time are estimates (rides added by hand).
 * @property {string} [series]      Shared id for rides generated together (a usual commute).
 */

/**
 * @typedef {Object} ParseResult
 * @property {Trip[]} trips
 * @property {'uber'|'lyft'|'email'|'generic'} source
 * @property {string[]} headers
 * @property {{canceled:number, invalid:number, nonRide:number}} skipped
 * @property {string[]} warnings
 */

export {};
