/**
 * Builds `client/src/assets/galaxy.svg` — the spinning galaxy behind the app.
 *
 *   node scripts/make-galaxy.js
 *
 * Geometry rather than freehand: each arm is a logarithmic spiral (radius grows
 * exponentially with angle), sampled as a polyline and stroked four times at
 * decreasing width, which is what makes an arm taper as it sweeps outward. A
 * radial gradient gives the core a glow instead of a hard edge, and stars are
 * scattered along and around the arms.
 *
 * Colours are CSS variables (--galaxy-*), so one file serves both themes.
 */
const fs = require('fs');
const path = require('path');

/* Deterministic: same artwork every run. */
let seed = 11;
function random() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const uniform = (lo, hi) => lo + random() * (hi - lo);
const gauss = (mean, sd) => {
  const u = Math.max(1e-9, random());
  const v = random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const SIZE = 1000;
const C = SIZE / 2;
const R0 = 30;        // radius where an arm leaves the core
const R1 = 450;       // radius at the rim
const TURNS = 0.8;    // how far the arms wrap around the core

const logRadius = (t) => R0 * (R1 / R0) ** t;

/** Sample one arm: [x, y, t, radius, angle] from the core outward. */
function spiral(offset, { samples = 300, reach = 1 } = {}) {
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    const t = (i / (samples - 1)) * reach;
    const theta = offset + t * TURNS * 2 * Math.PI;
    const r = logRadius(t);
    points.push([C + r * Math.cos(theta), C + r * Math.sin(theta), t, r, theta]);
  }
  return points;
}

const polyline = (points, upto = 1) => {
  const slice = points.slice(0, Math.max(2, Math.round(points.length * upto)));
  return `M${slice.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join('')}`;
};

/** Stars along and around an arm, thinning as it reaches the rim. */
function starsAlong(points, perPoint, { jitter, angleJitter, min, max, alpha, rim }) {
  const out = [];
  for (const [, , t, r, theta] of points) {
    for (let i = 0; i < perPoint; i += 1) {
      const rr = r + gauss(0, jitter * (1 - t) + 8);
      const tt = theta + gauss(0, angleJitter);
      const x = C + rr * Math.cos(tt);
      const y = C + rr * Math.sin(tt);
      if ((x - C) ** 2 + (y - C) ** 2 > rim ** 2) continue;
      out.push([x, y, uniform(min, max), uniform(alpha[0], alpha[1])]);
    }
  }
  return out;
}

const arms = [spiral(0, { reach: 0.98 }), spiral(Math.PI, { reach: 0.98 })];
const spurs = [spiral(Math.PI / 2, { samples: 220, reach: 0.72 }), spiral(1.5 * Math.PI, { samples: 220, reach: 0.72 })];

const stars = [
  ...starsAlong(arms[0], 1, { jitter: 36, angleJitter: 0.13, min: 0.45, max: 1.8, alpha: [0.22, 0.8], rim: R1 * 1.02 }),
  ...starsAlong(arms[1], 1, { jitter: 36, angleJitter: 0.13, min: 0.45, max: 1.8, alpha: [0.22, 0.8], rim: R1 * 1.02 }),
  ...starsAlong(spurs[0].filter((_, i) => i % 4 === 0), 1, { jitter: 26, angleJitter: 0.18, min: 0.4, max: 1.3, alpha: [0.14, 0.5], rim: R1 * 0.95 }),
  ...starsAlong(spurs[1].filter((_, i) => i % 4 === 0), 1, { jitter: 26, angleJitter: 0.18, min: 0.4, max: 1.3, alpha: [0.14, 0.5], rim: R1 * 0.95 }),
];

// halo and background field, thinning outward
for (let i = 0; i < 54; i += 1) {
  const theta = uniform(0, 2 * Math.PI);
  const r = R0 + (R1 * 1.12 - R0) * Math.sqrt(random());
  const x = C + r * Math.cos(theta);
  const y = C + r * Math.sin(theta);
  if ((x - C) ** 2 + (y - C) ** 2 > (R1 * 1.15) ** 2) continue;
  stars.push([x, y, uniform(0.4, 1.1), uniform(0.08, 0.35)]);
}
stars.sort((a, b) => a[2] - b[2]);

