import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpRight, Box, Boxes, Building2, Camera, Car, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Compass, Copy, Download, Eye, EyeOff, FileImage, FileJson, Focus, Grid2X2, Hand, Image, Landmark, Layers3, Link2, LockKeyhole, Maximize, Minimize, Mountain, MousePointer2, Navigation, PanelLeft, PanelRight, PanelsTopLeft, Redo2, Rocket, Rotate3D, Ruler, Save, ScanLine, Search, Settings2, ShieldCheck, Ship, SlidersHorizontal, Sun, Undo2, Waves, X } from 'lucide-react';
import { MapViewport, type ToolMode, type ViewMode, type ViewportHandle } from './MapViewport';
import { ReferenceMap } from './ReferenceMap';
import { IconButton, Modal, RangeControl, Toggle } from './components';
import { loadReference, saveReference } from './referenceStorage';
import { beachCoast, buildings, defaultSettings, districts, eyerShoals, fortCoast, layerNames, mainCoast, piers, portAprons, portChannelCenterline, portCoast, REFERENCE, roads, type LayerId, type SceneSettings } from './mapData';

const STORAGE_KEY = 'islandforge-coastal-v2';
function loadProject(): { settings: SceneSettings; name: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const candidate = saved.settings || {};
    return {
      name: typeof saved.name === 'string' && saved.name.trim() ? saved.name.slice(0,48) : 'Coastal Island',
      // The draped 3D grid is forced off: at terrain height it read as stray white
      // lines across roads, the port and slopes. The minimap grid is unaffected.
      settings: { ...defaultSettings, ...candidate, mapGrid: false, visibility: { ...defaultSettings.visibility,...candidate.visibility }, colors: { ...defaultSettings.colors,...candidate.colors } },
    };
  } catch { return { settings: defaultSettings, name: 'Coastal Island' }; }
}

const counts: Partial<Record<LayerId, number>> = {
  terrain: 4, roads: roads.filter(r=>!r.bridge).length, bridges: roads.filter(r=>r.bridge).length,
  buildings: buildings.length+2, ...Object.fromEntries(districts.map(d=>[d.id,d.id==='lighthouse'?1:buildings.filter(b=>b.district===d.id).length+(d.id==='downtown'?1:0)])), water: 2,
};
const layerIcons: Record<LayerId, ReactNode> = {
  terrain: <Mountain size={15}/>, roads: <Navigation size={15}/>, bridges: <ArrowLeftRight size={15}/>, buildings: <Building2 size={15}/>,
  downtown: <Building2 size={14}/>, north: <Boxes size={14}/>, port: <Ship size={14}/>, beach: <Waves size={14}/>, lighthouse: <Compass size={14}/>, fort: <Landmark size={14}/>, spaceport: <Rocket size={14}/>, water: <Waves size={15}/>, reference: <FileImage size={15}/>,
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),10000);
}

