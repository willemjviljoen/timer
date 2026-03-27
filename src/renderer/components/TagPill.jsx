import React from 'react';

export default function TagPill({ tag, size = 'sm', onRemove }) {
  const sm = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      gap: sm ? 4 : 5,
      padding: sm ? '2px 8px' : '3px 10px',
      borderRadius: 99,
      fontSize: sm ? 10 : 11,
      fontWeight: 600,
      background: tag.color + '18',
      color: tag.color,
      border: `1px solid ${tag.color}30`,
      whiteSpace: 'nowrap',
      lineHeight: 1.4,
      fontFamily: "'Manrope',system-ui,sans-serif",
    }}>
      <span style={{ width: sm ? 6 : 7, height: sm ? 6 : 7, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
      {tag.name}
      {onRemove && (
        <span
          onClick={e => { e.stopPropagation(); onRemove(tag.id); }}
          style={{ cursor: 'pointer', marginLeft: 1, opacity: 0.6, fontSize: sm ? 12 : 14, lineHeight: 1 }}
          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
        >×</span>
      )}
    </span>
  );
}
