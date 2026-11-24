// ============================================================================
// treelet.js - Solar position
//
// The sun's azimuth and altitude for an instant and a place, after the NOAA
// solar calculator (Meeus' low-precision formulas: about 0.01° between 1800
// and 2100), with the NOAA atmospheric refraction correction.
// ============================================================================

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon, corrected for refraction. */
  altitude: number;
  /** Solar declination in degrees. */
  declination: number;
  /** Equation of time in minutes (apparent minus mean solar time). */
  equationOfTime: number;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Atmospheric refraction in degrees for an unrefracted altitude (NOAA). */
export function refraction(altitude: number): number {
  if (altitude > 85) return 0;
  const t = Math.tan(altitude * RAD);
  let arcsec: number;
  if (altitude > 5) arcsec = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  else if (altitude > -0.575) arcsec = 1735 + altitude * (-518.2 + altitude * (103.4 + altitude * (-12.79 + altitude * 0.711)));
  else arcsec = -20.772 / t;
  return arcsec / 3600;
}

/** Position of the sun at `date` seen from (lng, lat) in degrees. */
export function sunPosition(date: Date, lng: number, lat: number): SunPosition {
  const ms = date.getTime();
  const jd = ms / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;

  const L0 = mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360);
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(M * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(eps * RAD) * Math.sin(appLong * RAD)) * DEG;

  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot = 4 * DEG * (
    y * Math.sin(2 * L0 * RAD) -
    2 * e * Math.sin(M * RAD) +
    4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
    0.5 * y * y * Math.sin(4 * L0 * RAD) -
    1.25 * e * e * Math.sin(2 * M * RAD)
  );

  const utcMinutes = mod(ms, 86400000) / 60000;
  const trueSolar = mod(utcMinutes + eot + 4 * lng, 1440);
  const hourAngle = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;

  const latR = lat * RAD;
  const decR = declination * RAD;
  const cosZen = Math.max(-1, Math.min(1,
    Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(hourAngle * RAD)));
  const zenith = Math.acos(cosZen) * DEG;

  let azimuth: number;
  const denom = Math.cos(latR) * Math.sin(zenith * RAD);
  if (Math.abs(denom) < 1e-12) {
    azimuth = lat > 0 ? 180 : 0;
  } else {
    const cosAz = Math.max(-1, Math.min(1, (Math.sin(latR) * Math.cos(zenith * RAD) - Math.sin(decR)) / denom));
    const a = Math.acos(cosAz) * DEG;
    azimuth = hourAngle > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  }

  const geometric = 90 - zenith;
  return { azimuth, altitude: geometric + refraction(geometric), declination, equationOfTime: eot };
}

/**
 * Sun positions over one day, every `stepMinutes`, sampled at the middle
 * of each step. The day is the calendar day of `date` in the time zone
 * `utcOffset` hours from UTC; `hour` is the time of day there.
 */
export function sunPathOfDay(
  date: Date, lng: number, lat: number, stepMinutes: number, utcOffset: number,
): Array<{ hour: number; azimuth: number; altitude: number }> {
  const step = Math.max(1, stepMinutes);
  const offsetMs = utcOffset * 3600000;
  const local = new Date(date.getTime() + offsetMs);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs;
  const out: Array<{ hour: number; azimuth: number; altitude: number }> = [];
  for (let m = step / 2; m < 1440; m += step) {
    const p = sunPosition(new Date(midnight + m * 60000), lng, lat);
    out.push({ hour: m / 60, azimuth: p.azimuth, altitude: p.altitude });
  }
  return out;
}
