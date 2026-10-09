import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatCoords, GRID_CELL, GRID_COLS, GRID_ROWS, GRID_X0, GRID_Z0, gridRef, imageToWorld, roads } from './mapData';
import { mapOutlines, samplePath } from './mapEngine';

export interface MiniMapHandle {
  draw: (worldX: number | null, worldZ: number | null, heading: number) => void;
}

const W = 172;
const H = 154;
// Framed to include both Fort Island (A1/A2, north-west) and the A9/A10
// Eyer Shoals (south-west) with margin, so nothing is clipped at the edges.
const DOM_X0 = -565, DOM_X1 = 520, DOM_Z0 = -575, DOM_Z1 = 690;

interface Props {
  waterColor: string;
  onTeleport: (worldX: number, worldZ: number) => void;
}

export const MiniMap = forwardRef<MiniMapHandle, Props>(function MiniMap({ waterColor, onTeleport }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const transformRef = useRef({ scale: 0, ox: 0, oy: 0 });
  const lastPos = useRef({ x: -104, z: -67 });
  const [copied, setCopied] = useState(false);

  const draw = useCallback((worldX: number | null, worldZ: number | null, heading: number) => {
    if (worldX !== null && worldZ !== null) lastPos.current = { x: worldX, z: worldZ };
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = waterColor;
    ctx.fillRect(0, 0, W, H);

    const padL = 14, padT = 11, padR = 3, padB = 3;
    const scale = Math.min((W - padL - padR) / (DOM_X1 - DOM_X0), (H - padT - padB) / (DOM_Z1 - DOM_Z0));
    const ox = padL + ((W - padL - padR) - (DOM_X1 - DOM_X0) * scale) / 2;
    const oy = padT + ((H - padT - padB) - (DOM_Z1 - DOM_Z0) * scale) / 2;
    transformRef.current = { scale, ox, oy };
    const px = (x: number) => ox + (x - DOM_X0) * scale;
    const pz = (z: number) => oy + (z - DOM_Z0) * scale;
    const trace = (poly: [number, number][], close: boolean) => {
      ctx.beginPath();
      poly.forEach(([ix, iz], i) => {
        const [wx, wz] = imageToWorld(ix, iz);
        if (i === 0) ctx.moveTo(px(wx), pz(wz));
        else ctx.lineTo(px(wx), pz(wz));
      });
      if (close) ctx.closePath();
    };

    // Landmasses, the dredged channel, and the road network.
    const { main, port, beach, fort, shoals, channel } = mapOutlines();
    ctx.fillStyle = '#a6bd8d';
    [main, port, beach, fort].forEach(poly => { trace(poly, true); ctx.fill(); });
    // Eyer Shoals: small islets get a warmer sand fill so they read as islets, not water noise.
    ctx.fillStyle = '#d9c793';
    shoals.forEach(poly => { trace(poly, true); ctx.fill(); });
    ctx.fillStyle = '#a6bd8d';
    ctx.strokeStyle = '#e0d6b0';
    ctx.lineWidth = 1;
    [main, port, beach, fort].forEach(poly => { trace(poly, true); ctx.stroke(); });
    shoals.forEach(poly => { trace(poly, true); ctx.stroke(); });
    trace(channel, false);
    ctx.strokeStyle = waterColor;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(48,60,57,0.85)';
    ctx.lineWidth = 1.1;
    roads.forEach(road => {
      (road.path.match(/M[^M]*/g) || []).forEach(part => {
        const pts = samplePath(part, 10);
        if (pts.length < 2) return;
        trace(pts, false);
        ctx.stroke();
      });
    });

    // 100 m location grid with column letters and row numbers.
    ctx.strokeStyle = 'rgba(238,246,238,0.32)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= GRID_COLS; c++) {
      const x = GRID_X0 + c * GRID_CELL;
      ctx.beginPath(); ctx.moveTo(px(x), pz(DOM_Z0)); ctx.lineTo(px(x), pz(DOM_Z1)); ctx.stroke();
    }
    for (let r = 0; r <= GRID_ROWS; r++) {
      const z = GRID_Z0 + r * GRID_CELL;
      ctx.beginPath(); ctx.moveTo(px(DOM_X0), pz(z)); ctx.lineTo(px(DOM_X1), pz(z)); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(238,246,238,0.78)';
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let c = 0; c < GRID_COLS; c++) ctx.fillText(String.fromCharCode(65 + c), px(GRID_X0 + (c + 0.5) * GRID_CELL), 6);
    ctx.textAlign = 'right';
    for (let r = 0; r < GRID_ROWS; r++) ctx.fillText(String(r + 1), 10, pz(GRID_Z0 + (r + 0.5) * GRID_CELL));

    // Current cell highlight and car indicator.
    if (worldX !== null && worldZ !== null) {
      const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((worldX - GRID_X0) / GRID_CELL)));
      const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((worldZ - GRID_Z0) / GRID_CELL)));
      ctx.fillStyle = 'rgba(186,232,186,0.22)';
      ctx.fillRect(px(GRID_X0 + col * GRID_CELL), pz(GRID_Z0 + row * GRID_CELL), GRID_CELL * scale, GRID_CELL * scale);
      ctx.strokeStyle = 'rgba(226,248,226,0.85)';
      ctx.strokeRect(px(GRID_X0 + col * GRID_CELL), pz(GRID_Z0 + row * GRID_CELL), GRID_CELL * scale, GRID_CELL * scale);
      ctx.save();
      ctx.translate(px(worldX), pz(worldZ));
      ctx.rotate(Math.atan2(Math.sin(heading), Math.cos(heading)));
      ctx.beginPath();
      ctx.moveTo(5.5, 0);
      ctx.lineTo(-3.6, 3.6);
      ctx.lineTo(-3.6, -3.6);
      ctx.closePath();
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.strokeStyle = '#40331c';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }

    if (readoutRef.current) {
      const p = lastPos.current;
      readoutRef.current.textContent = `${gridRef(p.x, p.z)} · X ${p.x >= 0 ? '+' : ''}${Math.round(p.x)} m · Z ${p.z >= 0 ? '+' : ''}${Math.round(p.z)} m`;
    }
  }, [waterColor]);

  useImperativeHandle(ref, () => ({ draw }), [draw]);
  useEffect(() => { draw(null, null, 0); }, [draw]);

  const copy = async () => {
    const text = `Lokam island map — ${formatCoords(lastPos.current.x, lastPos.current.z)}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const onCanvasClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const { scale, ox, oy } = transformRef.current;
    if (!scale) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onTeleport((event.clientX - rect.left - ox) / scale + DOM_X0, (event.clientY - rect.top - oy) / scale + DOM_Z0);
  };

  return (
    <div className="minimap-panel">
      <div className="minimap-title">Location grid</div>
      <canvas ref={canvasRef} className="minimap-canvas" width={W} height={H} onClick={onCanvasClick} title="Click to teleport the car while in drive mode" aria-label="Map preview with 100 m location grid" />
      <div className="minimap-readout">
        <span ref={readoutRef}>—</span>
        <button type="button" onClick={copy} title="Copy coordinates" aria-label="Copy coordinates">{copied ? <Check size={11} /> : <Copy size={11} />}</button>
      </div>
    </div>
  );
});
