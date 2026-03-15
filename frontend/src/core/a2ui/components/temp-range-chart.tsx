"use client";

import { useDataBinding } from "@a2ui-sdk/react/0.8";
import type { ValueSource } from "@a2ui-sdk/types/0.8";
import React, { memo, useMemo } from "react";

import { cn } from "@/lib/utils";

type TempRangeChartProps = {
  title?: ValueSource;
  labels?: ValueSource; // literalArray recommended
  high?: ValueSource; // literalArray (numbers encoded as strings) recommended
  low?: ValueSource; // literalArray (numbers encoded as strings) recommended
  unit?: ValueSource; // e.g. literalString "°C"
};

type A2UIComponentProps<T> = T & {
  surfaceId: string;
  componentId: string;
  weight?: number;
};

function parseNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: number[] = [];
  for (const item of value) {
    const raw = typeof item === "string" ? item.trim() : String(item);
    const num = Number(raw);
    if (Number.isFinite(num)) {
      out.push(num);
    }
  }
  return out;
}

function normalizeLabelList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : String(item)))
    .filter(Boolean);
}

function toSvgPolylinePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) {
    return "";
  }
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }
  return ["M", first.x, first.y, ...rest.flatMap((p) => ["L", p.x, p.y])].join(" ");
}

export const TempRangeChartComponent = memo(function TempRangeChartComponent(
  props: A2UIComponentProps<TempRangeChartProps>,
) {
  const title = useDataBinding<string>(props.surfaceId, props.title, "");
  const unit = useDataBinding<string>(props.surfaceId, props.unit, "°C");
  const labelsRaw = useDataBinding<unknown>(props.surfaceId, props.labels, []);
  const highRaw = useDataBinding<unknown>(props.surfaceId, props.high, []);
  const lowRaw = useDataBinding<unknown>(props.surfaceId, props.low, []);

  const labels = useMemo(() => normalizeLabelList(labelsRaw), [labelsRaw]);
  const highs = useMemo(() => parseNumberList(highRaw), [highRaw]);
  const lows = useMemo(() => parseNumberList(lowRaw), [lowRaw]);

  const model = useMemo(() => {
    const count = Math.min(highs.length, lows.length);
    if (count <= 0) {
      return null;
    }

    const trimmedHighs = highs.slice(0, count);
    const trimmedLows = lows.slice(0, count);
    const trimmedLabels = (() => {
      if (labels.length >= count) {
        return labels.slice(0, count);
      }
      if (labels.length > 0) {
        const filled = labels.slice(0);
        while (filled.length < count) {
          filled.push(`Day ${filled.length + 1}`);
        }
        return filled.slice(0, count);
      }
      return Array.from({ length: count }, (_, idx) => `Day ${idx + 1}`);
    })();

    const all = [...trimmedHighs, ...trimmedLows];
    const min = Math.min(...all);
    const max = Math.max(...all);

    // Avoid a flat-line divide-by-zero.
    const span = Math.max(1, max - min);

    return {
      count,
      labels: trimmedLabels,
      highs: trimmedHighs,
      lows: trimmedLows,
      min,
      max,
      span,
    };
  }, [highs, labels, lows]);

  if (!model) {
    return (
      <div className="rounded-lg border bg-background/40 p-3">
        <div className="text-muted-foreground text-xs leading-5">
          暂无可展示的图表数据
        </div>
      </div>
    );
  }

  const width = 360;
  const height = 120;
  const paddingX = 12;
  const paddingY = 12;
  const innerW = width - paddingX * 2;
  const innerH = height - paddingY * 2;

  const xStep = model.count === 1 ? 0 : innerW / (model.count - 1);

  const toY = (value: number) => {
    const ratio = (value - model.min) / model.span; // 0..1
    // Higher values should appear higher on screen (smaller y)
    return paddingY + innerH - ratio * innerH;
  };

  const highPoints = model.highs.map((value, index) => ({
    x: paddingX + index * xStep,
    y: toY(value),
  }));
  const lowPoints = model.lows.map((value, index) => ({
    x: paddingX + index * xStep,
    y: toY(value),
  }));

  const highPath = toSvgPolylinePath(highPoints);
  const lowPath = toSvgPolylinePath(lowPoints);

  const areaPath = (() => {
    if (!highPath || !lowPath) {
      return "";
    }
    const lowReversed = [...lowPoints].reverse();
    const lowLine = toSvgPolylinePath(lowReversed).replace(/^M/, "L");
    return `${highPath} ${lowLine} Z`;
  })();

  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">{title || "温度趋势"}</div>
        <div className="text-muted-foreground text-xs">
          {model.min.toFixed(0)}
          {unit} - {model.max.toFixed(0)}
          {unit}
        </div>
      </div>

      <div className="mt-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="120"
          role="img"
          aria-label="temperature-range-chart"
          className="block"
        >
          <defs>
            <linearGradient id={`a2ui-temp-area-${props.componentId}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* Grid baseline */}
          <line
            x1={paddingX}
            x2={width - paddingX}
            y1={paddingY + innerH}
            y2={paddingY + innerH}
            stroke="hsl(var(--border))"
            strokeWidth="1"
          />

          {areaPath ? (
            <path
              d={areaPath}
              fill={`url(#a2ui-temp-area-${props.componentId})`}
              stroke="none"
            />
          ) : null}

          {lowPath ? (
            <path
              d={lowPath}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}

          {highPath ? (
            <path
              d={highPath}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2.5"
              strokeLinejoin="round"
          strokeLinecap="round"
            />
          ) : null}

          {/* Points */}
          {highPoints.map((p, idx) => (
            <circle
              key={`h-${idx}`}
              cx={p.x}
              cy={p.y}
              r="3"
              fill="hsl(var(--primary))"
            />
          ))}
          {lowPoints.map((p, idx) => (
            <circle
              key={`l-${idx}`}
              cx={p.x}
              cy={p.y}
              r="2.5"
              fill="hsl(var(--muted-foreground))"
              fillOpacity="0.85"
            />
          ))}
        </svg>

        <div
          className={cn("mt-2 grid gap-2")}
          style={{
            gridTemplateColumns: `repeat(${model.count}, minmax(0, 1fr))`,
          }}
        >
          {model.labels.map((label, index) => {
            const high = model.highs[index];
            const low = model.lows[index];
            const safeHigh = typeof high === "number" && Number.isFinite(high) ? high : null;
            const safeLow = typeof low === "number" && Number.isFinite(low) ? low : null;
            return (
              <div
                key={`${label}-${index}`}
                className="rounded-lg border bg-background/50 px-2 py-1.5"
                title={label}
              >
                <div className="truncate text-[11px] text-muted-foreground">
                  {label}
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium">
                    {safeHigh !== null ? `${safeHigh.toFixed(0)}${unit}` : "--"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {safeLow !== null ? `${safeLow.toFixed(0)}${unit}` : "--"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

TempRangeChartComponent.displayName = "A2UI.TempRangeChart";
