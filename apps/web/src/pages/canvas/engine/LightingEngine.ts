import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { type LightingParams } from '@flowweb/shared';
import { kelvinToRgb } from '@/utils/kelvinToRgb';

const REFERENCE_Z = 4;
const DRAG_PLANE_Z = 4;
const DRAG_BOUNDS = { xMin: -8, xMax: 8, yMin: -6, yMax: 6, zMin: 2, zMax: 10 };

export type ViewMode = 'perspective' | 'front';

export class LightingEngine {
  private container: HTMLElement;
  private thumbnailCanvas: HTMLCanvasElement | null;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private perspectiveCamera!: THREE.PerspectiveCamera;
  private orthographicCamera!: THREE.OrthographicCamera;
  private activeCamera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private orbitControls!: OrbitControls;
  private imagePlane!: THREE.Mesh;
  private light!: THREE.PointLight;
  private lightHandle!: THREE.Mesh;
  private lightLine!: THREE.Line;
  private lightCone!: THREE.Mesh;
  private xyGridHelper!: THREE.GridHelper;
  private xzGridHelper!: THREE.GridHelper;
  private animationId = 0;
  private dirty = true;
  private disposed = false;

  // Thumbnail
  private thumbnailTarget: THREE.WebGLRenderTarget | null = null;

  // Lighting state
  private position = { x: 0, y: 0, z: 6 };
  private brightness = 50;
  private currentKelvin = 5600;
  private rimLightEnabled = false;
  private viewMode: ViewMode = 'front';

  // Motion detection for damping animation
  private lastCamPos = new THREE.Vector3();
  private lastCamTarget = new THREE.Vector3();

