interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Convert color temperature in Kelvin to RGB values (0-1 range).
 * Uses a blackbody radiation approximation valid for 2000K - 10000K.
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const k = Math.max(2000, Math.min(10000, kelvin)) / 100;

  let r: number;
  let g: number;
  let b: number;

  if (k <= 66) {
    r = 1;
    g = (99.4708025861 * Math.log(k) - 161.1195681661) / 255;
    if (k <= 19) {
      b = 0;
    } else {
      b = (138.5177312231 * Math.log(k - 10) - 305.0447927307) / 255;
    }
  } else {
    r = (329.698727446 * Math.pow(k - 60, -0.1332047592)) / 255;
    g = (288.1221695283 * Math.pow(k - 60, -0.0755148492)) / 255;
    b = 1;
  }

  return {
    r: Math.max(0, Math.min(1, r)),
    g: Math.max(0, Math.min(1, g)),
    b: Math.max(0, Math.min(1, b)),
  };
}
