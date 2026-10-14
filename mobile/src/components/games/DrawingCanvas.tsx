import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path } from 'react-native-svg';

import { realtime } from '@/lib/realtime';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

export type Point = [number, number];
/** Points are normalised 0..1; `width` is in units of a 360-wide canvas so it scales with screen size. */
export type Stroke = { points: Point[]; color: string; width: number };

export const PAPER = '#FFFFFF';
export const BRUSH_COLORS = ['#1E1B2E', '#E4572E', '#FF8F9A', '#FFC857', '#43CFA0', '#5AA9E6', '#7C6CF2', '#8D5524'];
export const BRUSH_COLOR_NAMES: Record<string, string> = {
  '#1E1B2E': 'Ink',
  '#E4572E': 'Red',
  '#FF8F9A': 'Pink',
  '#FFC857': 'Yellow',
  '#43CFA0': 'Green',
  '#5AA9E6': 'Blue',
  '#7C6CF2': 'Purple',
  '#8D5524': 'Brown',
  [PAPER]: 'Eraser',
};
export const BRUSH_SIZES = [3, 7, 13, 22];

const BASE = 360;
const MAX_POINTS = 400; // server limit per message
const TICK_MS = 80;
// Client-side token bucket that stays under the server's 120 events / 30 s websocket limit.
const BUCKET_MAX = 20;
const REFILL_PER_SEC = 3;

export type CanvasHandle = {
  /** Draw a stroke chunk received from the artist. */
  addRemote: (stroke: Stroke) => void;
  /** Clear locally (and for everyone, when we're the artist). */
  clear: (broadcast?: boolean) => void;
  undo: () => void;
  /** Re-send the whole drawing (e.g. after someone joins mid-round). */
  resync: () => void;
  isEmpty: () => boolean;
};

type Props = {
  sessionId: string;
  editable: boolean;
  color: string;
  width: number;
  /** Changing this clears the canvas (new round). */
  resetKey: string;
  onStrokeCountChange?: (n: number) => void;
  accessibilityLabel?: string;
};

const round4 = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000;