  // Drag state
  private isDragging = false;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1));

  // Callbacks
  private onPositionChange?: (pos: { x: number; y: number; z: number }) => void;

  // Post-processing (lazy init)
  private composer: any = null;
  private outlinePass: any = null;

  constructor(
    container: HTMLElement,
    imageUrl: string,
    options?: {
      thumbnailCanvas?: HTMLCanvasElement;
      onPositionChange?: (pos: { x: number; y: number; z: number }) => void;
    },
  ) {
    this.container = container;
    this.thumbnailCanvas = options?.thumbnailCanvas ?? null;
    this.onPositionChange = options?.onPositionChange;

    this.initScene();
    this.initCameras();
    this.initRenderer();
    this.initOrbitControls();
    this.initLight();
    this.initGrid();
    this.loadImage(imageUrl);
    this.bindEvents();
    this.startLoop();
  }

  // ─── Init methods ────────────────────────────────────────

  private initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    if (this.thumbnailCanvas) {
      this.thumbnailTarget = new THREE.WebGLRenderTarget(
        this.thumbnailCanvas.width || 240,
        this.thumbnailCanvas.height || 180,
      );
      this.thumbnailTarget.texture.colorSpace = THREE.SRGBColorSpace;
    }
    this.fitRenderer();
  }

  private initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0e1a');
  }

  private initCameras() {
    const aspect = this.getAspect();
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.perspectiveCamera.position.set(-3, 2, 12);
    this.perspectiveCamera.lookAt(0, 0, 0);

    const frustumSize = 12;
    this.orthographicCamera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      100,
    );
    this.orthographicCamera.position.set(0, 0, 14);
    this.orthographicCamera.lookAt(0, 0, 0);

    this.activeCamera = this.orthographicCamera;
  }

  private initOrbitControls() {
    // Dynamic import pattern — OrbitControls requires DOM
    this.orbitControls = new OrbitControls(this.perspectiveCamera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.minDistance = 8;
    this.orbitControls.maxDistance = 20;
    this.orbitControls.minPolarAngle = 10 * Math.PI / 180;
    this.orbitControls.maxPolarAngle = 80 * Math.PI / 180;
    this.orbitControls.update();
  }

  private initLight() {
    this.light = new THREE.PointLight(0xffffff, this.calcIntensity(), 30);
    this.light.position.set(this.position.x, this.position.y, this.position.z);
    this.scene.add(this.light);

    // Ambient light so shadows aren't fully black
    const ambient = new THREE.AmbientLight(0xcccccc, 1.5);
    this.scene.add(ambient);

    // Visual handle: black sphere
    const handleGeo = new THREE.SphereGeometry(0.25, 16, 16);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.lightHandle = new THREE.Mesh(handleGeo, handleMat);
    this.lightHandle.position.copy(this.light.position);
    this.scene.add(this.lightHandle);

    // Line from light to image center
    const lineGeo = new THREE.BufferGeometry();
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    this.updateLineGeometry(lineGeo);
    this.lightLine = new THREE.Line(lineGeo, lineMat);
    this.scene.add(this.lightLine);

    this.initLightCone();
  }

  private initLightCone() {
    const geo = new THREE.ConeGeometry(Math.tan(Math.PI / 12), 1, 16, 1, true);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 0.5);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uMaxAlpha: { value: 0.35 },
      },
      vertexShader: `
        varying vec3 vLocalPos;
        void main() {
          vLocalPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uMaxAlpha;
        varying vec3 vLocalPos;
        void main() {
          float alpha = uMaxAlpha * (1.0 - vLocalPos.z);
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    this.lightCone = new THREE.Mesh(geo, mat);
    this.lightCone.renderOrder = 1;
    this.lightHandle.renderOrder = 2;
    this.scene.add(this.lightCone);

    this.updateConeTransform();
  }

  private updateConeTransform() {
    if (!this.lightCone) return;
    const pos = this.light.position;
    this.lightCone.position.copy(pos);
    this.lightCone.lookAt(0, 0, 0);
    const d = pos.length();
    this.lightCone.scale.set(d, d, d);
  }

  private updateLineGeometry(lineGeo: THREE.BufferGeometry) {
    const points = [
      new THREE.Vector3(this.position.x, this.position.y, this.position.z),
      new THREE.Vector3(0, 0, 0),
    ];
    lineGeo.setFromPoints(points);
  }

  private initGrid() {
    this.xyGridHelper = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
    this.xyGridHelper.rotation.x = Math.PI / 2; // Rotate to XY plane (parallel to image)
    this.xyGridHelper.position.z = -0.5; // Behind the image plane
    this.scene.add(this.xyGridHelper);

    this.xzGridHelper = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
    this.xzGridHelper.position.y = -2; // Floor below the image
    this.xzGridHelper.visible = false; // Hidden in default front view
    this.scene.add(this.xzGridHelper);
  }

  private loadImage(imageUrl: string) {
    const loader = new THREE.TextureLoader();
    loader.load(
      imageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image.width / texture.image.height;
        const planeHeight = 4;
        const planeWidth = planeHeight * aspect;
        const geo = new THREE.PlaneGeometry(planeWidth, planeHeight);
        const mat = new THREE.MeshStandardMaterial({
          map: texture,
          side: THREE.DoubleSide,
          roughness: 0.8,
          metalness: 0,
        });
        this.imagePlane = new THREE.Mesh(geo, mat);
        this.scene.add(this.imagePlane);
        this.dirty = true;
      },
      undefined,
      () => {
        // Image load failed — plane with fallback color
        const geo = new THREE.PlaneGeometry(8, 8);
        const mat = new THREE.MeshStandardMaterial({ color: 0x333333, side: THREE.DoubleSide });
        this.imagePlane = new THREE.Mesh(geo, mat);
        this.scene.add(this.imagePlane);
        this.dirty = true;
      },
    );
  }

  private bindEvents() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
  }

  // ─── Event handlers ──────────────────────────────────────

  private onPointerDown = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
    const intersects = this.raycaster.intersectObject(this.lightHandle);

    if (intersects.length > 0) {
      this.isDragging = true;
      this.orbitControls.enabled = false;
      this.renderer.domElement.style.cursor = 'grabbing';
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.isDragging) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.activeCamera);
    const intersection = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -DRAG_PLANE_Z),
      intersection,
    );

    if (intersection) {
      this.setPosition(
        Math.max(DRAG_BOUNDS.xMin, Math.min(DRAG_BOUNDS.xMax, intersection.x)),
        Math.max(DRAG_BOUNDS.yMin, Math.min(DRAG_BOUNDS.yMax, intersection.y)),
        this.position.z,
      );
    }
  };

  private onPointerUp = () => {
    if (this.isDragging) {
      this.isDragging = false;
      this.orbitControls.enabled = true;
      this.renderer.domElement.style.cursor = '';
      this.onPositionChange?.(this.position);
    }
  };

  private onResize = () => {
    this.fitRenderer();
    this.dirty = true;
  };

  // ─── Sizing ──────────────────────────────────────────────

  private fitRenderer() {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);

    const aspect = this.getAspect();
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();

    const frustumSize = 12;
    this.orthographicCamera.left = (-frustumSize * aspect) / 2;
    this.orthographicCamera.right = (frustumSize * aspect) / 2;
    this.orthographicCamera.top = frustumSize / 2;
    this.orthographicCamera.bottom = -frustumSize / 2;
    this.orthographicCamera.updateProjectionMatrix();
  }

  private getAspect(): number {
    const { clientWidth, clientHeight } = this.container;
    return clientHeight > 0 ? clientWidth / clientHeight : 1;
  }

  // ─── Render loop ─────────────────────────────────────────

  private startLoop() {
    // Seed motion detection state to avoid first-frame false positive
    this.lastCamPos.copy(this.activeCamera.position);
    this.lastCamTarget.copy(this.orbitControls.target);

    const animate = () => {
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(animate);

      if (this.orbitControls.enabled) {
        // Record pre-update state for damping detection
        this.lastCamPos.copy(this.activeCamera.position);
        this.lastCamTarget.copy(this.orbitControls.target);

        this.orbitControls.update();

        // If camera moved (user drag or damping inertia), mark dirty
        if (
          this.activeCamera.position.distanceToSquared(this.lastCamPos) > 1e-6 ||
          (this.orbitControls.target as THREE.Vector3).distanceToSquared(this.lastCamTarget) > 1e-6
        ) {
          this.dirty = true;
        }
      }

      if (this.dirty) {
        this.renderer.render(this.scene, this.activeCamera);
        this.renderThumbnail();
        this.dirty = false;
      }
    };
    animate();
  }

  private renderThumbnail() {
    if (!this.thumbnailTarget || !this.thumbnailCanvas) return;

    // Tightly frame the image: save and adjust ortho frustum
    const origLeft = this.orthographicCamera.left;
    const origRight = this.orthographicCamera.right;
    const origTop = this.orthographicCamera.top;
    const origBottom = this.orthographicCamera.bottom;
    const thumbnailFrustum = 5;
    const aspect = this.thumbnailCanvas.width / this.thumbnailCanvas.height;
    this.orthographicCamera.left = (-thumbnailFrustum * aspect) / 2;
    this.orthographicCamera.right = (thumbnailFrustum * aspect) / 2;
    this.orthographicCamera.top = thumbnailFrustum / 2;
    this.orthographicCamera.bottom = -thumbnailFrustum / 2;
    this.orthographicCamera.updateProjectionMatrix();

    // Hide light visual helpers in thumbnail
    this.lightHandle.visible = false;
    this.lightLine.visible = false;
    this.lightCone.visible = false;
    this.renderer.setRenderTarget(this.thumbnailTarget);
    this.renderer.render(this.scene, this.orthographicCamera);
    this.renderer.setRenderTarget(null);
    this.lightHandle.visible = true;
    this.lightLine.visible = true;
    this.lightCone.visible = true;

    // Restore original frustum
    this.orthographicCamera.left = origLeft;
    this.orthographicCamera.right = origRight;
    this.orthographicCamera.top = origTop;
    this.orthographicCamera.bottom = origBottom;
    this.orthographicCamera.updateProjectionMatrix();

    // Copy to thumbnail canvas (flip Y: WebGL bottom-left vs Canvas top-left)
    const ctx = this.thumbnailCanvas.getContext('2d');
    if (ctx) {
      const w = this.thumbnailCanvas.width;
      const h = this.thumbnailCanvas.height;
      const pixels = new Uint8Array(w * h * 4);
      this.renderer.readRenderTargetPixels(this.thumbnailTarget, 0, 0, w, h, pixels);
      // Flip rows manually — putImageData ignores canvas transforms
      const rowSize = w * 4;
      const flipped = new Uint8Array(pixels.length);
      for (let y = 0; y < h; y++) {
        const srcRow = y * rowSize;
        const dstRow = (h - 1 - y) * rowSize;
        flipped.set(pixels.subarray(srcRow, srcRow + rowSize), dstRow);
      }
      const imageData = new ImageData(new Uint8ClampedArray(flipped), w, h);
      ctx.putImageData(imageData, 0, 0);
    }
  }

  private clampToViewport(x: number, y: number, z: number): { x: number; y: number } {
    if (this.viewMode !== 'perspective') return { x, y };

    const worldPos = new THREE.Vector3(x, y, z);
    const ndc = worldPos.clone().project(this.activeCamera);

    const margin = 0.85;
    if (Math.abs(ndc.x) > margin || Math.abs(ndc.y) > margin) {
      const clampedNdc = new THREE.Vector3(
        Math.max(-margin, Math.min(margin, ndc.x)),
        Math.max(-margin, Math.min(margin, ndc.y)),
        ndc.z,
      );
      const unprojected = clampedNdc.unproject(this.activeCamera);
      return { x: unprojected.x, y: unprojected.y };
    }
    return { x, y };
  }

  // ─── Public API ──────────────────────────────────────────

  setPosition(x: number, y: number, z: number) {
    const clamped = this.clampToViewport(x, y, z);
    this.position = { x: clamped.x, y: clamped.y, z };
    this.light.position.set(x, y, z);
    this.lightHandle.position.set(x, y, z);
    this.updateConeTransform();
    this.light.intensity = this.calcIntensity();
    this.updateLineGeometry(this.lightLine.geometry);
    this.dirty = true;
  }

  setBrightness(value: number) {
    this.brightness = Math.max(0, Math.min(100, value));
    this.light.intensity = this.calcIntensity();
    if (this.lightCone) {
      (this.lightCone.material as THREE.ShaderMaterial).uniforms.uMaxAlpha.value =
        (this.brightness / 100) * 0.7;
    }
    this.dirty = true;
  }

  setColorTemperature(kelvin: number) {
    this.currentKelvin = Math.max(2000, Math.min(10000, kelvin));
    const { r, g, b } = kelvinToRgb(this.currentKelvin);
    this.light.color.setRGB(r, g, b);
    if (this.rimLightEnabled && this.outlinePass) {
      this.outlinePass.visibleEdgeColor.setRGB(r, g, b);
    }
    if (this.lightCone) {
      (this.lightCone.material as THREE.ShaderMaterial).uniforms.uColor.value.setRGB(r, g, b);
    }
    this.dirty = true;
  }

  toggleRimLight(enabled: boolean) {
    this.rimLightEnabled = enabled;
    if (enabled) {
      this.initOutlinePass();
    }
    if (this.outlinePass) {
      this.outlinePass.enabled = enabled;
    }
    this.dirty = true;
  }

  switchViewMode(mode: ViewMode) {
    this.viewMode = mode;
    this.activeCamera = mode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;

    const isPerspective = mode === 'perspective';
    this.orbitControls.enabled = isPerspective;
    this.orbitControls.enableRotate = isPerspective;
    this.orbitControls.enableZoom = isPerspective;
    this.orbitControls.enablePan = isPerspective;

    // Toggle grids
    this.xyGridHelper.visible = !isPerspective;
    this.xzGridHelper.visible = isPerspective;

    // Sync OutlinePass camera
    if (this.outlinePass) {
      this.outlinePass.renderCamera = this.activeCamera;
    }
    this.dirty = true;
  }

  getViewMode(): ViewMode {
    return this.viewMode;
  }

  getThumbnailCanvas(): HTMLCanvasElement | null {
    return this.thumbnailCanvas;
  }

  reset() {
    this.setPosition(0, 0, 6);
    this.setBrightness(50);
    this.setColorTemperature(5600);
    this.toggleRimLight(false);

    // Reset current view's camera, not the view mode itself
    if (this.viewMode === 'perspective') {
      this.perspectiveCamera.position.set(-3, 2, 12);
      this.perspectiveCamera.lookAt(0, 0, 0);
      this.orbitControls.target.set(0, 0, 0);
      this.orbitControls.update();
    } else {
      this.orthographicCamera.position.set(0, 0, 14);
      this.orthographicCamera.lookAt(0, 0, 0);
    }

    // Seed motion detection state after reset
    this.lastCamPos.copy(this.activeCamera.position);
    this.lastCamTarget.copy(this.orbitControls.target);

    this.dirty = true;
    this.onPositionChange?.(this.position);
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    this.disposed = true;

    // Remove events
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);

    // Dispose orbit controls
    this.orbitControls.dispose();

    // Dispose scene objects
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => this.disposeMaterial(m));
        } else {
          this.disposeMaterial(obj.material);
        }
      }
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });

    // Dispose render target
    if (this.thumbnailTarget) {
      this.thumbnailTarget.dispose();
    }

    // Dispose renderer
    this.renderer.dispose();

    // Remove canvas
    if (canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }
  }

  private calcIntensity(): number {
    // Inverse square law compensation: normalized to REFERENCE_Z = 4
    const baseIntensity = (this.brightness / 100) * 10;
    const distance = Math.max(0.5, Math.sqrt(
      this.position.x ** 2 + this.position.y ** 2 + this.position.z ** 2,
    ));
    return baseIntensity * (distance / REFERENCE_Z) ** 2;
  }

  private disposeMaterial(material: THREE.Material) {
    if ('map' in material && (material as any).map) {
      (material as any).map.dispose();
    }
    material.dispose();
  }

  private initOutlinePass() {
    if (this.outlinePass) return;
    try {
      this.composer = new EffectComposer(this.renderer);
      const renderPass = new RenderPass(this.scene, this.activeCamera);
      this.composer.addPass(renderPass);

      this.outlinePass = new OutlinePass(
        new THREE.Vector2(this.renderer.domElement.clientWidth, this.renderer.domElement.clientHeight),
        this.scene,
        this.activeCamera,
      );
      this.outlinePass.edgeStrength = 3;
      this.outlinePass.edgeGlow = 0;
      this.outlinePass.edgeThickness = 1;
      this.outlinePass.pulsePeriod = 0;
      const { r, g, b } = kelvinToRgb(this.currentKelvin);
      this.outlinePass.visibleEdgeColor.setRGB(r, g, b);
      this.outlinePass.selectedObjects = [this.imagePlane];
      this.composer.addPass(this.outlinePass);

      // Override render to use composer when rim light is on
      const origRender = this.renderer.render.bind(this.renderer);
      this.renderer.render = (s: THREE.Scene, c: THREE.Camera) => {
        if (this.rimLightEnabled && this.composer && this.outlinePass?.enabled) {
          this.composer.render();
        } else {
          origRender(s, c);
        }
      };
    } catch {
      // Post-processing unavailable, rim light disabled silently
      this.rimLightEnabled = false;
    }
  }
}
