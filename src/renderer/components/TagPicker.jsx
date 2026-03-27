import React, { useState, useRef, useEffect } from 'react';

const TAG_COLORS = ['#e85d04','#8b5cf6','#06b6d4','#f59e0b','#22c55e','#ef4444','#ec4899','#14b8a6','#6366f1','#f97316'];

const V = {
  bgSurface: '#141414', bgInput: '#1a1a1a', bgHover: '#222',
  border: '#2a2a2a', text: '#f0f0f0', textDim: '#555',
  mono: "'JetBrains Mono',monospace", sans: "'Manrope',system-ui,sans-serif",
};

export default function TagPicker({ allTags, selectedTagIds, onToggle, onCreate, onClose }) {
  const [search, setSearch] = useState('');
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[0]);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const filtered = allTags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const exactMatch = allTags.some(t => t.name.toLowerCase() === search.trim().toLowerCase());
  const canCreate = search.trim().length > 0 && !exactMatch;

  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 4px)', right: 0, width: 260,
      background: V.bgSurface, border: `1px solid ${V.border}`, borderRadius: 6,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 150,
    }}>
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${V.border}` }}>
        <input
          ref={inputRef} type="text" placeholder="Search or create tag..."
          value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && canCreate) { e.preventDefault(); onCreate(search.trim(), selectedColor); setSearch(''); } }}
          style={{ width: '100%', height: 32, padding: '0 10px', background: V.bgInput, border: `1px solid ${V.border}`, borderRadius: 4, color: V.text, fontFamily: V.sans, fontSize: 12, fontWeight: 500, outline: 'none' }}
        />
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto', padding: '4px 0' }}>
        {filtered.map(tag => {
          const sel = selectedTagIds.includes(tag.id);
          return (
            <div key={tag.id} onClick={() => onToggle(tag.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = V.bgHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ width: 16, height: 16, borderRadius: 3, border: sel ? `2px solid ${tag.color}` : `2px solid ${V.border}`, background: sel ? tag.color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {sel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: V.text }}>{tag.name}</span>
            </div>
          );
        })}
        {filtered.length === 0 && !canCreate && (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: V.textDim }}>No tags found</div>
        )}
      </div>
      {canCreate && (
        <div style={{ borderTop: `1px solid ${V.border}`, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: V.textDim, marginBottom: 6, fontFamily: V.mono }}>Create new tag</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {TAG_COLORS.map(c => (
              <span key={c} onClick={() => setSelectedColor(c)} style={{ width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', border: selectedColor === c ? '2px solid white' : '2px solid transparent', boxShadow: selectedColor === c ? `0 0 6px ${c}60` : 'none', transition: 'all .15s' }} />
            ))}
          </div>
          <button onClick={() => { onCreate(search.trim(), selectedColor); setSearch(''); }}
            style={{ width: '100%', height: 30, border: 'none', borderRadius: 4, background: selectedColor, color: 'white', fontFamily: V.sans, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Create "{search.trim()}"
          </button>
        </div>
      )}
    </div>
  );
}
