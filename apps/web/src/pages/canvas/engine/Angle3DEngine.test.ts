import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';

// Mock WebGLRenderer — jsdom has no WebGL context
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  return {
    ...actual,
    WebGLRenderer: class MockWebGLRenderer {
      domElement = document.createElement('canvas');
      outputColorSpace = '';
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
      setRenderTarget() {}
      readRenderTargetPixels() {
        return new Uint8Array();
      }
    },
  };
});

// Mock OrbitControls
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class MockOrbitControls {
    enabled = true;
    enableDamping = false;
    dampingFactor = 0;
    enableRotate = true;
    enableZoom = true;
    enablePan = true;
    minDistance = 0;
    maxDistance = Infinity;
    minPolarAngle = 0;
    maxPolarAngle = Math.PI;
    minAzimuthAngle = -Infinity;
    maxAzimuthAngle = Infinity;
    target = {
      set() {},
      clone() {
        return { equals() {
          return true;
        } };
      },
      distanceToSquared() {
        return 0;
      },
    };
    update() {}
    dispose() {}
    saveState() {}
    reset() {}
    addEventListener() {}
    removeEventListener() {}
  },
}));

import { Angle3DEngine } from './Angle3DEngine';

const engines: Angle3DEngine[] = [];
afterEach(() => {
  engines.forEach((e) => e.dispose());
  engines.length = 0;
});
function createEngine(container: HTMLDivElement, url = 'https://example.com/test.jpg') {
  const engine = new Angle3DEngine(container, url);
  engines.push(engine);
  return engine;
}

