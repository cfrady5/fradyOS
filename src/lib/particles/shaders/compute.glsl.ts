import { NOISE_GLSL } from "./noise.glsl";

/**
 * GPUComputationRenderer passes. Each texel is one particle:
 *   texturePosition: xyz position, w = per-particle seed (0..1)
 *   textureVelocity: xyz velocity, w unused
 *   uTarget:         xyz home position, w = emphasis (contour points brighter)
 * The helper prepends `uniform vec2 resolution;` and the variable samplers; uv comes from gl_FragCoord.
 */
export const VELOCITY_SHADER = /* glsl */ `
${NOISE_GLSL}
uniform sampler2D uTarget;
uniform float uTime;
uniform float uDelta;
uniform float uSpring;
uniform float uDamping;
uniform float uNoiseAmp;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uIdleAmp;
uniform float uDisperse;
uniform float uPulse;
uniform vec3 uPointer;
uniform float uPointerActive;
uniform float uRepelRadius;
uniform float uRepelStrength;
uniform vec4 uImpulses[4];
uniform float uImpulseSpeed;
uniform float uImpulseWidth;
uniform float uImpulseStrength;
uniform float uMaxSpeed;
uniform float uContainRadius;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  vec4 t = texture2D(uTarget, uv);
  vec3 pos = p.xyz;
  vec3 vel = v.xyz;
  float seed = p.w;

  // Spring toward home. Each particle has its own stiffness so the arrival is staggered.
  vec3 home = t.xyz * (1.0 + uPulse * 0.04 * sin(uTime * 1.7 + seed * 6.2831));
  vec3 acc = (home - pos) * uSpring * (0.55 + 0.9 * seed);

  // Turbulence: curl noise, strong while loose, a whisper once formed.
  vec3 curl = curlNoise(pos * uNoiseScale + vec3(0.0, 0.0, uTime * uNoiseSpeed) + seed * 0.37);
  acc += curl * (uNoiseAmp + uIdleAmp * (0.4 + 0.6 * seed));

  // Dispersion burst: fly outward from the centre, scattered by noise.
  if (uDisperse > 0.0) {
    vec3 out_ = normalize(pos + vec3(seed - 0.5, fract(seed * 7.3) - 0.5, fract(seed * 13.1) - 0.5) * 0.3 + 1e-4);
    acc += out_ * uDisperse * (6.0 + 6.0 * seed) + curl * uDisperse * 4.0;
  }

  // Cursor repulsion (pointer is already in the formation's local space).
  if (uPointerActive > 0.5) {
    vec3 d = pos - uPointer;
    float dist = length(d);
    if (dist < uRepelRadius) {
      float f = 1.0 - dist / uRepelRadius;
      acc += (d / max(dist, 1e-3)) * f * f * uRepelStrength;
    }
  }

  // Click impulses: an expanding shell that pushes particles outward as it passes.
  for (int i = 0; i < 4; i++) {
    vec4 imp = uImpulses[i];
    float age = uTime - imp.w;
    if (imp.w > 0.0 && age >= 0.0 && age < 1.6) {
      vec3 d = pos - imp.xyz;
      float dist = length(d);
      float r = age * uImpulseSpeed;
      float band = 1.0 - min(1.0, abs(dist - r) / uImpulseWidth);
      float fade = 1.0 - age / 1.6;
      acc += (d / max(dist, 1e-3)) * band * band * fade * uImpulseStrength;
    }
  }

  // Soft wall: loose particles drift but never leave the view.
  float rad = length(pos);
  if (rad > uContainRadius) acc -= (pos / rad) * (rad - uContainRadius) * 8.0;

  vel = (vel + acc * uDelta) * uDamping;
  float speed = length(vel);
  if (speed > uMaxSpeed) vel *= uMaxSpeed / speed;
  gl_FragColor = vec4(vel, 1.0);
}
`;

export const POSITION_SHADER = /* glsl */ `
uniform float uDelta;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 p = texture2D(texturePosition, uv);
  vec4 v = texture2D(textureVelocity, uv);
  gl_FragColor = vec4(p.xyz + v.xyz * uDelta, p.w);
}
`;