/** One arm: four passes of the same curve, wide and faint under tight and bright. */
function armPaths(points) {
  return [
    `<path d="${polyline(points, 0.58)}" stroke="var(--galaxy-arm)" stroke-width="54" stroke-linecap="round" fill="none" stroke-opacity="0.10"/>`,
    `<path d="${polyline(points, 0.80)}" stroke="var(--galaxy-arm)" stroke-width="30" stroke-linecap="round" fill="none" stroke-opacity="0.17"/>`,
    `<path d="${polyline(points)}" stroke="var(--galaxy-bright)" stroke-width="13" stroke-linecap="round" fill="none" stroke-opacity="0.22"/>`,
    `<path d="${polyline(points)}" stroke="var(--galaxy-bright)" stroke-width="4" stroke-linecap="round" fill="none" stroke-opacity="0.20"/>`,
  ].join('\n');
}

/* XML comments cannot contain a double hyphen, so the variable names are spelled out. */
const svg = `<!--
  Spiral galaxy - generated artwork, not hand-edited.

  Two logarithmic-spiral arms plus two shorter spurs, each stroked four times at
  decreasing width so the arm tapers as it sweeps outward, a radial-gradient core
  and about 760 stars scattered along and around the arms. Colours come from the
  galaxy tokens in theme.css, so the same file serves both themes.

  Regenerate with: node scripts/make-galaxy.js
-->
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<defs>
<radialGradient id="galaxy-core">
<stop offset="0%" stop-color="var(--galaxy-bright)" stop-opacity="0.42"/>
<stop offset="24%" stop-color="var(--galaxy-core)" stop-opacity="0.24"/>
<stop offset="58%" stop-color="var(--galaxy-core)" stop-opacity="0.09"/>
<stop offset="100%" stop-color="var(--galaxy-core)" stop-opacity="0"/>
</radialGradient>
<radialGradient id="galaxy-haze">
<stop offset="0%" stop-color="var(--galaxy-arm)" stop-opacity="0.10"/>
<stop offset="70%" stop-color="var(--galaxy-arm)" stop-opacity="0.04"/>
<stop offset="100%" stop-color="var(--galaxy-arm)" stop-opacity="0"/>
</radialGradient>
</defs>
<ellipse cx="${C}" cy="${C}" rx="${(R1 * 1.05).toFixed(0)}" ry="${(R1 * 0.82).toFixed(0)}" fill="url(#galaxy-haze)" transform="rotate(-18 ${C} ${C})"/>
<g class="galaxy__arms">
${arms.map(armPaths).join('\n')}
${spurs.map((p) => `<path d="${polyline(p)}" stroke="var(--galaxy-arm)" stroke-width="17" stroke-linecap="round" fill="none" stroke-opacity="0.09"/>`).join('\n')}
</g>
<g class="galaxy__core">
<circle cx="${C}" cy="${C}" r="230" fill="url(#galaxy-core)"/>
<circle cx="${C}" cy="${C}" r="9" fill="var(--galaxy-bright)" fill-opacity="0.5"/>
</g>
<g class="galaxy__stars">
${stars.map(([x, y, r, o]) => `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(2)}" fill="var(--galaxy-star)" fill-opacity="${Math.min(1, o * 1.15).toFixed(2)}"/>`).join('\n')}
</g>
</svg>`;

const target = path.join(__dirname, '..', 'client', 'src', 'assets', 'galaxy.svg');
fs.writeFileSync(target, svg);
console.log(`galaxy written → ${path.relative(process.cwd(), target)}`);
console.log(`  ${(svg.length / 1024).toFixed(1)} KB · ${stars.length} stars · ${arms.length} arms + ${spurs.length} spurs`);
