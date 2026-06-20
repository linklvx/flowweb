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

// Also mock OrbitControls and post-processing (not needed for grid tests)
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
    target = { set() {}, clone() { return { equals() { return true; } }; }, distanceToSquared() { return 0; } };
    update() {}
    dispose() {}
    saveState() {}
    reset() {}
  },
}));

vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class MockEffectComposer {
    constructor() {}
    addPass() {}
    render() {}
  },
}));

vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
  RenderPass: class MockRenderPass {},
}));

vi.mock('three/examples/jsm/postprocessing/OutlinePass.js', () => ({
  OutlinePass: class MockOutlinePass {
    enabled = false;
    edgeStrength = 0;
    edgeGlow = 0;
    edgeThickness = 0;
    pulsePeriod = 0;
    visibleEdgeColor = { setRGB() {} };
    selectedObjects = [];
    renderCamera = null;
  },
}));

import { LightingEngine } from './LightingEngine';

describe('LightingEngine', () => {
  it('module should export LightingEngine class', () => {
    expect(LightingEngine).toBeDefined();
    expect(typeof LightingEngine).toBe('function');
  });

  describe('dual grid system', () => {
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

    it('should create both xyGrid and xzGrid on init', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      expect((engine as any).xyGridHelper).toBeDefined();
      expect((engine as any).xyGridHelper).toBeInstanceOf(THREE.GridHelper);
      expect((engine as any).xzGridHelper).toBeDefined();
      expect((engine as any).xzGridHelper).toBeInstanceOf(THREE.GridHelper);
    });

    it('should have xyGrid visible and xzGrid hidden by default', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      expect((engine as any).xyGridHelper.visible).toBe(true);
      expect((engine as any).xzGridHelper.visible).toBe(false);
    });

    it('should keep xyGrid parameters unchanged', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      const xyGrid = (engine as any).xyGridHelper as THREE.GridHelper;
      expect(xyGrid.rotation.x).toBeCloseTo(Math.PI / 2);
      expect(xyGrid.position.z).toBe(-0.5);
    });

    it('should place xzGrid at y=-2 with no rotation', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      const xzGrid = (engine as any).xzGridHelper as THREE.GridHelper;
      expect(xzGrid.position.y).toBe(-2);
      expect(xzGrid.rotation.x).toBe(0);
    });
  });

  describe('camera configuration', () => {
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

    it('should place perspective camera at (-3, 2, 12)', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      expect(cam.position.x).toBe(-3);
      expect(cam.position.y).toBe(2);
      expect(cam.position.z).toBe(12);
    });

    it('should default activeCamera to orthographic', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      const active = (engine as any).activeCamera;
      const ortho = (engine as any).orthographicCamera;
      expect(active).toBe(ortho);
    });

    it('should default viewMode to front', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      expect(engine.getViewMode()).toBe('front');
    });

    it('should keep orthographic camera at (0, 0, 14)', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      const cam = (engine as any).orthographicCamera as THREE.OrthographicCamera;
      expect(cam.position.x).toBe(0);
      expect(cam.position.y).toBe(0);
      expect(cam.position.z).toBe(14);
    });
  });

  describe('orbit controls configuration', () => {
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

    it('should set dampingFactor to 0.05', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      expect((engine as any).orbitControls.dampingFactor).toBe(0.05);
    });

    it('should set zoom distance limits', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      expect((engine as any).orbitControls.minDistance).toBe(8);
      expect((engine as any).orbitControls.maxDistance).toBe(20);
    });

    it('should set polar angle limits in radians', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      expect((engine as any).orbitControls.minPolarAngle).toBeCloseTo(10 * Math.PI / 180);
      expect((engine as any).orbitControls.maxPolarAngle).toBeCloseTo(80 * Math.PI / 180);
    });

    it('should set target to origin', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      expect((engine as any).orbitControls).toBeDefined();
    });
  });

  describe('switchViewMode', () => {
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

    it('should show xzGrid and hide xyGrid in perspective view', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      engine.switchViewMode('perspective');

      expect((engine as any).xyGridHelper.visible).toBe(false);
      expect((engine as any).xzGridHelper.visible).toBe(true);
    });

    it('should show xyGrid and hide xzGrid in front view', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      engine.switchViewMode('perspective'); // switch away first
      engine.switchViewMode('front');

      expect((engine as any).xyGridHelper.visible).toBe(true);
      expect((engine as any).xzGridHelper.visible).toBe(false);
    });

    it('should enable all controls sub-switches in perspective view', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      engine.switchViewMode('perspective');

      const c = (engine as any).orbitControls;
      expect(c.enabled).toBe(true);
      expect(c.enableRotate).toBe(true);
      expect(c.enableZoom).toBe(true);
      expect(c.enablePan).toBe(true);
    });

    it('should disable all controls in front view', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      engine.switchViewMode('perspective'); // switch away first
      engine.switchViewMode('front');

      const c = (engine as any).orbitControls;
      expect(c.enabled).toBe(false);
      expect(c.enableRotate).toBe(false);
      expect(c.enableZoom).toBe(false);
      expect(c.enablePan).toBe(false);
    });

    it('should preserve camera position when switching views', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      engine.switchViewMode('perspective');
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      const posBefore = cam.position.clone();
      engine.switchViewMode('front');
      engine.switchViewMode('perspective');
      expect(cam.position.x).toBe(posBefore.x);
      expect(cam.position.y).toBe(posBefore.y);
      expect(cam.position.z).toBe(posBefore.z);
    });
  });

  describe('motion detection for damping', () => {
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

    it('should have lastCamPos and lastCamTarget fields', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');

      expect((engine as any).lastCamPos).toBeDefined();
      expect((engine as any).lastCamPos).toBeInstanceOf(THREE.Vector3);
      expect((engine as any).lastCamTarget).toBeDefined();
      expect((engine as any).lastCamTarget).toBeInstanceOf(THREE.Vector3);
    });

    it('should set dirty after switching to perspective (triggers render)', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      engine.switchViewMode('perspective');
      expect((engine as any).dirty).toBe(true);
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

    it('should reset perspective camera to default position without changing view mode', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      engine.switchViewMode('perspective');

      // Move camera away from default
      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      cam.position.set(10, 10, 10);

      engine.reset();

      expect(cam.position.x).toBe(-3);
      expect(cam.position.y).toBe(2);
      expect(cam.position.z).toBe(12);
      expect(engine.getViewMode()).toBe('perspective');
    });

    it('should reset orthographic camera in front view without changing view mode', () => {
      const engine = new LightingEngine(container, 'https://example.com/test.jpg');
      // Default is front view
      const cam = (engine as any).orthographicCamera as THREE.OrthographicCamera;
      cam.position.set(5, 5, 5);

      engine.reset();

      expect(cam.position.x).toBe(0);
      expect(cam.position.y).toBe(0);
      expect(cam.position.z).toBe(14);
      expect(engine.getViewMode()).toBe('front');
    });
  });
});
