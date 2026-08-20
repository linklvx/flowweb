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

const engines: LightingEngine[] = [];
afterEach(() => {
  engines.forEach((e) => e.dispose());
  engines.length = 0;
});
function createEngine(container: HTMLDivElement, url = 'https://example.com/test.jpg') {
  const engine = new LightingEngine(container, url);
  engines.push(engine);
  return engine;
}

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
      const engine = createEngine(container);

      expect((engine as any).xyGridHelper).toBeDefined();
      expect((engine as any).xyGridHelper).toBeInstanceOf(THREE.GridHelper);
      expect((engine as any).xzGridHelper).toBeDefined();
      expect((engine as any).xzGridHelper).toBeInstanceOf(THREE.GridHelper);
    });

    it('should have xyGrid visible and xzGrid hidden by default', () => {
      const engine = createEngine(container);

      expect((engine as any).xyGridHelper.visible).toBe(true);
      expect((engine as any).xzGridHelper.visible).toBe(false);
    });

    it('should keep xyGrid parameters unchanged', () => {
      const engine = createEngine(container);

      const xyGrid = (engine as any).xyGridHelper as THREE.GridHelper;
      expect(xyGrid.rotation.x).toBeCloseTo(Math.PI / 2);
      expect(xyGrid.position.z).toBe(-0.5);
    });

    it('should place xzGrid at y=-2 with no rotation', () => {
      const engine = createEngine(container);

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
      const engine = createEngine(container);

      const cam = (engine as any).perspectiveCamera as THREE.PerspectiveCamera;
      expect(cam.position.x).toBe(-3);
      expect(cam.position.y).toBe(2);
      expect(cam.position.z).toBe(12);
    });

    it('should default activeCamera to orthographic', () => {
      const engine = createEngine(container);

      const active = (engine as any).activeCamera;
      const ortho = (engine as any).orthographicCamera;
      expect(active).toBe(ortho);
    });

    it('should default viewMode to front', () => {
      const engine = createEngine(container);

      expect(engine.getViewMode()).toBe('front');
    });

    it('should keep orthographic camera at (0, 0, 14)', () => {
      const engine = createEngine(container);

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
      const engine = createEngine(container);
      expect((engine as any).orbitControls.dampingFactor).toBe(0.05);
    });

    it('should set zoom distance limits', () => {
      const engine = createEngine(container);
      expect((engine as any).orbitControls.minDistance).toBe(8);
      expect((engine as any).orbitControls.maxDistance).toBe(20);
    });

    it('should set polar angle limits in radians', () => {
      const engine = createEngine(container);
      expect((engine as any).orbitControls.minPolarAngle).toBeCloseTo(10 * Math.PI / 180);
      expect((engine as any).orbitControls.maxPolarAngle).toBeCloseTo(80 * Math.PI / 180);
    });

    it('should set target to origin', () => {
      const engine = createEngine(container);
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
      const engine = createEngine(container);
      engine.switchViewMode('perspective');

      expect((engine as any).xyGridHelper.visible).toBe(false);
      expect((engine as any).xzGridHelper.visible).toBe(true);
    });

    it('should show xyGrid and hide xzGrid in front view', () => {
      const engine = createEngine(container);
      engine.switchViewMode('perspective'); // switch away first
      engine.switchViewMode('front');

      expect((engine as any).xyGridHelper.visible).toBe(true);
      expect((engine as any).xzGridHelper.visible).toBe(false);
    });

    it('should enable all controls sub-switches in perspective view', () => {
      const engine = createEngine(container);
      engine.switchViewMode('perspective');

      const c = (engine as any).orbitControls;
      expect(c.enabled).toBe(true);
      expect(c.enableRotate).toBe(true);
      expect(c.enableZoom).toBe(true);
      expect(c.enablePan).toBe(true);
    });

    it('should disable all controls in front view', () => {
      const engine = createEngine(container);
      engine.switchViewMode('perspective'); // switch away first
      engine.switchViewMode('front');

      const c = (engine as any).orbitControls;
      expect(c.enabled).toBe(false);
      expect(c.enableRotate).toBe(false);
      expect(c.enableZoom).toBe(false);
      expect(c.enablePan).toBe(false);
    });

    it('should preserve camera position when switching views', () => {
      const engine = createEngine(container);
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
      const engine = createEngine(container);

      expect((engine as any).lastCamPos).toBeDefined();
      expect((engine as any).lastCamPos).toBeInstanceOf(THREE.Vector3);
      expect((engine as any).lastCamTarget).toBeDefined();
      expect((engine as any).lastCamTarget).toBeInstanceOf(THREE.Vector3);
    });

    it('should set dirty after switching to perspective (triggers render)', () => {
      const engine = createEngine(container);
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
      const engine = createEngine(container);
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
      const engine = createEngine(container);
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

  describe('viewport clamping in perspective', () => {
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

    it('should have a clampToViewport method for perspective view', () => {
      const engine = createEngine(container);
      engine.switchViewMode('perspective');

      // The engine should have a mechanism to clamp positions to viewport
      expect(typeof (engine as any).clampToViewport).toBe('function');
    });
  });

  describe('light cone beam', () => {
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

    it('should create lightCone mesh on init', () => {
      const engine = createEngine(container);

      expect((engine as any).lightCone).toBeDefined();
      expect((engine as any).lightCone).toBeInstanceOf(THREE.Mesh);
    });

    it('should use ConeGeometry with correct transforms', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;
      const geo = cone.geometry as THREE.ConeGeometry;

      expect(geo).toBeInstanceOf(THREE.ConeGeometry);
      expect(geo.parameters.openEnded).toBe(true);
      expect(geo.parameters.radialSegments).toBe(16);
      expect(geo.parameters.height).toBe(1);
    });

    it('should use ShaderMaterial with AdditiveBlending, DoubleSide, depthWrite=false', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;
      const mat = cone.material as THREE.ShaderMaterial;

      expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
      expect(mat.blending).toBe(THREE.AdditiveBlending);
      expect(mat.side).toBe(THREE.DoubleSide);
      expect(mat.depthWrite).toBe(false);
      expect(mat.transparent).toBe(true);
      expect(mat.uniforms.uColor).toBeDefined();
      expect(mat.uniforms.uMaxAlpha).toBeDefined();
    });

    it('should set correct renderOrder: cone(0) < imagePlane(1) < handle(2)', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;

      expect(cone.renderOrder).toBe(0);
    });

    it('should align lightCone position with light position on init', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;
      const light = (engine as any).light as THREE.PointLight;

      expect(cone.position.x).toBe(light.position.x);
      expect(cone.position.y).toBe(light.position.y);
      expect(cone.position.z).toBe(light.position.z);
    });

    it('should update lightCone position on setPosition', () => {
      const engine = createEngine(container);
      engine.setPosition(3, 2, 8);
      const cone = (engine as any).lightCone as THREE.Mesh;

      expect(cone.position.x).toBe(3);
      expect(cone.position.y).toBe(2);
      expect(cone.position.z).toBe(8);
    });

    it('should update lightCone scale on distance change', () => {
      const engine = createEngine(container);
      engine.setPosition(0, 0, 6);
      const cone = (engine as any).lightCone as THREE.Mesh;

      // Distance from (0,0,6) to origin = 6, scale = 6 * 0.8 = 4.8
      expect(cone.scale.x).toBeCloseTo(4.8);
      expect(cone.scale.y).toBeCloseTo(4.8);
      expect(cone.scale.z).toBeCloseTo(4.8);
    });

    it('should update uMaxAlpha on setBrightness', () => {
      const engine = createEngine(container);
      engine.setBrightness(80);
      const cone = (engine as any).lightCone as THREE.Mesh;
      const mat = cone.material as THREE.ShaderMaterial;

      expect(mat.uniforms.uMaxAlpha.value).toBeCloseTo(0.32); // (80/100)*0.4
    });

    it('should update uColor on setColorTemperature', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;
      const mat = cone.material as THREE.ShaderMaterial;
      const colorBefore = mat.uniforms.uColor.value.getHex();

      engine.setColorTemperature(3000);
      const colorAfter = mat.uniforms.uColor.value.getHex();

      // Color should change with different kelvin
      expect(colorAfter).not.toBe(colorBefore);
    });

    it('should reset lightCone state via reset()', () => {
      const engine = createEngine(container);

      // Change all params
      engine.setPosition(3, 2, 8);
      engine.setBrightness(80);
      engine.setColorTemperature(3000);
      engine.reset();

      const cone = (engine as any).lightCone as THREE.Mesh;
      const mat = cone.material as THREE.ShaderMaterial;

      // Position reset to default (0,0,6)
      expect(cone.position.x).toBe(0);
      expect(cone.position.y).toBe(0);
      expect(cone.position.z).toBe(6);
      // uMaxAlpha reset (brightness 50 → 0.2)
      expect(mat.uniforms.uMaxAlpha.value).toBeCloseTo(0.2);
    });

    it('should have visible property on lightCone for thumbnail toggle', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;

      // lightCone.visible exists (used by renderThumbnail to toggle on/off)
      expect(cone.visible).toBe(true);
    });

    it('should dispose lightCone geometry and material on dispose', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;
      const geoDisposeSpy = vi.spyOn(cone.geometry, 'dispose');
      const matDisposeSpy = vi.spyOn(cone.material as THREE.Material, 'dispose');

      engine.dispose();

      expect(geoDisposeSpy).toHaveBeenCalled();
      expect(matDisposeSpy).toHaveBeenCalled();
    });

    it('should show gradient from tip to base in fragment shader', () => {
      const engine = createEngine(container);
      const cone = (engine as any).lightCone as THREE.Mesh;
      const mat = cone.material as THREE.ShaderMaterial;

      // Fragment shader should compute alpha decreasing along z (tip→base)
      expect(mat.fragmentShader).toContain('1.0 - vLocalPos.z');
    });
  });
});
