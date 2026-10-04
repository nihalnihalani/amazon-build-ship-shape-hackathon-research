/**
 * Number matching for join confirmation (A3-06). The relay sends two digits that the phone also shows. The
 * TV offers three two-digit choices: the real digits and two distinct decoys, in a shuffled order. Decoys are
 * not secret; they only have to differ from the real digits and from each other. Draws are uniform (rejection
 * sampling, no modulo bias).
 */

export type RandomBytes = (n: number) => Uint8Array;

/** Uniform integer in [0, n) from random bytes; null if the source runs dry (a degenerate test source). */
function uniformBelow(n: number, bytes: Iterator<number>): number | null {
  const limit = 256 - (256 % n);
  for (let i = 0; i < 64; i += 1) {
    const next = bytes.next();
    if (next.done) return null;
    if (next.value < limit) return next.value % n;
  }
  return null;
}

function* byteStream(random: RandomBytes): Generator<number> {
  for (let round = 0; round < 8; round += 1) {
    const chunk = random(32);
    for (let i = 0; i < chunk.length; i += 1) yield chunk[i] as number;
  }
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

export function buildChoices(realDigits: string, random: RandomBytes): [string, string, string] {
  const stream = byteStream(random);
  const taken = new Set<string>([realDigits]);
  const decoys: string[] = [];
  while (decoys.length < 2) {
    const draw = uniformBelow(100, stream);
    if (draw === null) break;
    const candidate = pad2(draw);
    if (taken.has(candidate)) continue;
    taken.add(candidate);
    decoys.push(candidate);
  }
  // Degenerate randomness (cannot happen with a real source): fall back to fixed distinct offsets.
  const real = Number(realDigits);
  for (let step = 11; decoys.length < 2; step += 12) {
    const candidate = pad2((real + step) % 100);
    if (!taken.has(candidate)) {
      taken.add(candidate);
      decoys.push(candidate);
    }
  }
  const all = [realDigits, decoys[0] as string, decoys[1] as string];
  // Fisher-Yates with unbiased indices.
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = uniformBelow(i + 1, stream) ?? i;
    const tmp = all[i] as string;
    all[i] = all[j] as string;
    all[j] = tmp;
  }
  return [all[0] as string, all[1] as string, all[2] as string];
}
