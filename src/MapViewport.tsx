import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Crosshair, Focus, Minus, MoveUpRight, Plus, Upload, X } from 'lucide-react';
import { createIsland, worldPoint, type IslandModel } from './mapEngine';
import { buildings, districts, REFERENCE, type LayerId, type SceneSettings } from './mapData';
import { ReferenceMap } from './ReferenceMap';
import { MiniMap, type MiniMapHandle } from './MiniMap';

export type ViewMode = '3d' | 'top' | 'compare';
export type ToolMode = 'select' | 'orbit' | 'pan' | 'measure';
export interface ViewportHandle {
  reset: () => void;
  zoom: (direction: number) => void;
  focus: (id: LayerId) => void;
  fly: () => void;
  drive: () => void;
  screenshot: () => string | null;
  exportModel: (format: 'glb' | 'obj', unit: 'm' | 'cm', includeWater: boolean, onlyVisible: boolean) => Promise<Blob>;
}
interface Props {
  projectName: string;
  settings: SceneSettings;
  view: ViewMode;
  tool: ToolMode;
  source: string | null;
  selected: LayerId;
  onSelect: (id: LayerId) => void;
  onStats: (stats: { triangles: number; objects: number }) => void;
  onCoordinates: (x: number, z: number) => void;
  onFlyChange: (active: boolean) => void;
  onDriveChange: (active: boolean) => void;
  onUpload: () => void;
  onViewChange: (view: ViewMode) => void;
  onOpacity: (value: number) => void;
  onNotice: (message: string) => void;
}

interface Runtime {
  model: IslandModel;
  renderer: THREE.WebGLRenderer;
  setView: (view: ViewMode) => void;
  setTool: (tool: ToolMode) => void;
  apply: (settings: SceneSettings) => void;
  setSource: (source: string | null) => void;
  zoom: (direction: number) => void;
  reset: () => void;
  focus: (id: LayerId) => void;
  fly: () => void;
  toggleDrive: () => void;
  teleportCar: (x: number, z: number) => void;
  setMapGrid: (visible: boolean, terrainHeight: number) => void;
  clearMeasurement: () => void;
}

/** Small blocky car for drive mode. Viewport aid only — never part of the exported model. */
function buildDriveCar() {
  const group = new THREE.Group();
  group.name = 'Drive_Mode_Car_Not_Exported';
  const inner = new THREE.Group();
  group.add(inner);
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#c8502e', roughness: 0.55, metalness: 0.15 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#a9ccd8', roughness: 0.25, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#2a2823', roughness: 0.8 });
  const lightMat = new THREE.MeshStandardMaterial({ color: '#ffe9a8', emissive: new THREE.Color('#ffd76a'), emissiveIntensity: 0.7, roughness: 0.4 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#e23b2e', emissive: new THREE.Color('#ff3b2e'), emissiveIntensity: 0.5, roughness: 0.5 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    inner.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(4.4, 1.0, 2.0), bodyMat, 0, 0.95, 0);
  add(new THREE.BoxGeometry(4.6, 0.18, 2.1), darkMat, 0, 0.42, 0);
  add(new THREE.BoxGeometry(2.3, 0.85, 1.8), glassMat, -0.35, 1.72, 0);
  add(new THREE.BoxGeometry(2.5, 0.14, 1.9), bodyMat, -0.35, 2.18, 0);
  add(new THREE.BoxGeometry(0.5, 0.25, 0.5), lightMat, 2.21, 0.95, 0.62);
  add(new THREE.BoxGeometry(0.5, 0.25, 0.5), lightMat, 2.21, 0.95, -0.62);
  add(new THREE.BoxGeometry(0.12, 0.22, 0.4), tailMat, -2.21, 0.95, 0.6);
  add(new THREE.BoxGeometry(0.12, 0.22, 0.4), tailMat, -2.21, 0.95, -0.6);
  const wheels: THREE.Mesh[] = [];
  [[1.55, 0.86], [1.55, -0.86], [-1.55, 0.86], [-1.55, -0.86]].forEach(([x, z]) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, z);
    pivot.rotation.x = Math.PI / 2;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10), darkMat);
    wheel.castShadow = true;
    pivot.add(wheel);
    inner.add(pivot);
    wheels.push(wheel);
  });
  return { group, inner, wheels };
}

