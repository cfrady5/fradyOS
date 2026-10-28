"use client";

import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSimulation } from "@/lib/particles/simulation";
import { FpsMonitor } from "@/lib/particles/performance";
import type { LabController } from "@/lib/particles/transitions";

interface Props {
  count: number;
  halfFloat: boolean;
  reducedMotion: boolean;
  mobile: boolean;
  controller: LabController;
  /** Called when the frame rate stays low; the host may lower the particle count. */
  onLowFps: () => void;
}

const PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/**
 * Lives inside the R3F canvas. Owns one ParticleSimulation for its lifetime, feeds it pointer input in
 * the formation's local space, rotates volume formations on drag (with inertia) and slowly on their
 * own, and offsets the camera with the cursor for depth parallax. No React state changes per frame.
 */
export function ParticleSystem({ count, halfFloat, reducedMotion, mobile, controller, onLowFps }: Props) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const pointer = useThree((s) => s.pointer);
  const [sim] = useState(() => new ParticleSimulation(gl, { count, halfFloat, reducedMotion, pointSize: mobile ? 2.4 : 2.1, pixelRatio: gl.getPixelRatio() }));
  const group = useRef<THREE.Group>(null);
  const drag = useRef({ active: false, moved: false, x: 0, y: 0, vx: 0, vy: 0, downX: 0, downY: 0, inside: false });
  const spinRef = useRef({ y: 0, x: 0 });
  // Frame-rate monitor: the first low reading halves the drawn particles without a rebuild; later
  // ones hand off to the host, which lowers the count. The latest callback is read through a ref.
  const onLowRef = useRef(onLowFps);
  useEffect(() => {
    onLowRef.current = onLowFps;
  }, [onLowFps]);
  const degraded = useRef(0);
  const monitor = useRef<FpsMonitor | null>(null);
  useEffect(() => {
    monitor.current = new FpsMonitor(() => {
      degraded.current++;
      if (degraded.current === 1) sim.setVisibleFraction(0.5);
      else onLowRef.current();
    });
    return () => {
      monitor.current = null;
    };
  }, [sim]);
  const tmp = useRef({ ray: new THREE.Raycaster(), world: new THREE.Vector3(), local: new THREE.Vector3(), ndc: new THREE.Vector2(), camGoal: new THREE.Vector3(0, 0, 3.2) });

  // Attach to the controller once; dispose GPU resources on unmount.
  useEffect(() => {
    controller.attach(sim);
    return () => {
      controller.detach();
      sim.dispose();
    };
  }, [controller, sim]);

  // Pointer input straight from the canvas element (passive, so scrolling elsewhere is untouched).
  useEffect(() => {
    const el = gl.domElement;
    const d = drag.current;
    const toLocal = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const t = tmp.current;
      t.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      t.ray.setFromCamera(t.ndc, camera);
      if (!t.ray.ray.intersectPlane(PLANE, t.world)) return null;
      return group.current ? group.current.worldToLocal(t.local.copy(t.world)) : t.local.copy(t.world);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      d.active = true;
      d.moved = false;
      d.x = d.downX = e.clientX;
      d.y = d.downY = e.clientY;
      d.vx = d.vy = 0;
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      d.inside = true;
      const local = toLocal(e.clientX, e.clientY);
      sim.setPointer(local);
      if (!d.active) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      if (Math.hypot(e.clientX - d.downX, e.clientY - d.downY) > 6) d.moved = true;
      if (d.moved && controller.getState().depth === "volume") {
        d.vx = dx * 0.006;
        d.vy = dy * 0.006;
        spinRef.current.y += d.vx;
        spinRef.current.x += d.vy;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!d.active) return;
      d.active = false;
      if (!d.moved) {
        const local = toLocal(e.clientX, e.clientY);
        if (local) sim.impulse(local);
      }
      if (e.pointerType !== "mouse") {
        d.inside = false;
        sim.setPointer(null);
      }
    };
    const onLeave = () => {
      d.inside = false;
      sim.setPointer(null);
    };
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onUp, { passive: true });
    el.addEventListener("pointerleave", onLeave, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [gl, camera, sim, controller]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const g = group.current;
    const d = drag.current;
    const depth = controller.getState().depth;
    // Orbit: drag inertia plus a slow auto spin for volume forms; flat forms ease back to face the camera.
    if (g) {
      if (depth === "volume") {
        if (!d.active) {
          d.vx *= 0.92;
          d.vy *= 0.92;
          spinRef.current.y += d.vx + (reducedMotion ? 0 : sim.motion.spin * 0.12 * dt);
          spinRef.current.x += d.vy;
        }
        spinRef.current.x = THREE.MathUtils.clamp(spinRef.current.x, -1.2, 1.2);
      } else {
        spinRef.current.y *= 0.9;
        spinRef.current.x *= 0.9;
      }
      g.rotation.set(spinRef.current.x, spinRef.current.y, 0);
    }
    // Parallax: the camera leans a little toward the cursor, so near and far particles slide apart.
    const goal = tmp.current.camGoal;
    if (!reducedMotion && d.inside) goal.set(pointer.x * 0.16, pointer.y * 0.1, 3.2);
    else goal.set(0, 0, 3.2);
    camera.position.lerp(goal, 1 - Math.pow(0.001, dt));
    camera.lookAt(0, 0, 0);

    sim.step(dt);
    monitor.current?.sample(dt);
  });

  return (
    <group ref={group}>
      <primitive object={sim.points} />
    </group>
  );
}