export default function App() {
  const [initial] = useState(loadProject);
  const [projectName, setProjectName] = useState(initial.name);
  const [history, setHistory] = useState<{ past: SceneSettings[]; current: SceneSettings; future: SceneSettings[] }>({ past: [], current: initial.settings, future: [] });
  const settings = history.current;
  const [view, setView] = useState<ViewMode>('3d');
  const [tool, setTool] = useState<ToolMode>('orbit');
  const [selected, setSelected] = useState<LayerId>('terrain');
  const [expanded, setExpanded] = useState(true);
  const [worldExpanded, setWorldExpanded] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [leftClosed, setLeftClosed] = useState(true);
  const [rightClosed, setRightClosed] = useState(true);
  const [source, setSource] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceDimensions, setSourceDimensions] = useState({ width: 1448, height: 1086 });
  const [reviewed, setReviewed] = useState(false);
  const [reviewChecks, setReviewChecks] = useState([false,false,false,false]);
  const [modal, setModal] = useState<'export'|'help'|'rename'|'review'|null>(null);
  const [menu, setMenu] = useState<'project'|'camera'|null>(null);
  const [renamed, setRenamed] = useState(projectName);
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [toast, setToast] = useState('');
  const [stats, setStats] = useState({ triangles: 0, objects: 0 });
  const [coordinates, setCoordinates] = useState({ x: 0, z: 0 });
  const [flying, setFlying] = useState(false);
  const [driving, setDriving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'glb'|'obj'|'json'>('glb');
  const [exportUnits, setExportUnits] = useState<'m'|'cm'>('m');
  const [includeWater, setIncludeWater] = useState(true);
  const [visibleOnly, setVisibleOnly] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const viewport = useRef<ViewportHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const centerPanel = useRef<HTMLElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if(toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(''),4200);
  },[]);
  const update = useCallback((patch: Partial<SceneSettings>) => {
    setHistory(previous => {
      const current = { ...previous.current,...patch };
      if(JSON.stringify(current)===JSON.stringify(previous.current)) return previous;
      return { past: [...previous.past.slice(-59),previous.current],current,future: [] };
    });
    if(patch.terrainHeight!==undefined || patch.buildingScale!==undefined || patch.waterLevel!==undefined) {
      setReviewed(false);
      setReviewChecks([false,false,false,false]);
    }
  },[]);
  const undo = useCallback(()=>setHistory(previous=>previous.past.length ? { past: previous.past.slice(0,-1),current: previous.past[previous.past.length-1],future: [previous.current,...previous.future] } : previous),[]);
  const redo = useCallback(()=>setHistory(previous=>previous.future.length ? { past: [...previous.past,previous.current],current: previous.future[0],future: previous.future.slice(1) } : previous),[]);

  useEffect(()=>{
    setSaved(false);
    const timer = setTimeout(()=>{
      try { localStorage.setItem(STORAGE_KEY,JSON.stringify({ name: projectName,settings })); setSaved(true); setSaveError(false); }
      catch { setSaveError(true); }
    },500);
    return ()=>clearTimeout(timer);
  },[settings,projectName]);
  useEffect(()=>()=>{ if(toastTimer.current) clearTimeout(toastTimer.current); },[]);
  useEffect(()=>{
    let active = true;
    loadReference().then(reference=>{
      if(!active || !reference) return;
      setSource(reference.data);
      setSourceName(reference.name);
      setSourceDimensions({width:reference.width,height:reference.height});
    }).catch(()=>{});
    return ()=>{active=false;};
  },[]);

  useEffect(()=>{
    const handler = (event: KeyboardEvent) => {
      if((event.target as HTMLElement)?.closest('input,textarea,select')) return;
      if(event.key==='Escape') { setModal(null); setMenu(null); }
      if(modal || flying || driving) return;
      if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='s') { event.preventDefault(); notify('Project settings are saved automatically on this device.'); return; }
      if(event.ctrlKey || event.metaKey || event.altKey) return;
      switch(event.key.toLowerCase()) {
        case '1': setView('3d'); break;
        case '2': setView('top'); break;
        case '3': setView('compare'); break;
        case 'v': setTool('select'); break;
        case 'o': setTool('orbit'); break;
        case 'h': setTool('pan'); break;
        case 'm': setTool('measure'); break;
        case 'f': viewport.current?.reset(); break;
        case 'g': update({ mapGrid: !settings.mapGrid }); break;
        case 'l': update({ labels: !settings.labels }); break;
        case 'c': viewport.current?.drive(); break;
        case '?': setModal('help'); break;
      }
    };
    window.addEventListener('keydown',handler);
    return ()=>window.removeEventListener('keydown',handler);
  },[modal,flying,driving,settings,update,undo,redo,notify]);
  useEffect(()=>{
    const handler = ()=>setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange',handler);
    return ()=>document.removeEventListener('fullscreenchange',handler);
  },[]);

  const toggleLayer = (id: LayerId) => {
    if(id==='reference' && !source) { setView('compare'); fileInput.current?.click(); return; }
    update({ visibility: { ...settings.visibility,[id]: !settings.visibility[id] } });
  };
  const importSource = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if(!file) return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)) { notify('Choose a PNG, JPG, or WebP reference image.'); return; }
    if(file.size>20*1024*1024) { notify('Please choose an image smaller than 20 MB.'); return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      const result = String(reader.result);
      const image = new window.Image();
      image.onload = ()=>{
        if(Math.abs(image.naturalWidth/image.naturalHeight-1448/1086)>0.005) { notify('Use the uncropped 4:3 source image so the reference coordinates align.'); return; }
        setSource(result); setSourceName(file.name);
        setSourceDimensions({ width: image.naturalWidth,height: image.naturalHeight });
        saveReference({data:result,name:file.name,width:image.naturalWidth,height:image.naturalHeight}).catch(()=>notify('Reference linked for this session. Browser storage is unavailable for this image.'));
        setReviewed(false); setReviewChecks([false,false,false,false]);
        setView('compare');
        update({ visibility: { ...settings.visibility,reference: true } });
        notify('Source linked and locked to the original image coordinates.');
      };
      image.onerror = ()=>notify('This file could not be decoded as an image.');
      image.src = result;
    };
    reader.onerror = ()=>notify('The reference file could not be read.');
    reader.readAsDataURL(file);
  };
  const takeScreenshot = ()=>{
    const data = viewport.current?.screenshot();
    if(!data) { notify('The 3D viewport is not ready for capture.'); return; }
    const anchor = document.createElement('a'); anchor.href = data; anchor.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-viewport.png`; anchor.click();
    notify('Viewport snapshot downloaded.');
  };
  const toggleFullscreen = async()=>{
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else if(centerPanel.current?.requestFullscreen) await centerPanel.current.requestFullscreen();
      else notify('Fullscreen is not supported by this browser.');
    } catch { notify('Fullscreen is unavailable in this browser context.'); }
  };
  const exportProject = async()=>{
    setExporting(true); setExportError('');
    try {
      let blob: Blob;
      if(exportFormat==='json') {
        blob = new Blob([JSON.stringify({ version: 1,name: projectName,reference: { ...REFERENCE,sourceLinked: !!source,sourceName: sourceName || null,alignmentStatus: reviewed?'Manually reviewed by user':'Unverified manual coordinate trace' },units: 'reference-image pixels',assumedMetersPerPixel: 1,geometry: { mainCoast,portCoast,portChannelCenterline,beachCoast,fortCoast,eyerShoals,portAprons,roads,piers,buildings },settings },null,2)],{ type: 'application/json' });
      } else {
        if(!viewport.current) throw new Error('Wait for the 3D viewport to load.');
        blob = await viewport.current.exportModel(exportFormat,exportUnits,includeWater,visibleOnly);
      }
      downloadBlob(blob,`${projectName.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-coastal-map.${exportFormat}`);
      setModal(null); notify(`${exportFormat.toUpperCase()} coastal map exported.`);
    } catch(error) { setExportError(error instanceof Error?error.message:'Export failed. Please try again.'); }
    finally { setExporting(false); }
  };

  const layerRow = (id: LayerId, child = false) => {
    if(query && !layerNames[id].toLowerCase().includes(query.toLowerCase())) return null;
    return <div key={id} className={`layer-row ${selected===id?'selected':''} ${child?'is-child':''} ${!settings.visibility[id]?'is-hidden':''}`}>
      {id==='buildings' ? <button className="layer-disclosure" onClick={()=>setExpanded(!expanded)} aria-label={expanded?'Collapse building layers':'Expand building layers'}>{expanded?<ChevronDown size={12}/>:<ChevronRight size={12}/>}</button> : <span className="layer-spacer"/>}
      <button className="layer-select" onClick={()=>setSelected(id)} onDoubleClick={()=>viewport.current?.focus(id)}>{layerIcons[id]}<span>{layerNames[id]}</span>{counts[id]!==undefined && <small>{counts[id]}</small>}</button>
      {id==='reference' && <LockKeyhole className="layer-lock" size={11}/>}
      <button className="layer-visibility" onClick={()=>toggleLayer(id)} aria-label={`${settings.visibility[id]?'Hide':'Show'} ${layerNames[id]}`} title={`${settings.visibility[id]?'Hide':'Show'} ${layerNames[id]}`}>{settings.visibility[id]?<Eye size={13}/>:<EyeOff size={13}/>}</button>
    </div>;
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#" onClick={event=>{event.preventDefault();setView('3d');viewport.current?.reset();}} aria-label="Islandforge home"><span className="brand-mark"><svg width="29" height="31" viewBox="0 0 29 31" fill="none"><path d="M14.5 1 27 8.2V22.7L14.5 30 2 22.7V8.2Z" stroke="currentColor" strokeWidth="1.5"/><path d="M2 8.2 14.5 15.5 27 8.2M14.5 15.5V30M8 11.7V19.3L14.5 23 21 19.3V11.7M8 4.8 21 12.2" stroke="currentColor" strokeWidth="1.5"/></svg></span><span>islandforge<span className="brand-period">.</span></span></a>
        <div className="header-divider"/>
        <div className="project-breadcrumb"><span className="workspace-word">Workspace</span><ChevronRight size={12}/><div className="menu-anchor"><button className={`project-trigger ${menu==='project'?'active':''}`} onClick={()=>setMenu(menu==='project'?null:'project')}>{projectName}<ChevronDown size={12}/></button>{menu==='project' && <><button className="menu-dismiss" onClick={()=>setMenu(null)} aria-label="Close project menu"/><div className="popover project-menu"><span className="popover-label">PROJECT ACTIONS</span><button onClick={()=>{setRenamed(projectName);setModal('rename');setMenu(null);}}><Settings2 size={14}/>Rename project</button><button onClick={()=>{fileInput.current?.click();setMenu(null);}}><Link2 size={14}/>Link reference image</button><button onClick={()=>{takeScreenshot();setMenu(null);}}><Camera size={14}/>Save viewport image</button><div className="popover-rule"/><button onClick={()=>{update(defaultSettings);setMenu(null);notify('Scene display settings restored. Undo to recover your changes.');}}><Rotate3D size={14}/>Restore default settings</button></div></>}</div><span className="project-version">v.01</span></div>
        <div className="header-actions"><span className={`save-status ${saveError?'save-error':''}`}>{saveError?<ShieldCheck size={13}/>:saved?<CheckCheck size={14}/>:<Save size={13}/>}<span>{saveError?'Session only':saved?'All changes saved':'Saving changes'}</span></span><div className="history-actions"><IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!history.past.length}><Undo2 size={16}/></IconButton><IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!history.future.length}><Redo2 size={16}/></IconButton></div><button className="button-mint export-button" onClick={()=>{setExportError('');setModal('export');}}><ArrowDownToLine size={15}/><span>Export map</span><ChevronDown size={12}/></button><button className="avatar" onClick={()=>setModal('help')} title="Workspace guide">IF</button></div>
      </header>

      <div className={`workspace-grid ${leftClosed?'hide-left':''} ${rightClosed?'hide-right':''}`}>
        <aside className="scene-panel">
          <div className="panel-heading"><h2>Scene <span>01</span></h2><div><IconButton label="Search layers" active={searchOpen} onClick={()=>{setSearchOpen(!searchOpen);setQuery('');}}><Search size={15}/></IconButton><IconButton label="Collapse scene panel" onClick={()=>setLeftClosed(true)}><PanelLeft size={15}/></IconButton></div></div>
          {searchOpen && <div className="layer-search"><Search size={13}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a layer..." aria-label="Search scene layers"/><button onClick={()=>{setQuery('');setSearchOpen(false);}} aria-label="Clear search"><X size={12}/></button></div>}
          <div className="scene-tree"><button className="scene-root" onClick={()=>setWorldExpanded(!worldExpanded)}>{worldExpanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<Box size={16}/><span>{projectName}</span><LockKeyhole size={11}/></button>
            {(worldExpanded || query) && <div className="world-layers">{layerRow('terrain')}{layerRow('roads')}{layerRow('bridges')}{layerRow('buildings')}{(expanded || query) && <div className="district-tree">{(['downtown','north','port','beach','lighthouse','fort','spaceport'] as LayerId[]).map(id=>layerRow(id,true))}</div>}{layerRow('water')}{layerRow('reference')}</div>}
            {query && !Object.values(layerNames).some(name=>name.toLowerCase().includes(query.toLowerCase())) && <p className="empty-search">No layers match "{query}".</p>}
          </div>
          <div className="scene-tree-hint"><span className="tiny-mint-square"/>Layout locked to reference coordinates</div>
          <div className="reference-section"><div className="section-title"><span>LAYOUT REFERENCE</span><LockKeyhole size={12}/></div><button className="reference-preview" onClick={()=>setView('compare')} title="Open top-down reference comparison">{source?<img src={source} alt="Locked original island map reference"/>:<ReferenceMap full/>}<span className="reference-preview-tag">{source?'SOURCE IMAGE':'TRACED GUIDE'}</span><span className="reference-expand"><Maximize size={12}/></span></button><div className="reference-file"><FileImage size={15}/><div><strong>{source?sourceName:'island-layout.trace'}</strong><span>{sourceDimensions.width.toLocaleString()} x {sourceDimensions.height.toLocaleString()} px <i/> {source?'Locked':'Coordinate guide'}</span></div><span className="reference-file-dot"/></div><button className="link-reference" onClick={()=>fileInput.current?.click()}><Link2 size={13}/>{source?'Replace source image':'Link original image'}<ArrowUpRight size={12}/></button></div>
          <div className="scene-panel-bottom"><span className="tiny-live-dot"/>Local workspace<IconButton label="Workspace shortcuts and guide" onClick={()=>setModal('help')}><CircleHelp size={15}/></IconButton></div>
        </aside>

        <main className="center-panel" ref={centerPanel}>
          <div className="viewport-toolbar"><div className="view-tabs">{leftClosed && <IconButton label="Show scene panel" onClick={()=>setLeftClosed(false)}><PanelLeft size={15}/></IconButton>}<button className={view==='3d'?'active':''} onClick={()=>setView('3d')} title="3D view (1)"><Box size={14}/><span>3D View</span></button><button className={view==='top'?'active':''} onClick={()=>setView('top')} title="Top orthographic view (2)"><ScanLine size={14}/><span>Top View</span></button><button className={view==='compare'?'active':''} onClick={()=>setView('compare')} title="Reference comparison (3)"><PanelsTopLeft size={14}/><span>Compare</span></button></div><div className="viewport-toolbar-right"><div className="menu-anchor"><button className="camera-trigger" onClick={()=>setMenu(menu==='camera'?null:'camera')}>{flying?'Fly-through':view==='3d'?'Isometric':'Orthographic'}<ChevronDown size={11}/></button>{menu==='camera' && <><button className="menu-dismiss" onClick={()=>setMenu(null)} aria-label="Close camera menu"/><div className="popover camera-menu"><span className="popover-label">CAMERA PRESET</span><button onClick={()=>{setView('3d');viewport.current?.reset();setMenu(null);}}><Box size={14}/>Isometric view<kbd>1</kbd></button><button onClick={()=>{setView('top');setMenu(null);}}><ScanLine size={14}/>Top orthographic<kbd>2</kbd></button><button onClick={()=>{setView('3d');setMenu(null);setTimeout(()=>viewport.current?.fly(),30);}}><Navigation size={14}/>Fly through island</button></div></>}</div><span className="toolbar-divider"/><IconButton label={fullscreen?'Exit fullscreen':'Fullscreen viewport'} onClick={toggleFullscreen}>{fullscreen?<Minimize size={15}/>:<Maximize size={15}/>}</IconButton><IconButton label={rightClosed?'Show inspector':'Hide inspector'} active={!rightClosed} onClick={()=>setRightClosed(!rightClosed)}><PanelRight size={15}/></IconButton></div></div>
          <div className="viewport-container"><MapViewport ref={viewport} projectName={projectName} settings={settings} view={view} tool={tool} source={source} selected={selected} onSelect={setSelected} onStats={setStats} onCoordinates={(x,z)=>setCoordinates({x,z})} onFlyChange={setFlying} onDriveChange={setDriving} onUpload={()=>fileInput.current?.click()} onViewChange={setView} onOpacity={value=>update({referenceOpacity:value})} onNotice={notify}/>
            <div className="tool-palette">{([{id:'select',icon:<MousePointer2 size={17}/>,label:'Select (V)'},{id:'orbit',icon:<Rotate3D size={18}/>,label:'Orbit (O)'},{id:'pan',icon:<Hand size={17}/>,label:'Pan (H)'},{id:'measure',icon:<Ruler size={17}/>,label:'Measure distance (M)'}] as {id:ToolMode;icon:ReactNode;label:string}[]).map(item=><IconButton key={item.id} label={item.label} active={tool===item.id} onClick={()=>setTool(item.id)}>{item.icon}</IconButton>)}<div className="tool-rule"/><IconButton label="Drive mode (C)" active={driving} onClick={()=>viewport.current?.drive()}><Car size={17}/></IconButton><div className="tool-rule"/><IconButton label="Frame entire island (F)" onClick={()=>viewport.current?.reset()}><Focus size={17}/></IconButton><IconButton label="Download viewport snapshot" onClick={takeScreenshot}><Camera size={17}/></IconButton></div>
            {view==='3d' && !flying && !driving && <button className="explore-button" onClick={()=>viewport.current?.fly()}><Navigation size={13}/><span>Explore island</span><kbd>WASD</kbd></button>}
            {view==='top' && <div className="top-view-note"><span className="tiny-live-dot"/>NORTH-ALIGNED <i/> 1 PX = 1 M <span className="subtle">ASSUMED</span></div>}
          </div>
        </main>

        <aside className="inspector-panel"><div className="panel-heading"><h2>Inspector</h2><IconButton label="Hide inspector" onClick={()=>setRightClosed(true)}><SlidersHorizontal size={15}/></IconButton></div><div className="inspector-scroll">
          <div className="selection-summary"><span className="selection-icon">{layerIcons[selected]}</span><div><strong>{layerNames[selected]}</strong><span>{selected==='reference'?'Original image coordinates':`${counts[selected] || 1} ${selected==='terrain'?'landmasses':selected==='roads'?'traced paths':selected==='bridges'?'connections':selected==='water'?'placeholder meshes':'building forms'}`}<i/>Layout locked</span></div><LockKeyhole size={11}/></div>
          <section className="inspector-section shading-section"><div className="section-title"><span>VIEWPORT SHADING</span><Box size={12}/></div><div className="segmented-control">{(['solid','clay','wireframe'] as const).map(mode=><button key={mode} className={settings.renderMode===mode?'active':''} onClick={()=>update({renderMode:mode})}>{mode==='solid'?<Box size={12}/>:mode==='clay'?<Layers3 size={12}/>:<Grid2X2 size={12}/>}<span>{mode==='wireframe'?'Wire':mode.charAt(0).toUpperCase()+mode.slice(1)}</span></button>)}</div></section>
          <section className="inspector-section"><div className="section-title"><span>WORLD GEOMETRY</span><span className="unit-label">METERS</span></div><RangeControl label="Terrain elevation" value={settings.terrainHeight} min={2} max={24} suffix="m" onChange={value=>update({terrainHeight:value})}/><RangeControl label="Building height" value={settings.buildingScale} min={0.5} max={2} step={0.05} suffix="x" onChange={value=>update({buildingScale:value})}/><RangeControl label="Water level" value={settings.waterLevel} min={-3} max={8} step={0.5} suffix="m" onChange={value=>update({waterLevel:value})}/></section>
          <section className="inspector-section materials-section"><div className="section-title"><span>SCENE MATERIALS</span><span className="subtle">4</span></div><div className="material-swatches">{([{id:'terrain',label:'Land tint'},{id:'roads',label:'Roads'},{id:'buildings',label:'Building tint'},{id:'water',label:'Water'}] as const).map(material=><label key={material.id} className="material-swatch"><span style={{backgroundColor:settings.colors[material.id]}}><input aria-label={`${material.label} material color`} type="color" value={settings.colors[material.id]} onChange={e=>update({colors:{...settings.colors,[material.id]:e.target.value}})}/></span><small>{material.label}</small></label>)}</div></section>
          <section className="inspector-section viewport-options"><div className="section-title"><span>DISPLAY OPTIONS</span><Settings2 size={12}/></div><div className="toggle-row"><Sun size={14}/><span>Soft shadows</span><Toggle checked={settings.shadows} label="Soft shadows" onChange={()=>update({shadows:!settings.shadows})}/></div><div className="toggle-row"><Copy size={14}/><span>District labels</span><Toggle checked={settings.labels} label="District labels" onChange={()=>update({labels:!settings.labels})}/></div><div className="toggle-row"><Grid2X2 size={14}/><span>Water grid</span><Toggle checked={settings.grid} label="Water grid" onChange={()=>update({grid:!settings.grid})}/></div><div className="toggle-row"><Grid2X2 size={14}/><span>Map grid (100 m)</span><Toggle checked={settings.mapGrid} label="Map grid" onChange={()=>update({mapGrid:!settings.mapGrid})}/></div></section>
          <section className="inspector-section alignment-section"><div className="section-title"><span>REFERENCE ALIGNMENT</span><ShieldCheck size={12}/></div><div className={`alignment-status ${reviewed?'reviewed':''}`}><span/>{reviewed?'Manually reviewed':source?'Source linked. Ready to review.':'Overlay review pending'}</div><p>{reviewed?'Coastline, roads, bridges, and districts marked as visually reviewed.':'Traced from the supplied layout. Verify against the original before production.'}</p><button className="button-outline comparison-button" onClick={()=>{setView('compare'); if(source)setModal('review');}}>{source?'Review alignment':'Compare with reference'}<ArrowUpRight size={13}/></button></section>
        </div><div className="inspector-bottom"><CheckCircle2 size={17}/><div><strong>Coastal town, game-ready.</strong><span>Preserved layout with refined massing.</span></div></div></aside>
      </div>

      <footer className="status-bar"><div className="status-left"><span className="tiny-live-dot"/><strong>Coastal map workspace</strong><span className="status-separator"/><span>{stats.objects || '...'} meshes</span><span className="status-dot"/><span>{stats.triangles?(stats.triangles/1000).toFixed(1):'...'}k triangles</span></div><div className="status-center"><span>X <b>{coordinates.x.toFixed(1)}</b></span><span>Y <b>{settings.terrainHeight.toFixed(1)}</b></span><span>Z <b>{coordinates.z.toFixed(1)}</b></span></div><div className="status-right"><span>1 unit = 1 m</span><span className="status-separator"/><button onClick={()=>setModal('help')}><CircleHelp size={12}/>Shortcuts <kbd>?</kbd></button></div></footer>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={importSource} aria-label="Import original reference image"/>
      {toast && <div className="toast" role="status"><CheckCircle2 size={16}/><span>{toast}</span><button onClick={()=>setToast('')} aria-label="Dismiss notification"><X size={14}/></button></div>}

      {modal==='export' && <Modal title="Export coastal map" description="Game-ready geometry grouped by district." onClose={()=>!exporting && setModal(null)}><div className="export-project-preview"><span className="export-preview-icon"><Boxes size={29}/></span><div><strong>{projectName}</strong><span>{buildings.length+2} masses <i/> 4 islands <i/> {counts.bridges} bridges</span></div><span className="export-version">v.01</span></div><div className="modal-section-label">FILE FORMAT</div><div className="export-formats">{([{id:'glb',title:'glTF Binary',extension:'.glb',description:'Geometry + materials',icon:<Box size={20}/>},{id:'obj',title:'Wavefront',extension:'.obj',description:'Geometry only',icon:<Layers3 size={20}/>},{id:'json',title:'Layout data',extension:'.json',description:'Trace + settings',icon:<FileJson size={20}/>} ] as const).map(format=><button key={format.id} className={exportFormat===format.id?'selected':''} onClick={()=>setExportFormat(format.id)}><div>{format.icon}<span className="format-radio">{exportFormat===format.id && <Check size={10}/>}</span></div><strong>{format.title}</strong><b>{format.extension}</b><small>{format.description}</small></button>)}</div>{exportFormat!=='json' && <><div className="export-unit-row"><div><strong>Export units</strong><span>Game scale assumes 1 reference pixel = 1 meter.</span></div><select aria-label="Export units" value={exportUnits} onChange={e=>setExportUnits(e.target.value as 'm'|'cm')}><option value="m">Meters (m)</option><option value="cm">Centimeters (cm)</option></select></div><div className="export-toggle-row"><span>Visible layers only</span><Toggle label="Export visible layers only" checked={visibleOnly} onChange={()=>setVisibleOnly(!visibleOnly)}/></div><div className="export-toggle-row"><span>Include placeholder water</span><Toggle label="Include placeholder water in export" checked={includeWater} onChange={()=>setIncludeWater(!includeWater)}/></div></>}<div className="export-note"><ShieldCheck size={16}/><p>Meshes are grouped by layer and district. Reference overlays, labels, and the viewport grid are not exported.{!reviewed && <span>Pixel-level layout alignment has not been verified.</span>}</p></div>{exportError && <p className="export-error" role="alert">{exportError}</p>}<div className="modal-footer"><button className="button-outline" onClick={()=>setModal(null)} disabled={exporting}>Cancel</button><button className="button-mint" onClick={exportProject} disabled={exporting}>{exporting?<span className="button-spinner"/>:<Download size={15}/>}<span>{exporting?'Preparing geometry...':`Export ${exportFormat.toUpperCase()}`}</span><ArrowUpRight size={14}/></button></div></Modal>}

      {modal==='rename' && <Modal title="Name your island" description="Keep your workspace easy to find." onClose={()=>setModal(null)}><form onSubmit={event=>{event.preventDefault();if(renamed.trim()){setProjectName(renamed.trim());setModal(null);notify('Project renamed.');}}}><label className="modal-section-label" htmlFor="project-name">PROJECT NAME</label><input autoFocus id="project-name" className="text-input" value={renamed} maxLength={48} onChange={e=>setRenamed(e.target.value)} required/><div className="modal-footer"><button type="button" className="button-outline" onClick={()=>setModal(null)}>Cancel</button><button className="button-mint" type="submit">Save name<Check size={14}/></button></div></form></Modal>}

          {modal==='help' && <Modal title="Make yourself at home." description="Your reference, translated into a navigable world." onClose={()=>setModal(null)}><div className="shortcut-list">{[['Orbit the island','Left-drag'],['Pan the viewport','Right-drag'],['Zoom in or out','Scroll'],['Frame entire island','F'],['3D / Top / Compare','1 / 2 / 3'],['Select / Orbit / Pan / Measure','V / O / H / M'],['Toggle map grid / District labels','G / L'],['Drive mode / Drive, brake','C / WASD, Space'],['Undo / Redo','Ctrl Z / Ctrl Shift Z'],['Fly navigation / Elevation','WASD / Q E'],['Exit fly or drive mode','Esc']].map(([label,key])=><div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><div className="help-note"><Image size={18}/><div><strong>A note on the reference</strong><p>The map preserves your original island footprint via a coordinate trace of the supplied layout, then refines terrain, coast, districts, roads, and massing. Link the original, uncropped image in Compare to verify alignment. Building heights and a 1 px = 1 m game scale are assumptions.</p></div></div><div className="help-note"><Car size={18}/><div><strong>Location grid and coordinates</strong><p>The map is divided into 100 m cells labelled A-J across and 1-11 down. The minimap in the top-right shows the grid, your car, and the current cell. Copy the coordinates next to it and paste them to me to pinpoint an area for micro changes — the copied text includes the grid cell, world metres, and image pixels.</p></div></div><div className="modal-footer"><span className="subtle">Settings save locally in your browser.</span><button className="button-mint" onClick={()=>setModal(null)}>Back to the island<ArrowRight size={14}/></button></div></Modal>}

      {modal==='review' && <Modal title="Review the reference" description="Check the locked overlay from the top-down view." onClose={()=>setModal(null)}><p className="review-intro">Use the opacity slider in Compare to cross-check each traced layer. Only mark a check after visually reviewing it. This records your review, not an automated accuracy score.</p><div className="review-list">{['Coastline and island proportions','Road curves, widths, and intersections','Bridge positions and shoreline connections','District footprints and building zones'].map((label,index)=><label key={label}><input type="checkbox" checked={reviewChecks[index]} onChange={()=>setReviewChecks(previous=>previous.map((value,i)=>i===index?!value:value))}/><span>{label}</span></label>)}</div><div className="modal-footer"><button className="button-outline" onClick={()=>setModal(null)}>Continue comparing</button><button className="button-mint" disabled={!reviewChecks.every(Boolean)} onClick={()=>{setReviewed(true);setModal(null);notify('Your manual alignment review has been recorded for this session.');}}><CheckCheck size={14}/>Record review</button></div></Modal>}
    </div>
  );
}
