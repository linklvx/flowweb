import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { type Angle3DParams, ANGLE3D_DEFAULTS, ANGLE3D_PRESETS, type Angle3DPresetKey } from '@flowweb/shared';

const IMAGE_HEIGHT = 2; // Fixed image plane height
const BASE_DISTANCE = 5; // Base camera distance for zoom formula

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export class Angle3DEngine {
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private perspectiveCamera!: THREE.PerspectiveCamera;
  private activeCamera!: THREE.PerspectiveCamera;
  private orbitControls!: OrbitControls;
  private imagePlane!: THREE.Mesh;
  private xzGridHelper!: THREE.GridHelper;
  private imageLoaded = false;
  private imageFailed = false;
  private animationId = 0;
  private dirty = true;
  private disposed = false;

  private currentParams: Angle3DParams = { ...ANGLE3D_DEFAULTS };

  private onParamsChange?: (params: Partial<Angle3DParams>) => void;

  constructor(
    container: HTMLElement,
    imageUrl: string,
    options?: {
      onParamsChange?: (params: Partial<Angle3DParams>) => void;
    },
  ) {
    this.container = container;
    this.onParamsChange = options?.onParamsChange;

    this.initScene();
    this.initCamera();
    this.initRenderer();
    this.initOrbitControls();
    this.initGrid();
    this.initImagePlane(imageUrl);
    this.bindEvents();
    this.startLoop();

    // Apply initial default params
    this.applyParamsToCamera();
  }

  // ─── Init methods ────────────────────────────────────

  private initScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0e1a');
  }

  private initCamera(): void {
    const aspect = this.getAspect();
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
    this.activeCamera = this.perspectiveCamera;
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
    this.fitRenderer();
  }

  private initOrbitControls(): void {
    this.orbitControls = new OrbitControls(this.perspectiveCamera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.target.set(0, 0, 0);

    // Disable pan — camera must stay on spherical coordinate surface
    this.orbitControls.enablePan = false;

    // Azimuth angle limits: horizontalAngle ±90°
    this.orbitControls.minAzimuthAngle = -Math.PI / 2;
    this.orbitControls.maxAzimuthAngle = Math.PI / 2;

    // Polar angle limits: verticalAngle ±60°
    // polar = π/2 - degToRad(verticalAngle)
    // verticalAngle=+60° → polar = π/2 - π/3 = π/6
    // verticalAngle=-60° → polar = π/2 + π/3 = 5π/6
    this.orbitControls.minPolarAngle = Math.PI / 6;
    this.orbitControls.maxPolarAngle = (5 * Math.PI) / 6;

    this.orbitControls.update();

    // Listen for drag changes to reverse-calculate params
    this.orbitControls.addEventListener('change', this.onControlsChange);
    this.orbitControls.addEventListener('end', this.onControlsEnd);
  }

  private initGrid(): void {
    // XZ grid at Y=-1 (aligned with bottom of image plane)
    this.xzGridHelper = new THREE.GridHelper(10, 10, 0x333333, 0x555555);
    this.xzGridHelper.position.y = -1;
    this.scene.add(this.xzGridHelper);
  }

  private initImagePlane(imageUrl: string): void {
    // Create placeholder plane (1:1 aspect) — will be replaced on texture load
    const geo = new THREE.PlaneGeometry(IMAGE_HEIGHT, IMAGE_HEIGHT);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x444444,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
      depthWrite: true,
    });
    this.imagePlane = new THREE.Mesh(geo, mat);
    this.scene.add(this.imagePlane);

    // Load texture asynchronously
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';
    loader.load(
      imageUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image.width / texture.image.height;
        const planeWidth = IMAGE_HEIGHT * aspect;
        const planeHeight = IMAGE_HEIGHT;

        // Update geometry to match aspect ratio
        this.imagePlane.geometry.dispose();
        this.imagePlane.geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);

        // Update material with texture
        const oldMat = this.imagePlane.material as THREE.MeshBasicMaterial;
        oldMat.dispose();
        this.imagePlane.material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: true,
        });
        this.imageLoaded = true;
        this.dirty = true;
      },
      undefined,
      () => {
        // Load failed — show fallback
        this.imageFailed = true;
        const fallbackMat = new THREE.MeshBasicMaterial({
          color: 0x333333,
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: true,
        });
        const oldMat = this.imagePlane.material as THREE.MeshBasicMaterial;
        oldMat.dispose();
        this.imagePlane.material = fallbackMat;
        this.dirty = true;
      },
    );
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    const canvas = this.renderer.domElement;
    if (canvas) {
      canvas.addEventListener('webglcontextlost', this.onContextLost);
    }
  }

  // ─── Event handlers ──────────────────────────────────

  private onResize = (): void => {
    this.fitRenderer();
    this.dirty = true;
  };

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    console.error('Angle3DEngine: WebGL context lost');
    this.disposed = true;
  };

  // OrbitControls change — fired every frame during drag/damping
  private onControlsChange = (): void => {
    this.dirty = true;

    // Reverse-calculate params from camera and notify (throttled by requestAnimationFrame)
    const params = this.getParamsFromCamera();
    this.currentParams.horizontalAngle = params.horizontalAngle;
    this.currentParams.verticalAngle = params.verticalAngle;
    this.currentParams.zoom = params.zoom;
  };

  // OrbitControls end — fired when drag/damping stops
  private onControlsEnd = (): void => {
    // Precise alignment on drag end
    const params = this.getParamsFromCamera();
    this.currentParams.horizontalAngle = params.horizontalAngle;
    this.currentParams.verticalAngle = params.verticalAngle;
    this.currentParams.zoom = params.zoom;

    this.onParamsChange?.({
      horizontalAngle: params.horizontalAngle,
      verticalAngle: params.verticalAngle,
      zoom: params.zoom,
    });
  };

  // ─── Sizing ──────────────────────────────────────────

  private fitRenderer(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);

    const aspect = this.getAspect();
    this.perspectiveCamera.aspect = aspect;
    this.perspectiveCamera.updateProjectionMatrix();
  }

  private getAspect(): number {
    const { clientWidth, clientHeight } = this.container;
    return clientHeight > 0 ? clientWidth / clientHeight : 1;
  }

  // ─── Spherical coordinate system ─────────────────────

  /**
   * Forward: convert params to camera position
   */
  private applyParamsToCamera(): void {
    const { horizontalAngle, verticalAngle, zoom } = this.currentParams;
    const alpha = degToRad(horizontalAngle);
    const beta = degToRad(verticalAngle);
    const r = BASE_DISTANCE * (1 - zoom / 20);

    this.perspectiveCamera.position.x = r * Math.sin(alpha) * Math.cos(beta);
    this.perspectiveCamera.position.y = r * Math.sin(beta);
    this.perspectiveCamera.position.z = r * Math.cos(alpha) * Math.cos(beta);
    this.perspectiveCamera.lookAt(0, 0, 0);

    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.update();
    this.dirty = true;
  }

  /**
   * Reverse: calculate params from current camera position
   * Returns clamped values matching slider ranges
   */
  private getParamsFromCamera(): { horizontalAngle: number; verticalAngle: number; zoom: number } {
    const pos = this.perspectiveCamera.position;
    const r = pos.length();
    const safeR = Math.max(r, 0.001);

    // horizontalAngle = atan2(x, z)
    let horizontalAngle = radToDeg(Math.atan2(pos.x, pos.z));
    horizontalAngle = clamp(horizontalAngle, -90, 90);

    // verticalAngle = asin(y / r)
    const sinBeta = clamp(pos.y / safeR, -1, 1);
    let verticalAngle = radToDeg(Math.asin(sinBeta));
    verticalAngle = clamp(verticalAngle, -60, 60);

    // zoom = 20 * (1 - r / BASE_DISTANCE)
    let zoom = 20 * (1 - r / BASE_DISTANCE);
    zoom = clamp(zoom, 0, 10);

    return { horizontalAngle, verticalAngle, zoom };
  }

  // ─── Render loop ─────────────────────────────────────

  private startLoop(): void {
    const animate = () => {
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(animate);

      this.orbitControls.update();

      if (this.dirty) {
        this.renderer.render(this.scene, this.activeCamera);
        this.dirty = false;
      }
    };
    animate();
  }

  // ─── Public API ──────────────────────────────────────

  setParams(horizontalAngle: number, verticalAngle: number, zoom: number): void {
    this.currentParams.horizontalAngle = clamp(horizontalAngle, -90, 90);
    this.currentParams.verticalAngle = clamp(verticalAngle, -60, 60);
    this.currentParams.zoom = clamp(zoom, 0, 10);
    this.applyParamsToCamera();
  }

  setHorizontalAngle(value: number): void {
    this.currentParams.horizontalAngle = clamp(value, -90, 90);
    this.applyParamsToCamera();
  }

  setVerticalAngle(value: number): void {
    this.currentParams.verticalAngle = clamp(value, -60, 60);
    this.applyParamsToCamera();
  }

  setZoom(value: number): void {
    this.currentParams.zoom = clamp(value, 0, 10);
    this.applyParamsToCamera();
  }

  applyPreset(key: Angle3DPresetKey): void {
    const preset = ANGLE3D_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    this.setParams(preset.horizontalAngle, preset.verticalAngle, preset.zoom);
  }

  getImageLoaded(): boolean {
    return this.imageLoaded;
  }

  getImageFailed(): boolean {
    return this.imageFailed;
  }

  reset(): void {
    this.currentParams = { ...ANGLE3D_DEFAULTS };
    this.applyParamsToCamera();
    this.perspectiveCamera.lookAt(0, 0, 0);
    this.orbitControls.target.set(0, 0, 0);
    this.orbitControls.update();
    this.dirty = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    cancelAnimationFrame(this.animationId);

    // Remove event listeners
    window.removeEventListener('resize', this.onResize);
    this.orbitControls.removeEventListener('change', this.onControlsChange);
    this.orbitControls.removeEventListener('end', this.onControlsEnd);

    const canvas = this.renderer.domElement;
    if (canvas) {
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
    }

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

    // Dispose renderer
    this.renderer.dispose();

    // Remove canvas from DOM
    if (canvas && canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }
  }

  private disposeMaterial(material: THREE.Material): void {
    if ('map' in material && (material as any).map) {
      (material as any).map.dispose();
    }
    material.dispose();
  }
}
