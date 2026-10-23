// Deterministic colour maths shared by the verify gates (G3 contrast, G4
// tokens). Pure, synchronous and network-free: the same input always yields the
// same answer.

type RGB = [number, number, number];

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Parse #rgb/#rrggbb, rgb()/rgba() and named white/black. Returns null otherwise. */
export function parseColor(input: string): RGB | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  if (value === 'white') return [255, 255, 255];
  if (value === 'black') return [0, 0, 0];

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  const rgb = /^rgba?\(\s*([^)]+)\s*\)$/i.exec(value);
  if (rgb) {
    const parts = rgb[1]!.split(',').map((p) => p.trim());
    if (parts.length < 3) return null;
    const nums = parts.slice(0, 3).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    if (nums.some((n) => Number.isNaN(n))) return null;
    return [clampChannel(nums[0]!), clampChannel(nums[1]!), clampChannel(nums[2]!)];
  }

  return null;
}

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: RGB): number {
  const chan = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/**
 * Contrast ratio (L1 + 0.05) / (L2 + 0.05), rounded to two decimals.
 * Returns null when either colour cannot be parsed.
 */
export function contrastRatio(fg: string, bg: string): number | null {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
