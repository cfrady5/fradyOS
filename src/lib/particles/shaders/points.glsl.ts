/** Render pass: one tiny luminous point per particle, sized by depth and seed, coloured by the palette or the image. */
export const POINTS_VERTEX = /* glsl */ `
attribute vec2 ref;
uniform sampler2D uPositions;
uniform sampler2D uVelocities;
uniform sampler2D uTarget;
uniform sampler2D uColors;
uniform float uPointSize;
uniform float uPixelRatio;
uniform float uVisible;
varying float vSeed;
varying float vSpeed;
varying float vEmphasis;
varying vec4 vColor;
varying float vHidden;

void main() {
  vec4 p = texture2D(uPositions, ref);
  vec3 vel = texture2D(uVelocities, ref).xyz;
  vec4 t = texture2D(uTarget, ref);
  vSeed = p.w;
  vSpeed = length(vel);
  vEmphasis = t.w;
  vColor = texture2D(uColors, ref);
  // Adaptive density: particles past the visible fraction collapse to nothing.
  float index = ref.y + ref.x * 0.0009765625;
  vHidden = step(uVisible, index);
  vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uPointSize * (0.55 + 0.9 * vSeed) * (0.8 + 0.5 * vEmphasis);
  gl_PointSize = size * uPixelRatio * (3.2 / max(0.5, -mv.z)) * (1.0 - vHidden);
}
`;

export const POINTS_FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uAccent;
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uTime;
uniform float uTwinkle;
varying float vSeed;
varying float vSpeed;
varying float vEmphasis;
varying vec4 vColor;
varying float vHidden;

void main() {
  if (vHidden > 0.5) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float alpha = smoothstep(1.0, 0.25, d);
  // Base: secondary grey toward primary ink by emphasis and seed, tinted by the palette.
  vec3 col = mix(uSecondary, uPrimary, clamp(vEmphasis * 0.75 + vSeed * 0.35, 0.0, 1.0));
  col = mix(col, uTint, uTintAmount * (0.35 + 0.65 * vSeed));
  // Image colour, when a silhouette carried one, keeps a little of the site tone.
  col = mix(col, vColor.rgb, vColor.a * 0.8);
  // Motion reads as the accent: moving particles glow lichen, settled ones rest in ink.
  col = mix(col, uAccent, smoothstep(0.25, 1.6, vSpeed));
  float twinkle = 1.0 - uTwinkle * 0.35 * (0.5 + 0.5 * sin(uTime * (1.3 + vSeed * 2.0) + vSeed * 31.0));
  alpha *= (0.55 + 0.45 * vEmphasis) * twinkle;
  gl_FragColor = vec4(col, alpha);
}
`;
