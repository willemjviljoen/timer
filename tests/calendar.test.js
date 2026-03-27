import { describe, it, expect } from 'vitest';
import { entryMinutes, computeOverlapLayout } from '../src/renderer/utils/calendar.js';

function makeEntry(id, startTime, endTime) {
  return { id, start_time: startTime, end_time: endTime };
}

describe('entryMinutes', () => {
  const day = new Date(2024, 2, 15); // March 15, 2024

  it('calculates minutes for an entry fully within the day', () => {
    const e = makeEntry(1, '2024-03-15T09:30:00', '2024-03-15T11:00:00');
    const { startMin, endMin } = entryMinutes(e, day);
    expect(startMin).toBe(9 * 60 + 30); // 570
    expect(endMin).toBe(11 * 60);       // 660
  });

  it('clamps start to 0 when entry starts on previous day', () => {
    const e = makeEntry(2, '2024-03-14T22:00:00', '2024-03-15T02:00:00');
    const { startMin, endMin } = entryMinutes(e, day);
    expect(startMin).toBe(0);
    expect(endMin).toBe(2 * 60); // 120
  });

  it('clamps end to 1440 when entry ends on next day', () => {
    const e = makeEntry(3, '2024-03-15T23:00:00', '2024-03-16T01:00:00');
    const { startMin, endMin } = entryMinutes(e, day);
    expect(startMin).toBe(23 * 60); // 1380
    expect(endMin).toBe(24 * 60);   // 1440
  });

  it('ensures minimum 1-minute duration', () => {
    const e = makeEntry(4, '2024-03-15T10:00:00', '2024-03-15T10:00:00');
    const { startMin, endMin } = entryMinutes(e, day);
    expect(endMin).toBe(startMin + 1);
  });
});

describe('computeOverlapLayout', () => {
  const day = new Date(2024, 2, 15);

  it('returns empty layout for no entries', () => {
    expect(computeOverlapLayout([], day)).toEqual({});
  });

  it('assigns single entry to col 0 with totalCols 1', () => {
    const entries = [makeEntry(1, '2024-03-15T09:00:00', '2024-03-15T10:00:00')];
    const layout = computeOverlapLayout(entries, day);
    expect(layout[1]).toEqual({ col: 0, totalCols: 1 });
  });

  it('assigns non-overlapping entries each to col 0', () => {
    const entries = [
      makeEntry(1, '2024-03-15T09:00:00', '2024-03-15T10:00:00'),
      makeEntry(2, '2024-03-15T11:00:00', '2024-03-15T12:00:00'),
    ];
    const layout = computeOverlapLayout(entries, day);
    expect(layout[1]).toEqual({ col: 0, totalCols: 1 });
    expect(layout[2]).toEqual({ col: 0, totalCols: 1 });
  });

  it('assigns overlapping entries to different columns', () => {
    const entries = [
      makeEntry(1, '2024-03-15T09:00:00', '2024-03-15T11:00:00'),
      makeEntry(2, '2024-03-15T10:00:00', '2024-03-15T12:00:00'),
    ];
    const layout = computeOverlapLayout(entries, day);
    expect(layout[1].col).toBe(0);
    expect(layout[2].col).toBe(1);
    expect(layout[1].totalCols).toBe(2);
    expect(layout[2].totalCols).toBe(2);
  });

  it('handles three-way overlap', () => {
    const entries = [
      makeEntry(1, '2024-03-15T09:00:00', '2024-03-15T12:00:00'),
      makeEntry(2, '2024-03-15T10:00:00', '2024-03-15T13:00:00'),
      makeEntry(3, '2024-03-15T11:00:00', '2024-03-15T14:00:00'),
    ];
    const layout = computeOverlapLayout(entries, day);
    const cols = new Set([layout[1].col, layout[2].col, layout[3].col]);
    expect(cols.size).toBe(3); // all in different columns
    expect(layout[1].totalCols).toBe(3);
  });

  it('reuses columns after an entry ends', () => {
    const entries = [
      makeEntry(1, '2024-03-15T09:00:00', '2024-03-15T10:00:00'),
      makeEntry(2, '2024-03-15T09:30:00', '2024-03-15T11:00:00'),
      makeEntry(3, '2024-03-15T10:00:00', '2024-03-15T11:30:00'),
    ];
    const layout = computeOverlapLayout(entries, day);
    // Entry 3 starts at the same time entry 1 ends, so it should reuse col 0
    expect(layout[1].col).toBe(0);
    expect(layout[3].col).toBe(0);
    expect(layout[2].col).toBe(1);
  });

  it('handles mixed overlapping and non-overlapping entries', () => {
    const entries = [
      makeEntry(1, '2024-03-15T09:00:00', '2024-03-15T10:00:00'),
      makeEntry(2, '2024-03-15T09:30:00', '2024-03-15T10:30:00'),
      makeEntry(3, '2024-03-15T14:00:00', '2024-03-15T15:00:00'),
    ];
    const layout = computeOverlapLayout(entries, day);
    // First two overlap → 2 columns
    expect(layout[1].totalCols).toBe(2);
    expect(layout[2].totalCols).toBe(2);
    // Third is in its own cluster → 1 column
    expect(layout[3]).toEqual({ col: 0, totalCols: 1 });
  });
});