describe('Angle3DEngine', () => {
  it('module should export Angle3DEngine class', () => {
    expect(Angle3DEngine).toBeDefined();
    expect(typeof Angle3DEngine).toBe('function');
  });

  describe('scene initialization', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should create perspective camera', () => {
      const engine = createEngine(container);

      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      expect(cam).toBeDefined();
      expect(cam).toBeInstanceOf(THREE.PerspectiveCamera);
    });

    it('should set scene background to dark blue', () => {
      const engine = createEngine(container);

      const scene = (engine as any).scene as THREE.Scene;
      expect(scene.background).toBeDefined();
      expect((scene.background as THREE.Color).getHex()).toBe(0x0a0e1a);
    });

    it('should use perspectiveCamera as activeCamera', () => {
      const engine = createEngine(container);

      const active = (engine as any).activeCamera;
      const persp = (engine as any).perspectiveCamera;
      expect(active).toBe(persp);
    });

    it('should NOT create orthographic camera', () => {
      const engine = createEngine(container);

      expect((engine as any).orthographicCamera).toBeUndefined();
    });
  });

  describe('image plane', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should create placeholder plane on init (before texture loads)', () => {
      const engine = createEngine(container);

      const plane = (engine as any).imagePlane as THREE.Mesh;
      expect(plane).toBeDefined();
      expect(plane).toBeInstanceOf(THREE.Mesh);
      expect(plane.geometry).toBeInstanceOf(THREE.PlaneGeometry);
    });

    it('should use MeshBasicMaterial (not MeshStandardMaterial) for placeholder', () => {
      const engine = createEngine(container);

      const plane = (engine as any).imagePlane as THREE.Mesh;
      const mat = plane.material as THREE.MeshBasicMaterial;
      expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    });

    it('should have transparent:true and depthWrite:true on material', () => {
      const engine = createEngine(container);

      const plane = (engine as any).imagePlane as THREE.Mesh;
      const mat = plane.material as THREE.MeshBasicMaterial;
      expect(mat.transparent).toBe(true);
      expect(mat.depthWrite).toBe(true);
    });

    it('should place image plane at origin with correct orientation', () => {
      const engine = createEngine(container);

      const plane = (engine as any).imagePlane as THREE.Mesh;
      expect(plane.position.x).toBe(0);
      expect(plane.position.y).toBe(0);
      expect(plane.position.z).toBe(0);
    });
  });

  describe('ground grid', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should create xzGridHelper', () => {
      const engine = createEngine(container);

      expect((engine as any).xzGridHelper).toBeDefined();
      expect((engine as any).xzGridHelper).toBeInstanceOf(THREE.GridHelper);
    });

    it('should place grid at Y=-1 (aligned with bottom of image)', () => {
      const engine = createEngine(container);

      const grid = (engine as any).xzGridHelper as THREE.GridHelper;
      expect(grid.position.y).toBe(-1);
    });

    it('should have no rotation on grid (XZ plane)', () => {
      const engine = createEngine(container);

      const grid = (engine as any).xzGridHelper as THREE.GridHelper;
      expect(grid.rotation.x).toBe(0);
    });

    it('should use 10x10 size with 10 divisions', () => {
      const engine = createEngine(container);

      const grid = (engine as any).xzGridHelper as THREE.GridHelper;
      // GridHelper constructor args: size, divisions, colorCenter, colorGrid
      expect(grid).toBeDefined();
    });

    it('should NOT create xyGridHelper (no front view mode)', () => {
      const engine = createEngine(container);

      expect((engine as any).xyGridHelper).toBeUndefined();
    });
  });

  describe('orbit controls', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should enable damping', () => {
      const engine = createEngine(container);

      const c = (engine as any).orbitControls;
      expect(c.enableDamping).toBe(true);
    });

    it('should disable pan (prevent camera drift from spherical coords)', () => {
      const engine = createEngine(container);

      expect((engine as any).orbitControls.enablePan).toBe(false);
    });

    it('should set polar angle limits for verticalAngle ±60°', () => {
      const engine = createEngine(container);

      const c = (engine as any).orbitControls;
      // minPolarAngle = π/2 - degToRad(60) = π/6
      // maxPolarAngle = π/2 - degToRad(-60) = 5π/6
      expect(c.minPolarAngle).toBeCloseTo(Math.PI / 6);
      expect(c.maxPolarAngle).toBeCloseTo((5 * Math.PI) / 6);
    });

    it('should set azimuth angle limits for horizontalAngle ±90°', () => {
      const engine = createEngine(container);

      const c = (engine as any).orbitControls;
      expect(c.minAzimuthAngle).toBeCloseTo(-Math.PI / 2);
      expect(c.maxAzimuthAngle).toBeCloseTo(Math.PI / 2);
    });

    it('should set target to origin', () => {
      const engine = createEngine(container);

      expect((engine as any).orbitControls).toBeDefined();
    });
  });

  describe('spherical coordinate calculation — forward', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should set camera to correct position for default params (0,0,5)', () => {
      const engine = createEngine(container);

      // r = 5 * (1 - 5/20) = 5 * 0.75 = 3.75
      // camera at (0, 0, 3.75) looking at origin
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      expect(cam.position.x).toBeCloseTo(0);
      expect(cam.position.y).toBeCloseTo(0);
      expect(cam.position.z).toBeCloseTo(3.75);
    });

    it('should compute camera position for horizontalAngle=90, verticalAngle=0, zoom=5', () => {
      const engine = createEngine(container);
      engine.setParams(90, 0, 5);

      // α=90°=π/2, β=0, r=3.75
      // x = 3.75 * sin(π/2) * cos(0) = 3.75
      // y = 3.75 * sin(0) = 0
      // z = 3.75 * cos(π/2) * cos(0) = 0
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      expect(cam.position.x).toBeCloseTo(3.75);
      expect(cam.position.y).toBeCloseTo(0);
      expect(cam.position.z).toBeCloseTo(0);
    });

    it('should compute camera position for horizontalAngle=0, verticalAngle=60, zoom=5', () => {
      const engine = createEngine(container);
      engine.setParams(0, 60, 5);

      // α=0, β=60°=π/3, r=3.75
      // x = 3.75 * sin(0) * cos(π/3) = 0
      // y = 3.75 * sin(π/3) = 3.75 * √3/2 ≈ 3.248
      // z = 3.75 * cos(0) * cos(π/3) = 3.75 * 0.5 = 1.875
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      expect(cam.position.x).toBeCloseTo(0);
      expect(cam.position.y).toBeCloseTo(3.247, 2);
      expect(cam.position.z).toBeCloseTo(1.875, 2);
    });

    it('should compute camera position for horizontalAngle=-90, verticalAngle=-30, zoom=5', () => {
      const engine = createEngine(container);
      engine.setParams(-90, -30, 5);

      // α=-90°=-π/2, β=-30°=-π/6, r=3.75
      // x = 3.75 * sin(-π/2) * cos(-π/6) = 3.75 * (-1) * 0.866 ≈ -3.247
      // y = 3.75 * sin(-π/6) = 3.75 * (-0.5) = -1.875
      // z = 3.75 * cos(-π/2) * cos(-π/6) = 3.75 * 0 * 0.866 = 0
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      expect(cam.position.x).toBeCloseTo(-3.247, 2);
      expect(cam.position.y).toBeCloseTo(-1.875, 2);
      expect(cam.position.z).toBeCloseTo(0);
    });
  });

  describe('spherical coordinate calculation — reverse (from camera to params)', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should reverse-calculate params from camera position at default', () => {
      const engine = createEngine(container);
      engine.setParams(0, 0, 5);

      const result = (engine as any).getParamsFromCamera();
      expect(result.horizontalAngle).toBeCloseTo(0);
      expect(result.verticalAngle).toBeCloseTo(0);
      expect(result.zoom).toBeCloseTo(5);
    });

    it('should reverse-calculate after setParams(45, 30, 3)', () => {
      const engine = createEngine(container);
      engine.setParams(45, 30, 3);

      const result = (engine as any).getParamsFromCamera();
      expect(result.horizontalAngle).toBeCloseTo(45);
      expect(result.verticalAngle).toBeCloseTo(30);
      expect(result.zoom).toBeCloseTo(3);
    });

    it('should clamp horizontalAngle to ±90 when camera goes beyond', () => {
      const engine = createEngine(container);
      // Force camera position to an extreme that would give >90°
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      cam.position.set(-5, 0, -1);
      (engine as any).orbitControls.target.set(0, 0, 0);

      const result = (engine as any).getParamsFromCamera();
      // atan2(-5, -1) ≈ -101.3°, should clamp to -90
      expect(result.horizontalAngle).toBe(-90);
    });

    it('should clamp zoom to 0 when camera is far', () => {
      const engine = createEngine(container);
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      cam.position.set(0, 0, 10); // r=10 → zoom = 20*(1-10/5) = -20, clamp to 0
      (engine as any).orbitControls.target.set(0, 0, 0);

      const result = (engine as any).getParamsFromCamera();
      expect(result.zoom).toBe(0);
    });

    it('should clamp zoom to 10 when camera is very close', () => {
      const engine = createEngine(container);
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      cam.position.set(0, 0, 1); // r=1 → zoom = 20*(1-1/5) = 16, clamp to 10
      (engine as any).orbitControls.target.set(0, 0, 0);

      const result = (engine as any).getParamsFromCamera();
      expect(result.zoom).toBe(10);
    });
  });

  describe('zoom mapping', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should place camera at distance 5 when zoom=0 (farthest)', () => {
      const engine = createEngine(container);
      engine.setParams(0, 0, 0);

      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      const dist = cam.position.length();
      expect(dist).toBeCloseTo(5);
    });

    it('should place camera at distance 2.5 when zoom=10 (closest)', () => {
      const engine = createEngine(container);
      engine.setParams(0, 0, 10);

      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      const dist = cam.position.length();
      expect(dist).toBeCloseTo(2.5);
    });
  });

  describe('reset', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should reset camera to default position (0,0,5)', () => {
      const engine = createEngine(container);
      engine.setParams(45, 30, 3);
      engine.reset();

      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      const dist = cam.position.length();
      expect(cam.position.x).toBeCloseTo(0);
      expect(cam.position.y).toBeCloseTo(0);
      expect(dist).toBeCloseTo(3.75);
    });

    it('should reset orbit controls target to origin', () => {
      const engine = createEngine(container);
      engine.setParams(90, 60, 0);
      engine.reset();

      const dirty = (engine as any).dirty;
      expect(dirty).toBe(true);
    });
  });

  describe('dispose', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should dispose image plane geometry and material', () => {
      const engine = createEngine(container);
      const plane = (engine as any).imagePlane as THREE.Mesh;
      const geoSpy = vi.spyOn(plane.geometry, 'dispose');
      const matSpy = vi.spyOn(plane.material as THREE.Material, 'dispose');

      engine.dispose();

      expect(geoSpy).toHaveBeenCalled();
      expect(matSpy).toHaveBeenCalled();
    });

    it('should dispose grid geometry and material', () => {
      const engine = createEngine(container);
      const grid = (engine as any).xzGridHelper as THREE.GridHelper;
      const geoSpy = vi.spyOn(grid.geometry, 'dispose');
      const matSpy = vi.spyOn(grid.material as THREE.Material, 'dispose');

      engine.dispose();

      expect(geoSpy).toHaveBeenCalled();
      expect(matSpy).toHaveBeenCalled();
    });

    it('should set disposed flag to prevent further rendering', () => {
      const engine = createEngine(container);
      engine.dispose();

      expect((engine as any).disposed).toBe(true);
    });

    it('should not throw on double dispose', () => {
      const engine = createEngine(container);
      engine.dispose();
      expect(() => engine.dispose()).not.toThrow();
    });
  });

  describe('dirty flag', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should set dirty=true after setParams call', () => {
      const engine = createEngine(container);
      (engine as any).dirty = false;
      engine.setParams(45, 0, 5);

      expect((engine as any).dirty).toBe(true);
    });

    it('should set dirty=true after setHorizontalAngle', () => {
      const engine = createEngine(container);
      (engine as any).dirty = false;
      engine.setHorizontalAngle(45);

      expect((engine as any).dirty).toBe(true);
    });

    it('should set dirty=true after setVerticalAngle', () => {
      const engine = createEngine(container);
      (engine as any).dirty = false;
      engine.setVerticalAngle(30);

      expect((engine as any).dirty).toBe(true);
    });

    it('should set dirty=true after setZoom', () => {
      const engine = createEngine(container);
      (engine as any).dirty = false;
      engine.setZoom(3);

      expect((engine as any).dirty).toBe(true);
    });

    it('should set dirty=true after applyPreset', () => {
      const engine = createEngine(container);
      (engine as any).dirty = false;
      engine.applyPreset('fisheye' as any);

      expect((engine as any).dirty).toBe(true);
    });

    it('should set dirty=true on resize', () => {
      const engine = createEngine(container);
      (engine as any).dirty = false;
      (engine as any).onResize();

      expect((engine as any).dirty).toBe(true);
    });
  });

  describe('parameter setters', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      Object.defineProperty(container, 'clientWidth', { value: 800, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 600, configurable: true });
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should clamp horizontalAngle to [-90, 90] on setHorizontalAngle', () => {
      const engine = createEngine(container);
      engine.setHorizontalAngle(100);

      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      // Should be clamped to 90
      expect((engine as any).currentParams.horizontalAngle).toBe(90);
    });

    it('should clamp verticalAngle to [-60, 60] on setVerticalAngle', () => {
      const engine = createEngine(container);
      engine.setVerticalAngle(-70);

      expect((engine as any).currentParams.verticalAngle).toBe(-60);
    });

    it('should clamp zoom to [0, 10] on setZoom', () => {
      const engine = createEngine(container);
      engine.setZoom(15);

      expect((engine as any).currentParams.zoom).toBe(10);
    });
  });
});
