import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Sample = {
  x: number;
  y: number;
  t: number;
  distance: number;
  dt: number;
  speed: number;
  isSkip: boolean;
};

type SkipEvent = {
  at: number;
  distance: number;
  dt: number;
  speed: number;
  reason: string;
};

type SessionStats = {
  sampleCount: number;
  skipCount: number;
  totalDistance: number;
  skipDensityPer1000Px: number;
  avgSpeed: number;
  peakSpeed: number;
  avgDt: number;
  effectiveHz: number;
  sessionSeconds: number;
  score: number;
};

type SessionReport = {
  generatedAt: string;
  stats: SessionStats;
  recentSkips: SkipEvent[];
};

const SAMPLE_LIMIT = 12000;
const RECENT_SKIPS_LIMIT = 8;
const COUNTDOWN_SECONDS = 3;

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[index];
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export default function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [runState, setRunState] = useState<'idle' | 'countdown' | 'capturing'>('idle');
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [skipEvents, setSkipEvents] = useState<SkipEvent[]>([]);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isMethodologyOpen, setIsMethodologyOpen] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const isCapturing = runState === 'capturing';
  const isCountdown = runState === 'countdown';

  const resetSession = useCallback(() => {
    setRunState('idle');
    setCountdown(COUNTDOWN_SECONDS);
    setSamples([]);
    setSkipEvents([]);
    setReport(null);
    setIsReportOpen(false);
    lastPointRef.current = null;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const setupCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) {
      return;
    }

    const rect = wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${Math.floor(rect.width)}px`;
    canvas.style.height = `${Math.floor(rect.height)}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, rect.width, rect.height);
  }, []);

  useEffect(() => {
    setupCanvasSize();
    window.addEventListener('resize', setupCanvasSize);
    return () => window.removeEventListener('resize', setupCanvasSize);
  }, [setupCanvasSize]);

  useEffect(() => {
    if (!isCountdown) {
      return;
    }
    if (countdown <= 0) {
      setRunState('capturing');
      return;
    }
    const timer = window.setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, isCountdown]);

  const drawSegment = useCallback((x1: number, y1: number, x2: number, y2: number, isSkip: boolean) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isSkip ? '#ef4444' : '#38bdf8';
    ctx.lineWidth = isSkip ? 2.4 : 1.2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isCapturing) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const t = performance.now();

      const last = lastPointRef.current;
      if (!last) {
        lastPointRef.current = { x, y, t };
        return;
      }

      const dt = t - last.t;
      if (dt <= 0) {
        return;
      }

      const distance = distanceBetween(last, { x, y });
      const speed = distance / dt;

      const recent = samples.slice(-250);
      const recentDistances = recent.map((item) => item.distance).filter((value) => value > 0);
      const recentDt = recent.map((item) => item.dt).filter((value) => value > 0);

      const p95Distance = percentile(recentDistances, 95);
      const p95Dt = percentile(recentDt, 95);

      const distanceOutlier = p95Distance > 0 && distance > p95Distance * 2.2 && dt < 25;
      const gapOutlier = p95Dt > 0 && dt > p95Dt * 1.8 && distance > Math.max(12, p95Distance * 1.1);
      const isSkip = distanceOutlier || gapOutlier;

      const sample: Sample = { x, y, t, distance, dt, speed, isSkip };

      setSamples((prev) => {
        const next = [...prev, sample];
        if (next.length > SAMPLE_LIMIT) {
          return next.slice(next.length - SAMPLE_LIMIT);
        }
        return next;
      });

      if (isSkip) {
        const reason = distanceOutlier ? 'distance spike' : 'time gap + jump';
        setSkipEvents((prev) => {
          const next: SkipEvent[] = [{ at: t, distance, dt, speed, reason }, ...prev];
          return next.slice(0, RECENT_SKIPS_LIMIT);
        });
      }

      drawSegment(last.x, last.y, x, y, isSkip);
      lastPointRef.current = { x, y, t };
    },
    [drawSegment, isCapturing, samples]
  );

  const stats = useMemo<SessionStats>(() => {
    if (samples.length === 0) {
      return {
        sampleCount: 0,
        skipCount: 0,
        totalDistance: 0,
        skipDensityPer1000Px: 0,
        avgSpeed: 0,
        peakSpeed: 0,
        avgDt: 0,
        effectiveHz: 0,
        sessionSeconds: 0,
        score: 100
      };
    }

    const speedValues = samples.map((item) => item.speed);
    const dtValues = samples.map((item) => item.dt).filter((value) => value > 0);
    const skipCount = samples.filter((item) => item.isSkip).length;
    const totalDistance = samples.reduce((acc, item) => acc + item.distance, 0);
    const skipDensityPer1000Px = totalDistance > 0 ? skipCount / (totalDistance / 1000) : 0;

    const avgSpeed = speedValues.reduce((acc, value) => acc + value, 0) / speedValues.length;
    const peakSpeed = Math.max(...speedValues);
    const avgDt = dtValues.reduce((acc, value) => acc + value, 0) / dtValues.length;
    const effectiveHz = avgDt > 0 ? 1000 / avgDt : 0;

    const first = samples[0];
    const last = samples[samples.length - 1];
    const sessionSeconds = Math.max(0.001, (last.t - first.t) / 1000);

    const skipPenalty = skipCount * 1.8;
    const densityPenalty =
      skipDensityPer1000Px <= 0.25
        ? 0
        : skipDensityPer1000Px <= 1
          ? (skipDensityPer1000Px - 0.25) * 10
          : 7.5 + (skipDensityPer1000Px - 1) * 16;
    const rawScore = 100 - skipPenalty - densityPenalty;
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));

    return {
      sampleCount: samples.length,
      skipCount,
      totalDistance,
      skipDensityPer1000Px,
      avgSpeed,
      peakSpeed,
      avgDt,
      effectiveHz,
      sessionSeconds,
      score
    };
  }, [samples]);

  const exportSession = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      stats,
      recentSkips: skipEvents,
      sampleCount: samples.length,
      samples
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/:/g, '-');
    a.href = url;
    a.download = `mouse-skip-session-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [samples, skipEvents, stats]);

  const exportReport = useCallback(() => {
    if (!report) {
      return;
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date(report.generatedAt).toISOString().replace(/:/g, '-');
    a.href = url;
    a.download = `mouse-skip-report-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [report]);

  const handleStartStopClick = useCallback(() => {
    if (runState === 'capturing') {
      setRunState('idle');
      lastPointRef.current = null;
      if (stats.sampleCount > 0) {
        setReport({
          generatedAt: new Date().toISOString(),
          stats: { ...stats },
          recentSkips: [...skipEvents]
        });
        setIsReportOpen(true);
      }
      return;
    }
    if (runState === 'countdown') {
      setRunState('idle');
      setCountdown(COUNTDOWN_SECONDS);
      lastPointRef.current = null;
      return;
    }
    resetSession();
    setRunState('countdown');
    setCountdown(COUNTDOWN_SECONDS);
    lastPointRef.current = null;
  }, [resetSession, runState, skipEvents, stats]);

  const statusLabel = isCountdown ? `Countdown (${countdown}s)` : isCapturing ? 'Capturing' : 'Idle';
  const instructions = isCountdown
    ? `Move your cursor into the test area. Recording starts in ${countdown}s.`
    : isCapturing
      ? 'Recording in progress. Move naturally inside the test area.'
      : 'Press Start to begin a short countdown before recording.';
  const reportScoreLabel =
    report === null
      ? ''
      : report.stats.score >= 92
        ? 'Excellent'
        : report.stats.score >= 80
          ? 'Acceptable'
          : report.stats.score >= 65
            ? 'Needs work'
            : 'Poor';

  return (
    <main className="page">
      <section className="panel controls">
        <h1>Mouse Skip Detector</h1>
        <p>{instructions}</p>
        <div className="button-row">
          <button type="button" onClick={handleStartStopClick}>
            {isCapturing ? 'Stop' : isCountdown ? 'Cancel' : 'Start'}
          </button>
          <button type="button" onClick={resetSession}>
            Reset
          </button>
          <button type="button" onClick={exportSession} disabled={samples.length === 0}>
            Export JSON
          </button>
          <button type="button" onClick={() => setIsMethodologyOpen(true)}>
            Methodology
          </button>
        </div>
        <div className="status">
          Status: <strong>{statusLabel}</strong>
        </div>
      </section>

      <section className="stage-layout">
        <div
          ref={wrapperRef}
          className={`capture-stage ${isCountdown ? 'is-countdown' : ''}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            lastPointRef.current = null;
          }}
        >
          <canvas ref={canvasRef} />
          {isCountdown ? (
            <div className="stage-overlay">
              <p>Place your cursor inside this area.</p>
              <strong>{countdown}</strong>
            </div>
          ) : null}
        </div>

        <aside className="panel metrics">
          <h2>Metrics</h2>
          <ul>
            <li>Samples: {stats.sampleCount}</li>
            <li>Detected skips: {stats.skipCount}</li>
            <li>Total distance: {stats.totalDistance.toFixed(0)} px</li>
            <li>Skip density: {stats.skipDensityPer1000Px.toFixed(2)} per 1000 px</li>
            <li>Effective Hz: {stats.effectiveHz.toFixed(1)}</li>
            <li>Average speed: {stats.avgSpeed.toFixed(3)} px/ms</li>
            <li>Peak speed: {stats.peakSpeed.toFixed(3)} px/ms</li>
            <li>Average dt: {stats.avgDt.toFixed(2)} ms</li>
            <li>Duration: {stats.sessionSeconds.toFixed(1)} s</li>
            <li>Session score: {stats.score}/100</li>
          </ul>

          <h3>Latest skips</h3>
          {skipEvents.length === 0 ? (
            <p className="muted">No flagged events yet.</p>
          ) : (
            <ul className="skip-log">
              {skipEvents.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <span>{event.reason}</span>
                  <span>d={event.distance.toFixed(1)}px</span>
                  <span>dt={event.dt.toFixed(1)}ms</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </section>

      {isReportOpen && report ? (
        <div className="report-dialog-backdrop" role="presentation" onClick={() => setIsReportOpen(false)}>
          <section
            className="report-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Session report"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Session Report</h2>
            <p>Generated at {new Date(report.generatedAt).toLocaleString()}</p>
            <ul>
              <li>Session score: {report.stats.score}/100 ({reportScoreLabel})</li>
              <li>Samples: {report.stats.sampleCount}</li>
              <li>Detected skips: {report.stats.skipCount}</li>
              <li>Total distance: {report.stats.totalDistance.toFixed(0)} px</li>
              <li>Skip density: {report.stats.skipDensityPer1000Px.toFixed(2)} per 1000 px</li>
              <li>Effective Hz: {report.stats.effectiveHz.toFixed(1)}</li>
              <li>Duration: {report.stats.sessionSeconds.toFixed(1)} s</li>
            </ul>

            <h3>Latest flagged events</h3>
            {report.recentSkips.length === 0 ? (
              <p className="muted">No flagged events in this session.</p>
            ) : (
              <ul className="skip-log report-skip-log">
                {report.recentSkips.map((event, index) => (
                  <li key={`${event.at}-${index}`}>
                    <span>{event.reason}</span>
                    <span>d={event.distance.toFixed(1)}px</span>
                    <span>dt={event.dt.toFixed(1)}ms</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="report-actions">
              <button type="button" onClick={exportReport}>
                Export report
              </button>
              <button type="button" onClick={() => setIsReportOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isMethodologyOpen ? (
        <div className="report-dialog-backdrop" role="presentation" onClick={() => setIsMethodologyOpen(false)}>
          <section
            className="report-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Methodology"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Detection Methodology</h2>
            <p>This tool estimates cursor skip behavior from browser pointer events.</p>
            <ul className="methodology-list">
              <li>
                <strong>Sampling</strong>
                <span>Captures position and timestamp on each pointer event in the test area.</span>
              </li>
              <li>
                <strong>Motion Features</strong>
                <span>Computes distance, dt and speed for every movement segment.</span>
              </li>
              <li>
                <strong>Adaptive Baseline</strong>
                <span>Uses recent p95 values to adapt to your current movement style.</span>
              </li>
              <li>
                <strong>Skip Rule A</strong>
                <span>Flags a large distance spike in a very short time window.</span>
              </li>
              <li>
                <strong>Skip Rule B</strong>
                <span>Flags a time gap followed by a jump in cursor position.</span>
              </li>
              <li>
                <strong>Density Metric</strong>
                <span>Reports skips per 1000 px traveled to normalize by movement amount.</span>
              </li>
              <li>
                <strong>Score</strong>
                <span>Produces a calibrated 0-100 score from skip count and skip density.</span>
              </li>
              <li>
                <strong>Limitation</strong>
                <span>Browser events are not raw sensor data, so hardware-level causes are inferred.</span>
              </li>
            </ul>
            <div className="report-actions">
              <button type="button" onClick={() => setIsMethodologyOpen(false)}>
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <footer className="copyright">© Alejandro Lopez Osornio 2026</footer>
    </main>
  );
}