function pathFor(points: Point[], w: number, h: number): string {
  if (!points.length) return '';
  const [x0, y0] = points[0];
  let d = `M${(x0 * w).toFixed(1)} ${(y0 * h).toFixed(1)}`;
  if (points.length === 1) return `${d} L${(x0 * w + 0.1).toFixed(1)} ${(y0 * h).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += ` L${(points[i][0] * w).toFixed(1)} ${(points[i][1] * h).toFixed(1)}`;
  return d;
}

const StrokePath = memo(function StrokePath({ stroke, w, h }: { stroke: Stroke; w: number; h: number }) {
  return (
    <Path
      d={pathFor(stroke.points, w, h)}
      stroke={stroke.color}
      strokeWidth={Math.max(1, (stroke.width * w) / BASE)}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
});

/** Square drawing surface shared by the artist (editable) and guessers (view only). */
export const DrawingCanvas = forwardRef<CanvasHandle, Props>(function DrawingCanvas(
  { sessionId, editable, color, width, resetKey, onStrokeCountChange, accessibilityLabel },
  ref,
) {
  const { colors } = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [live, setLive] = useState<Stroke | null>(null);

  const sizeRef = useRef(size);
  const liveRef = useRef<{ stroke: Stroke; sent: number } | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const queue = useRef<object[]>([]);
  const tokens = useRef(BUCKET_MAX);
  const lastRefill = useRef(Date.now());
  const pausedUntil = useRef(0);
  const brush = useRef({ color, width });
  brush.current = { color, width };

  const setAll = useCallback(
    (next: Stroke[]) => {
      strokesRef.current = next;
      setStrokes(next);
      onStrokeCountChange?.(next.length);
    },
    [onStrokeCountChange],
  );

  // New round: wipe without broadcasting (everyone resets on the round change).
  useEffect(() => {
    liveRef.current = null;
    queue.current = [];
    setLive(null);
    setAll([]);
  }, [resetKey, setAll]);

  // ----- Sending (artist only) -----
  const chunkMessages = useCallback(
    (stroke: Stroke) => {
      const out: object[] = [];
      for (let i = 0; i < stroke.points.length; i += MAX_POINTS - 1) {
        // Each chunk repeats the previous chunk's last point so segments join up seamlessly.
        const pts = stroke.points.slice(Math.max(0, i - (i ? 1 : 0)), i + MAX_POINTS - 1);
        if (pts.length) out.push({ type: 'draw', session_id: sessionId, stroke: { points: pts, color: stroke.color, width: stroke.width } });
        if (i + MAX_POINTS - 1 >= stroke.points.length) break;
      }
      return out;
    },
    [sessionId],
  );

  const takeLiveChunk = useCallback(
    (final: boolean) => {
      const l = liveRef.current;
      if (!l) return;
      const start = Math.max(0, l.sent - 1);
      const unsent = l.stroke.points.length - l.sent;
      if (unsent <= 0) return;
      const part: Stroke = { ...l.stroke, points: l.stroke.points.slice(start) };
      queue.current.push(...chunkMessages(part));
      l.sent = l.stroke.points.length;
      if (final) liveRef.current = null;
    },
    [chunkMessages],
  );

  const drain = useCallback(() => {
    const now = Date.now();
    tokens.current = Math.min(BUCKET_MAX, tokens.current + ((now - lastRefill.current) / 1000) * REFILL_PER_SEC);
    lastRefill.current = now;
    if (now < pausedUntil.current) return;
    // Only cut a new chunk from the live stroke when the queue is clear, so slow links send bigger chunks, not more of them.
    if (!queue.current.length && liveRef.current && tokens.current >= 1) takeLiveChunk(false);
    while (queue.current.length && tokens.current >= 1) {
      if (!realtime.send(queue.current[0])) return; // offline: keep it queued
      queue.current.shift();
      tokens.current -= 1;
    }
  }, [takeLiveChunk]);

  useEffect(() => {
    if (!editable) return;
    const t = setInterval(drain, TICK_MS);
    const off = realtime.on('error', (e) => {
      if ((e as { code?: string }).code === 'rate_limited' || e.data?.code === 'rate_limited') pausedUntil.current = Date.now() + 3000;
    });
    return () => {
      clearInterval(t);
      off();
    };
  }, [editable, drain]);

  const resendAll = useCallback(
    (list: Stroke[]) => {
      queue.current = [{ type: 'draw_clear', session_id: sessionId }];
      for (const s of list) queue.current.push(...chunkMessages(s));
    },
    [sessionId, chunkMessages],
  );

  useImperativeHandle(
    ref,
    () => ({
      addRemote: (stroke) => {
        if (!stroke || !Array.isArray(stroke.points) || !stroke.points.length) return;
        setAll([...strokesRef.current, { points: stroke.points, color: stroke.color || '#1E1B2E', width: stroke.width || 6 }]);
      },
      clear: (broadcast = true) => {
        liveRef.current = null;
        setLive(null);
        setAll([]);
        if (broadcast && editable) queue.current = [{ type: 'draw_clear', session_id: sessionId }];
      },
      undo: () => {
        if (!editable || !strokesRef.current.length) return;
        const next = strokesRef.current.slice(0, -1);
        setAll(next);
        resendAll(next);
      },
      resync: () => {
        if (editable && strokesRef.current.length) resendAll(strokesRef.current);
      },
      isEmpty: () => strokesRef.current.length === 0,
    }),
    [editable, sessionId, setAll, resendAll],
  );

  // ----- Gesture -----
  const toPoint = (x: number, y: number): Point => {
    const { w, h } = sizeRef.current;
    return [round4(w ? x / w : 0), round4(h ? y / h : 0)];
  };

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .enabled(editable)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((e) => {
          const stroke: Stroke = { points: [toPoint(e.x, e.y)], color: brush.current.color, width: brush.current.width };
          liveRef.current = { stroke, sent: 0 };
          setLive({ ...stroke });
        })
        .onUpdate((e) => {
          const l = liveRef.current;
          if (!l) return;
          const p = toPoint(e.x, e.y);
          const last = l.stroke.points[l.stroke.points.length - 1];
          // Skip sub-pixel jitter to keep messages small.
          if (last && Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) < 0.004) return;
          l.stroke.points.push(p);
          setLive({ ...l.stroke, points: l.stroke.points.slice() });
        })
        .onFinalize(() => {
          const l = liveRef.current;
          if (!l) return;
          const done: Stroke = { ...l.stroke, points: l.stroke.points.slice() };
          takeLiveChunk(true);
          setLive(null);
          setAll([...strokesRef.current, done]);
        }),
    [editable, takeLiveChunk, setAll],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    sizeRef.current = { w, h };
    setSize({ w, h });
  };

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={onLayout}
        style={[styles.paper, { borderColor: colors.border }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel ?? (editable ? 'Drawing canvas. Drag to draw.' : 'The drawing so far')}
      >
        {size.w > 0 ? (
          <Svg width={size.w} height={size.h}>
            {strokes.map((s, i) => (
              <StrokePath key={i} stroke={s} w={size.w} h={size.h} />
            ))}
            {live ? <StrokePath stroke={live} w={size.w} h={size.h} /> : null}
          </Svg>
        ) : null}
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  paper: { width: '100%', aspectRatio: 1, backgroundColor: PAPER, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