export const MapViewport = forwardRef<ViewportHandle, Props>(function MapViewport(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<Record<string, HTMLButtonElement | null>>({});
  const scaleLine = useRef<HTMLDivElement>(null);
  const scaleText = useRef<HTMLSpanElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const runtime = useRef<Runtime | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [flyActive, setFlyActive] = useState(false);
  const [driveActive, setDriveActive] = useState(false);
  const [measurement, setMeasurement] = useState<string | null>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const minimapRef = useRef<MiniMapHandle>(null);

  useImperativeHandle(ref, () => ({
    reset: () => runtime.current?.reset(),
    zoom: direction => runtime.current?.zoom(direction),
    focus: id => runtime.current?.focus(id),
    fly: () => runtime.current?.fly(),
    drive: () => runtime.current?.toggleDrive(),
    screenshot: () => runtime.current?.renderer.domElement.toDataURL('image/png') || null,
    exportModel: async (format, unit, includeWater, onlyVisible) => {
      if (!runtime.current) throw new Error('The 3D renderer is not available. You can still export the layout JSON.');
      const copy = runtime.current.model.root.clone(true);
      const scene = new THREE.Scene();
      const prune = (object: THREE.Object3D) => {
        [...object.children].forEach(child => {
          if ((!includeWater && child.name === 'water') || (onlyVisible && !child.visible)) object.remove(child);
          else { if (!onlyVisible) child.visible = true; prune(child); }
        });
      };
      prune(copy);
      // Trim the oversized viewport water volume to a practical export size.
      copy.getObjectByName('Placeholder_Water_Volume')?.scale.set(0.45, 1, 0.45);
      // The depth-shaded water surface draws only part of its index buffer; export just those cells.
      const surface = copy.getObjectByName('Water_Surface') as THREE.Mesh | undefined;
      let trimmed: THREE.BufferGeometry | null = null;
      if (surface?.geometry.index) {
        const source = surface.geometry;
        const sourceIndex = source.index!;
        const count = Math.min(sourceIndex.count, source.drawRange.count);
        trimmed = new THREE.BufferGeometry();
        trimmed.setAttribute('position', source.attributes.position);
        trimmed.setAttribute('normal', source.attributes.normal);
        trimmed.setAttribute('color', source.attributes.color);
        trimmed.setIndex(new THREE.BufferAttribute((sourceIndex.array as Uint32Array).slice(0, count), 1));
        surface.geometry = trimmed;
      }
      if (unit === 'cm') copy.scale.setScalar(100);
      scene.add(copy);
      scene.updateMatrixWorld(true);
      try {
        if (format === 'obj') {
          const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
          return new Blob([new OBJExporter().parse(scene)], { type: 'text/plain' });
        }
        const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
        const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible });
        if (!(result instanceof ArrayBuffer)) throw new Error('The exporter did not return a binary model.');
        return new Blob([result], { type: 'model/gltf-binary' });
      } finally {
        trimmed?.dispose();
      }
    },
  }), []);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D island. Drag to orbit, right-drag to pan, and scroll to zoom.');
    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(latest.current.settings.colors.water);
    const model = createIsland(latest.current.settings);
    scene.add(model.root);
    scene.add(new THREE.HemisphereLight('#ffffff', '#7c8f86', 1.0));
    const fill = new THREE.DirectionalLight('#dbe9ff', 0.45);
    fill.position.set(400, 200, -300);
    scene.add(fill);
    const sunlight = new THREE.DirectionalLight('#fff4de', 2.3);
    sunlight.position.set(-420, 780, 260);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(4096,4096);
    sunlight.shadow.camera.left = -700;
    sunlight.shadow.camera.right = 700;
    sunlight.shadow.camera.top = 700;
    sunlight.shadow.camera.bottom = -700;
    sunlight.shadow.camera.near = 50;
    sunlight.shadow.camera.far = 1800;
    sunlight.shadow.normalBias = 0.6;
    sunlight.shadow.bias = -0.0002;
    sunlight.shadow.radius = 3;
    scene.add(sunlight);

    const grid = new THREE.GridHelper(2800,70,'#5b8983','#739f98');
    grid.position.y = -0.5;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.2;
    gridMaterial.depthWrite = false;
    scene.add(grid);

    const orthographic = new THREE.OrthographicCamera(-600,600,470,-470,0.5,10000);
    orthographic.position.set(930,1450,1320);
    const perspective = new THREE.PerspectiveCamera(54,1,0.5,10000);
    let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = orthographic;
    const controls = new OrbitControls(camera,renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.8;
    controls.minZoom = 0.45;
    controls.maxZoom = 9;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = Math.PI / 2.25;
    controls.target.set(0,0,-10);
    controls.update();
    let width = 1;
    let height = 1;
    let currentView: ViewMode = latest.current.view;
    let flying = false;
    let disposed = false;
    let frame = 0;
    let sourceToken = 0;
    let referencePlane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
    let transition: { fromPosition: THREE.Vector3; toPosition: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromZoom: number; toZoom: number; start: number } | null = null;

    const fitFrustum = () => {
      const aspect = width / height;
      const size = currentView === '3d' ? Math.max(715,890 / aspect) : Math.max(1060,1040 / aspect);
      orthographic.left = -size * aspect / 2;
      orthographic.right = size * aspect / 2;
      orthographic.top = size / 2;
      orthographic.bottom = -size / 2;
      orthographic.updateProjectionMatrix();
      perspective.aspect = aspect;
      perspective.updateProjectionMatrix();
    };
    const resize = () => {
      width = Math.max(container.clientWidth,1);
      height = Math.max(container.clientHeight,1);
      renderer.setSize(width,height);
      fitFrustum();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const animateTo = (target: THREE.Vector3, zoom: number, position?: THREE.Vector3) => {
      const direction = currentView === '3d' ? new THREE.Vector3(930,1450,1320) : new THREE.Vector3(0,1800,0.1);
      transition = {
        fromPosition: camera.position.clone(), toPosition: position || target.clone().add(direction),
        fromTarget: controls.target.clone(), toTarget: target, fromZoom: camera.zoom, toZoom: zoom, start: performance.now(),
      };
    };
    const updateReference = () => {
      if (!referencePlane) return;
      referencePlane.visible = !!latest.current.source && currentView !== '3d' && latest.current.settings.visibility.reference;
      referencePlane.material.opacity = latest.current.settings.referenceOpacity;
    };
    const leaveFly = () => {
      if (!flying) return;
      flying = false;
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      camera = orthographic;
      controls.object = camera;
      controls.enabled = true;
      setFlyActive(false);
      latest.current.onFlyChange(false);
    };
    const setTool = (tool: ToolMode) => {
      controls.mouseButtons.LEFT = tool === 'pan' || currentView !== '3d' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      controls.enableRotate = currentView === '3d' && tool !== 'pan' && tool !== 'measure';
      controls.enablePan = tool !== 'measure';
      renderer.domElement.style.cursor = tool === 'pan' ? 'grab' : tool === 'measure' ? 'crosshair' : 'default';
    };
    const setView = (view: ViewMode) => {
      leaveFly();
      currentView = view;
      renderer.shadowMap.enabled = latest.current.settings.shadows && view !== 'compare';
      grid.visible = latest.current.settings.grid && latest.current.settings.visibility.water && view !== 'compare';
      fitFrustum();
      controls.minPolarAngle = view === '3d' ? 0.02 : 0.00001;
      setTool(latest.current.tool);
      animateTo(new THREE.Vector3(0,0,-5),1);
      updateReference();
    };
    const reset = () => {
      leaveFly();
      if (drive.active) leaveDrive();
      animateTo(new THREE.Vector3(0,0,-5),1);
    };
    const focus = (id: LayerId) => {
      const district = districts.find(d => d.id === id);
      if (!district) { reset(); return; }
      leaveFly();
      animateTo(worldPoint(...district.position,0),district.zoom);
    };
    const apply = (settings: SceneSettings) => {
      model.apply(settings);
      grid.visible = settings.grid && settings.visibility.water && currentView !== 'compare';
      grid.position.y = settings.waterLevel - 0.5;
      renderer.shadowMap.enabled = settings.shadows && currentView !== 'compare';
      scene.background = new THREE.Color(settings.visibility.water ? settings.colors.water : '#b6bdb8');
      updateReference();
    };
    const setSource = (source: string | null) => {
      const token = ++sourceToken;
      if (referencePlane) {
        scene.remove(referencePlane);
        referencePlane.material.map?.dispose();
        referencePlane.material.dispose();
        referencePlane.geometry.dispose();
        referencePlane = null;
      }
      if (!source) return;
      new THREE.TextureLoader().load(source,texture => {
        if (disposed || token !== sourceToken) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: latest.current.settings.referenceOpacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
        referencePlane = new THREE.Mesh(new THREE.PlaneGeometry(REFERENCE.width,REFERENCE.height),material);
        referencePlane.name = 'Locked_Source_Image_Not_Exported';
        referencePlane.rotation.x = -Math.PI / 2;
        referencePlane.position.copy(worldPoint(REFERENCE.width / 2,REFERENCE.height / 2,130));
        referencePlane.renderOrder = 100;
        scene.add(referencePlane);
        updateReference();
      },undefined,() => latest.current.onNotice('Could not read this image. Try a PNG or JPG file.'));
    };

    /* ---- Drive-mode car (viewport aid; never exported) ---- */
    const car = buildDriveCar();
    car.group.visible = false;
    scene.add(car.group);

    /* ---- Location grid overlay: 100 m cells draped on the terrain ---- */
    let mapGrid: THREE.LineSegments | null = null;
    let mapGridTerrain = -1;
    const buildMapGrid = () => {
      if (mapGrid) {
        scene.remove(mapGrid);
        mapGrid.geometry.dispose();
        (mapGrid.material as THREE.Material).dispose();
        mapGrid = null;
      }
      const th = latest.current.settings.terrainHeight;
      const pts: number[] = [];
      // Lie on whatever surface is topmost (terrain, road, or quay deck). A fixed
      // offset above the terrain made the lines float over streets as stray marks.
      const yAt = (x: number, z: number) => {
        const ground = model.sampleHeight(x + REFERENCE.originX, z + REFERENCE.originY, th);
        const road = model.sampleRoadHeight(x + REFERENCE.originX, z + REFERENCE.originY, th);
        return Math.max(Math.max(ground, road === null ? -Infinity : road), -1.2) + 0.05;
      };
      for (let x = -500; x <= 500; x += 100) for (let z = -550; z <= 550; z += 10) pts.push(x, yAt(x, z), z);
      for (let z = -550; z <= 550; z += 100) for (let x = -500; x <= 500; x += 10) pts.push(x, yAt(x, z), z);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      mapGrid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#eef6ee', transparent: true, opacity: 0.14, depthWrite: false }));
      mapGrid.name = 'Map_Grid_Overlay_Not_Exported';
      mapGrid.renderOrder = 4;
      scene.add(mapGrid);
      mapGridTerrain = th;
    };
    const setMapGrid = (visible: boolean, terrainHeight: number) => {
      if (!mapGrid || Math.abs(mapGridTerrain - terrainHeight) > 1e-6) buildMapGrid();
      if (mapGrid) mapGrid.visible = visible;
    };
    setMapGrid(latest.current.settings.mapGrid, latest.current.settings.terrainHeight);

    /* ---- Drive mode state and controls ---- */
    const drive = { active: false, speed: 0, heading: Math.PI / 2, x: -104, z: -67 };
    const enterDrive = () => {
      if (flying) leaveFly();
      drive.active = true;
      drive.speed = 0;
      drive.x = -104; drive.z = -67; drive.heading = Math.PI / 2;
      car.group.visible = true;
      camera = perspective;
      controls.enabled = false;
      perspective.near = 0.3;
      perspective.updateProjectionMatrix();
      setDriveActive(true);
      latest.current.onDriveChange(true);
      minimapRef.current?.draw(drive.x, drive.z, drive.heading);
    };
    const leaveDrive = () => {
      if (!drive.active) return;
      drive.active = false;
      car.group.visible = false;
      camera = orthographic;
      controls.object = camera;
      controls.enabled = true;
      setDriveActive(false);
      latest.current.onDriveChange(false);
      minimapRef.current?.draw(null, null, 0);
    };
    const toggleDrive = () => { if (drive.active) leaveDrive(); else enterDrive(); };
    const teleportCar = (x: number, z: number) => {
      if (!drive.active) return;
      drive.x = THREE.MathUtils.clamp(x, -503, 495);
      drive.z = THREE.MathUtils.clamp(z, -549, 529);
      drive.speed = 0;
    };

    const keys = new Set<string>();
    const fly = () => {
      if (flying) { leaveFly(); reset(); return; }
      if (drive.active) leaveDrive();
      transition = null;
      flying = true;
      currentView = '3d';
      controls.enabled = false;
      perspective.position.copy(worldPoint(616,755,90));
      perspective.rotation.order = 'YXZ';
      perspective.lookAt(worldPoint(616,450,22));
      camera = perspective;
      setFlyActive(true);
      latest.current.onFlyChange(true);
      renderer.domElement.requestPointerLock?.()?.catch(() => latest.current.onNotice('Click the viewport to enable mouse look. WASD navigation is ready.'));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[role="dialog"]')) return;
      keys.add(event.code);
      const driveKeys = ['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
      if ((flying && ['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Space'].includes(event.code)) || (drive.active && driveKeys.includes(event.code))) event.preventDefault();
      if (event.code === 'Escape' && flying) { leaveFly(); reset(); }
      else if (event.code === 'Escape' && drive.active) leaveDrive();
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    const onBlur = () => keys.clear();
    const onMouseMove = (event: MouseEvent) => {
      if (!flying || document.pointerLockElement !== renderer.domElement) return;
      perspective.rotation.y -= event.movementX * 0.002;
      perspective.rotation.x = THREE.MathUtils.clamp(perspective.rotation.x - event.movementY * 0.002,-1.4,1.4);
    };
    const onLockChange = () => {
      if (flying && document.pointerLockElement !== renderer.domElement) { leaveFly(); reset(); }
    };
    document.addEventListener('keydown',onKeyDown);
    document.addEventListener('keyup',onKeyUp);
    document.addEventListener('mousemove',onMouseMove);
    document.addEventListener('pointerlockchange',onLockChange);
    window.addEventListener('blur',onBlur);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0,1,0),-10.6);
    let pointerStart = { x: 0, y: 0 };
    let lastCoordinateUpdate = 0;
    let measureStart: THREE.Vector3 | null = null;
    let measureLine: THREE.Line | null = null;
    const clearMeasurement = () => {
      if(measureLine) {
        scene.remove(measureLine);
        measureLine.geometry.dispose();
        (measureLine.material as THREE.Material).dispose();
        measureLine = null;
      }
      measureStart = null;
      setMeasurement(null);
    };
    const projectPointer = (event: PointerEvent) => {
      plane.constant = -latest.current.settings.terrainHeight-0.6;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX-bounds.left)/width*2-1,-(event.clientY-bounds.top)/height*2+1);
      raycaster.setFromCamera(pointer,camera);
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
      transition = null;
      if (flying && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.()?.catch(() => {});
    };
    const onPointerMove = (event: PointerEvent) => {
      if (performance.now()-lastCoordinateUpdate < 100) return;
      lastCoordinateUpdate = performance.now();
      projectPointer(event);
      const hit = raycaster.ray.intersectPlane(plane,new THREE.Vector3());
      if (hit) latest.current.onCoordinates(hit.x,hit.z);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (flying || drive.active || event.button !== 0 || Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5) return;
      projectPointer(event);
      if (latest.current.tool === 'measure') {
        const hit = raycaster.ray.intersectPlane(plane,new THREE.Vector3());
        if (!hit) return;
        if (!measureStart) {
          if (measureLine) { scene.remove(measureLine); measureLine.geometry.dispose(); (measureLine.material as THREE.Material).dispose(); measureLine = null; }
          measureStart = hit.clone();
          setMeasurement('Select a second point');
        } else {
          const distance = measureStart.distanceTo(hit);
          const geometry = new THREE.BufferGeometry().setFromPoints([measureStart,hit]);
          measureLine = new THREE.Line(geometry,new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false }));
          measureLine.renderOrder = 110;
          scene.add(measureLine);
          setMeasurement(`${distance.toFixed(1)} m`);
          measureStart = null;
        }
        return;
      }
      const hits = raycaster.intersectObject(model.root,true).filter(hit => {
        let object: THREE.Object3D | null = hit.object;
        while (object) { if (!object.visible) return false; object = object.parent; }
        return true;
      });
      if (hits[0]?.object.userData.layer) latest.current.onSelect(hits[0].object.userData.layer);
    };
    renderer.domElement.addEventListener('pointerdown',onPointerDown);
    renderer.domElement.addEventListener('pointermove',onPointerMove);
    renderer.domElement.addEventListener('pointerup',onPointerUp);
    const onControlsStart = () => { transition = null; };
    controls.addEventListener('start',onControlsStart);

    runtime.current = {
      model, renderer, setView, setTool, apply, setSource, reset, focus, fly, clearMeasurement,
      toggleDrive, teleportCar, setMapGrid,
      zoom: direction => {
        if (flying || drive.active) return;
        animateTo(controls.target.clone(),THREE.MathUtils.clamp(camera.zoom*(direction>0?1.3:1/1.3),0.45,9),camera.position.clone());
      },
    };
    apply(latest.current.settings);
    setView(latest.current.view);
    if (latest.current.source) setSource(latest.current.source);
    let objectCount = 0;
    model.root.traverse(object => { if (object instanceof THREE.Mesh) objectCount++; });
    latest.current.onStats({ triangles: model.triangles, objects: objectCount });
    let previousTime = performance.now();
    let frames = 0;
    const animate = (time: number) => {
      frame = requestAnimationFrame(animate);
      const delta = Math.min((time-previousTime)/1000,0.05);
      previousTime = time;
      if (transition) {
        const progress = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : Math.min((time-transition.start)/750,1);
        const ease = 1-Math.pow(1-progress,4);
        camera.position.lerpVectors(transition.fromPosition,transition.toPosition,ease);
        controls.target.lerpVectors(transition.fromTarget,transition.toTarget,ease);
        camera.zoom = THREE.MathUtils.lerp(transition.fromZoom,transition.toZoom,ease);
        camera.updateProjectionMatrix();
        if (progress === 1) transition = null;
      }
      if (flying) {
        const speed = delta*(keys.has('ShiftLeft')?190:75);
        const direction = camera.getWorldDirection(new THREE.Vector3());
        const right = new THREE.Vector3().crossVectors(direction,camera.up).normalize();
        if (keys.has('KeyW')) camera.position.addScaledVector(direction,speed);
        if (keys.has('KeyS')) camera.position.addScaledVector(direction,-speed);
        if (keys.has('KeyD')) camera.position.addScaledVector(right,speed);
        if (keys.has('KeyA')) camera.position.addScaledVector(right,-speed);
        if (keys.has('KeyE')) camera.position.y += speed;
        if (keys.has('KeyQ')) camera.position.y -= speed;
        const groundY = model.sampleHeight(camera.position.x + REFERENCE.originX, camera.position.z + REFERENCE.originY, latest.current.settings.terrainHeight);
        camera.position.y = Math.max(camera.position.y, Math.max(groundY, latest.current.settings.waterLevel) + 2.5);
      } else if (drive.active) {
        // Arcade car: accelerate, steer, brake; follows the terrain and can't climb into the sea.
        const th = latest.current.settings.terrainHeight;
        const waterLevel = latest.current.settings.waterLevel;
        const fwd = keys.has('KeyW') || keys.has('ArrowUp');
        const back = keys.has('KeyS') || keys.has('ArrowDown');
        const steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
        const brake = keys.has('Space');
        // Use the same road/deck profile as the rendered network, including its clearance.
        const driveHeight = (wx: number, wz: number) => {
          const t = model.sampleHeight(wx + REFERENCE.originX, wz + REFERENCE.originY, th);
          const r = model.sampleRoadHeight(wx + REFERENCE.originX, wz + REFERENCE.originY, th);
          return r === null ? t : Math.max(t, r);
        };
        const hHere = driveHeight(drive.x, drive.z);
        const inWater = hHere <= waterLevel + 0.05;
        if (brake) {
          drive.speed = Math.abs(drive.speed) < 0.6 ? 0 : drive.speed - Math.sign(drive.speed) * 30 * delta;
        } else if (!inWater) {
          if (fwd) drive.speed += 16 * delta;
          if (back) drive.speed -= 10 * delta;
        }
        if (inWater) drive.speed *= Math.max(0, 1 - 5 * delta);
        drive.speed -= drive.speed * 1.1 * delta;
        drive.speed = THREE.MathUtils.clamp(drive.speed, -8, 28);
        if (!fwd && !back && !brake && Math.abs(drive.speed) < 0.08) drive.speed = 0;
        drive.heading += steer * 2.0 * delta * THREE.MathUtils.clamp(drive.speed / 7, -1, 1);
        drive.x += Math.cos(drive.heading) * drive.speed * delta;
        drive.z += Math.sin(drive.heading) * drive.speed * delta;
        const clampedX = THREE.MathUtils.clamp(drive.x, -503, 495);
        const clampedZ = THREE.MathUtils.clamp(drive.z, -549, 529);
        if (clampedX !== drive.x || clampedZ !== drive.z) drive.speed = 0;
        drive.x = clampedX;
        drive.z = clampedZ;
        const hF = driveHeight(drive.x + Math.cos(drive.heading) * 2.5, drive.z + Math.sin(drive.heading) * 2.5);
        const hR = driveHeight(drive.x - Math.sin(drive.heading) * 2.5, drive.z + Math.cos(drive.heading) * 2.5);
        car.group.position.set(drive.x, hHere, drive.z);
        car.group.rotation.y = -drive.heading;
        car.inner.rotation.x = -Math.atan2(hR - hHere, 2.5);
        car.inner.rotation.z = Math.atan2(hF - hHere, 2.5);
        car.wheels.forEach(wheel => { wheel.rotation.y -= (drive.speed / 0.36) * delta; });
        const desired = new THREE.Vector3(drive.x - Math.cos(drive.heading) * 16, hHere + 8.5, drive.z - Math.sin(drive.heading) * 16);
        camera.position.lerp(desired, 1 - Math.exp(-delta * 6));
        camera.lookAt(drive.x, hHere + 1.8, drive.z);
        if (speedRef.current) speedRef.current.textContent = `${Math.round(Math.abs(drive.speed) * 3.6)} km/h`;
        minimapRef.current?.draw(drive.x, drive.z, drive.heading);
      } else controls.update();
      renderer.render(scene,camera);
      if(!flying && !drive.active && scaleLine.current && scaleText.current) {
        const metersPerPixel = (orthographic.right-orthographic.left)/orthographic.zoom/width;
        const target = metersPerPixel*60;
        const power = Math.pow(10,Math.floor(Math.log10(target)));
        const magnitude = target/power;
        const meters = (magnitude>=5?5:magnitude>=2?2:1)*power;
        scaleLine.current.style.width = `${meters/metersPerPixel}px`;
        scaleText.current.textContent = `${meters<1?meters.toFixed(1):meters} m`;
      }
      districts.forEach(district => {
        const element = labels.current[district.id];
        if (!element) return;
        const visible = latest.current.settings.labels && latest.current.settings.visibility.buildings && latest.current.settings.visibility[district.id] && !flying && !drive.active && currentView !== 'compare';
        const point = worldPoint(...district.label,district.id === 'lighthouse'?72:55).project(camera);
        const x = (point.x+1)/2*width;
        const y = (-point.y+1)/2*height;
        element.style.display = visible && x>35 && x<width-30 && y>30 && y<height-55 ? 'flex' : 'none';
        element.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      });
      frames++;
      if (frames === 3) setReady(true);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      resizeObserver.disconnect();
      controls.dispose();
      document.removeEventListener('keydown',onKeyDown);
      document.removeEventListener('keyup',onKeyUp);
      document.removeEventListener('mousemove',onMouseMove);
      document.removeEventListener('pointerlockchange',onLockChange);
      window.removeEventListener('blur',onBlur);
      renderer.domElement.removeEventListener('pointerdown',onPointerDown);
      renderer.domElement.removeEventListener('pointermove',onPointerMove);
      renderer.domElement.removeEventListener('pointerup',onPointerUp);
      model.dispose();
      grid.geometry.dispose();
      gridMaterial.dispose();
      if (mapGrid) { mapGrid.geometry.dispose(); (mapGrid.material as THREE.Material).dispose(); }
      car.group.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
      if (referencePlane) { referencePlane.geometry.dispose(); referencePlane.material.map?.dispose(); referencePlane.material.dispose(); }
      if (measureLine) { measureLine.geometry.dispose(); (measureLine.material as THREE.Material).dispose(); }
      sunlight.shadow.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);

  useEffect(() => { runtime.current?.apply(props.settings); }, [props.settings]);
  useEffect(() => { runtime.current?.setView(props.view); }, [props.view]);
  useEffect(() => { runtime.current?.setTool(props.tool); }, [props.tool,props.view]);
  useEffect(() => { runtime.current?.setSource(props.source); }, [props.source]);

  return (
    <div className={`map-viewport ${ready?'is-ready':''} ${props.view==='compare'?'is-comparing':''}`}>
      <div className="webgl-host" ref={host} />
      {unavailable && <div className="webgl-fallback"><ReferenceMap full /><div><strong>2D layout preview</strong><span>WebGL is unavailable in this browser. Try a hardware-accelerated browser for 3D navigation and model export.</span></div></div>}
      {!ready && !unavailable && <div className="viewport-loading"><div className="loading-cube"/><span>Building your island</span><small>Tracing geometry into a navigable world</small></div>}
      <div className="viewport-heading"><span className="viewport-eyebrow"><span className="tiny-live-dot"/> LIVE MAP</span><h1>{props.projectName}<span>/</span><small>Coastal Map</small></h1><p>Stylized game-ready coastal town</p></div>
      <div className="district-labels">
        {districts.map(district => <button key={district.id} ref={element => { labels.current[district.id] = element; }} className={`district-label ${props.selected===district.id?'is-selected':''}`} onClick={() => { props.onSelect(district.id); runtime.current?.focus(district.id); }} title={`Focus ${district.name}`}><span className="label-dot"/>{district.name}<MoveUpRight size={10}/></button>)}
      </div>
      <div className="view-gizmo">
        <button className="gizmo-north" onClick={() => props.onViewChange('top')} title="Align to north">N</button>
        <button className="gizmo-cube" onClick={() => { props.onViewChange('3d'); runtime.current?.reset(); }} title="Reset isometric view">
          <svg width="72" height="71" viewBox="0 0 72 71" fill="none"><path d="M36 7 61 21 36 36 11 21Z" fill="#e0e8df" stroke="#69867e"/><path d="M11 21 36 36 36 64 11 49Z" fill="#b8cdc1" stroke="#69867e"/><path d="M36 36 61 21 61 49 36 64Z" fill="#d2dfd3" stroke="#69867e"/><text x="36" y="25" fill="#577269" fontSize="8" textAnchor="middle">TOP</text><path d="M36 3V0M4 52 1 54M66 52 70 54" stroke="#526e64" strokeWidth="1.5"/><text x="18" y="44" fill="#577269" fontSize="7" transform="rotate(30 18 44)">Z</text><text x="48" y="44" fill="#577269" fontSize="7" transform="rotate(-30 48 44)">X</text></svg>
        </button>
      </div>
      {props.view==='compare' && <div className="comparison-panel">
        <div className="comparison-heading"><span className="compare-indicator"/><strong>Reference alignment</strong><span className="mini-tag">ORTHOGRAPHIC</span></div>
        {props.source ? <><p>Source image is locked to the original 1,448 x 1,086 coordinate plane.</p><div className="overlay-range"><span>3D map</span><input aria-label="Reference image opacity" type="range" min="0" max="1" step="0.01" value={props.settings.referenceOpacity} onChange={e=>props.onOpacity(Number(e.target.value))}/><span>Source image</span><b>{Math.round(props.settings.referenceOpacity*100)}%</b></div></> : <><p>Link the original image to inspect coastline, roads, and district alignment. The thumbnail is a traced guide, not the source image.</p><button className="button-mint small" onClick={props.onUpload}><Upload size={14}/>Link original image</button></>}
      </div>}
      {props.tool==='measure' && <div className="measure-readout"><Crosshair size={14}/>{measurement || 'Click two points to measure'}<span>1 px = 1 m</span><button onClick={()=>runtime.current?.clearMeasurement()} aria-label="Clear measurement"><X size={12}/></button></div>}
      {flyActive && <div className="fly-instructions"><span className="tiny-live-dot"/>FLY MODE <kbd>W A S D</kbd> move <kbd>Q / E</kbd> elevation <kbd>Shift</kbd> faster <kbd>Esc</kbd> exit</div>}
      {driveActive && <div className="fly-instructions drive-hint"><span className="tiny-live-dot"/>DRIVE MODE <kbd>W A S D / arrows</kbd> drive <kbd>Space</kbd> brake <kbd>Esc</kbd> exit <span ref={speedRef} className="drive-speed">0 km/h</span></div>}
      <MiniMap ref={minimapRef} waterColor={props.settings.colors.water} onTeleport={(x,z) => runtime.current?.teleportCar(x,z)} />
      <div className="viewport-bottom">
        <div className={`scale-marker ${flyActive?'scale-hidden':''}`}><span>0</span><div ref={scaleLine}/><span ref={scaleText}>50 m</span><small>ASSUMED SCALE</small></div>
        <div className="navigation-hint"><span className="mouse-outline"/><span>Drag to orbit</span><i/><span>Right-drag to pan</span><i/><span>Scroll to zoom</span></div>
        <div className="zoom-controls"><button onClick={()=>runtime.current?.zoom(-1)} title="Zoom out"><Minus size={15}/></button><button onClick={()=>runtime.current?.reset()} title="Frame island (F)"><Focus size={16}/></button><button onClick={()=>runtime.current?.zoom(1)} title="Zoom in"><Plus size={15}/></button></div>
      </div>
      <span className="viewport-watermark">ISLANDFORGE <span>STUDIO</span></span>
      <span className="sr-only">{buildings.length} building masses. Reference alignment is not yet verified.</span>
    </div>
  );
});