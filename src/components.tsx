import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';

export function IconButton({ children, label, active = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; label: string; active?: boolean }) {
  return <button type="button" className={`icon-button ${active?'active':''} ${className}`} title={label} aria-label={label} {...props}>{children}</button>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked?'on':''}`} onClick={onChange}><span>{checked && <Check size={9}/>}</span></button>;
}

export function RangeControl({ label, value, min, max, step = 1, suffix, onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix: string; onChange: (value: number) => void }) {
  return <div className="range-control"><div className="range-label"><label>{label}</label><div className="number-field"><input aria-label={label} type="number" value={value} min={min} max={max} step={step} onChange={e=>{ const number = Number(e.target.value); if (Number.isFinite(number)) onChange(Math.min(max,Math.max(min,number))); }}/><span>{suffix}</span></div></div><input aria-label={`${label} slider`} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} style={{ '--range-fill': `${(value-min)/(max-min)*100}%` } as CSSProperties}/></div>;
}

export function Modal({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(()=>{
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    if(!element) return;
    if(!element.contains(document.activeElement)) element.focus();
    const trap = (event: KeyboardEvent) => {
      if(event.key!=='Tab') return;
      const focusable = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')];
      const first = focusable[0], last = focusable[focusable.length-1];
      if(event.shiftKey && (document.activeElement===first || document.activeElement===element)) { event.preventDefault(); last?.focus(); }
      else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
    };
    element.addEventListener('keydown',trap);
    return ()=>{ element.removeEventListener('keydown',trap); previous?.focus(); };
  },[]);
  return createPortal(<div className="modal-backdrop" onMouseDown={event=>{ if(event.target===event.currentTarget) onClose(); }}><section ref={dialog} tabIndex={-1} className={`modal ${wide?'modal-wide':''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><div className="modal-eyebrow">ISLANDFORGE STUDIO</div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={18}/></IconButton></div>{children}</section></div>,document.fullscreenElement || document.body);
}