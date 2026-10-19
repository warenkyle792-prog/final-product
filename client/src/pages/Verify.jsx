import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Camera, CameraOff, Check, CircleAlert, History, Keyboard, QrCode, ScanLine, X,
} from 'lucide-react';

import { Avatar, Notice, Spinner, StatusPill } from '../components/UI';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from '../hooks';
import { timeAgo } from '../utils/format';

/**
 * Ticket check-in.
 *
 * Uses the browser's built-in BarcodeDetector when available (Chrome on
 * Android, Edge, Chrome desktop) to scan QR codes straight from the camera.
 * When it is not available the page falls back to a code field, which also
 * works with USB barcode scanners because the input keeps focus.
 *
 * Nothing here ever trusts the scan itself: every code is validated by the
 * server against the signed ticket payload and the organiser's permissions.
 */
export default function Verify() {
  useDocumentTitle('Verify tickets');

  const { user } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();

  const [code, setCode] = useState(params.get('code') || '');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectorRef = useRef(null);
  const inputRef = useRef(null);

  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window;
  const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia);

  const submit = useCallback(async (value, { checkIn = true } = {}) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      const looksLikePayload = trimmed.startsWith('{');
      const payload = await api.post('/tickets/verify', looksLikePayload
        ? { payload: trimmed, check_in: checkIn }
        : { code: trimmed, check_in: checkIn });

      setResult(payload);
      setHistory((current) => [{ ...payload, at: new Date().toISOString(), code: trimmed }, ...current].slice(0, 12));

      if (payload.status === 'checked_in') toast('Checked in', 'success');
      else if (payload.status === 'already_used') toast('Already checked in', 'info');
      else if (payload.status !== 'valid') toast(payload.message, 'error');
    } catch (error) {
      toast(error.message, 'error');
      setResult({ status: 'error', message: error.message });
    } finally {
      setBusy(false);
      setCode('');
      inputRef.current?.focus();
    }
  }, [toast]);

  const stopScan = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }, []);

  useEffect(() => () => stopScan(), [stopScan]);

  const startScan = async () => {
    setScanError('');

    if (!supported) {
      setScanError('This browser does not support in-page QR scanning. Type or paste the ticket code below — a USB scanner works too.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      detectorRef.current = detectorRef.current || new window.BarcodeDetector({ formats: ['qr_code'] });
      setScanning(true);

      const tick = async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 3 || !detectorRef.current) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        try {
          const codes = await detectorRef.current.detect(video);
          if (codes?.length) {
            const raw = codes[0].rawValue;
            stopScan();
            await submit(raw);
            return;
          }
        } catch {
          /* detection hiccup — keep scanning */
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      setScanError(
        error?.name === 'NotAllowedError'
          ? 'Camera permission was blocked. Enable it in your browser settings, or type the code below.'
          : 'The camera could not be started. Type or paste the code below instead.'
      );
    }
  };

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <Notice tone="brand" icon={<QrCode size={18} />} title="Sign in to verify tickets">
            Check-in is only available to the event organiser and platform administrators.
            <div className="row row--tight mt-3">
              <Link to="/login" className="btn btn--primary btn--sm">Sign in</Link>
            </div>
          </Notice>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1>Ticket check-in</h1>
            <p>
              Scan a QR code or type the ticket code. Each ticket can only be checked in once, and
              only for events you organise.
            </p>
          </div>
          <Link to="/tickets" className="btn btn--secondary">My tickets</Link>
        </div>

        <div className="verify-panel">
          {/* Scanner */}
          <div className="panel panel--pad">
            <div className="row row--between mb-4">
              <span className="eyebrow">Scanner</span>
              <span className="badge">
                {supported ? 'In-page scanning available' : 'Manual entry mode'}
              </span>
            </div>

            <div className="verify-camera">
              <video ref={videoRef} playsInline muted autoPlay aria-label="QR scanner preview" />
              {scanning && <div className="verify-camera__frame" aria-hidden="true" />}
              {!scanning && (
                <div
                  className="center"
                  style={{ position: 'absolute', inset: 0, background: 'rgba(8,8,8,0.75)', flexDirection: 'column', gap: 10 }}
                >
                  <ScanLine size={28} color="#fff" />
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 'var(--fs-sm)' }}>
                    Camera is off
                  </span>
                </div>
              )}
            </div>

            <div className="camera__controls mt-4">
              {scanning ? (
                <button className="btn btn--danger" onClick={stopScan}>
                  <CameraOff size={16} /> Stop scanning
                </button>
              ) : (
                <button className="btn btn--primary" onClick={startScan} disabled={!cameraSupported}>
                  <Camera size={16} /> Start camera
                </button>
              )}
            </div>

            {scanError && (
              <Notice tone="warn" icon={<CircleAlert size={18} />}>{scanError}</Notice>
            )}

            <p className="camera-note mt-3">
              Camera access is requested only when you start the scanner. Nothing is recorded or uploaded.
            </p>
          </div>

          {/* Manual entry */}
          <div className="panel panel--pad">
            <span className="eyebrow">Manual check-in</span>
            <form
              className="row mt-3"
              style={{ gap: 8, alignItems: 'stretch' }}
              onSubmit={(event) => {
                event.preventDefault();
                submit(code);
              }}
            >
              <span className="input-icon flex-1">
                <Keyboard size={16} />
                <input
                  ref={inputRef}
                  className="input mono"
                  placeholder="ET-XXXX-XXXX"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Ticket code"
                />
              </span>
              <button className="btn btn--primary" disabled={busy || !code.trim()}>
                {busy ? <Spinner /> : <Check size={16} />} Check in
              </button>
            </form>
            <p className="field__hint mt-2">
              A USB barcode scanner works here too — it types the code and presses enter.
            </p>
          </div>

          {/* Result */}
          {result && (
            <div
              className={`verify-result ${
                ['checked_in', 'valid'].includes(result.status)
                  ? 'is-ok'
                  : ['already_used', 'refunded', 'unpaid'].includes(result.status)
                    ? 'is-warn'
                    : 'is-bad'
              }`}
            >
              <span className="verify-result__icon">
                {['checked_in', 'valid'].includes(result.status)
                  ? <Check size={22} style={{ color: 'var(--ok)' }} />
                  : <X size={22} style={{ color: 'var(--danger)' }} />}
              </span>

              <div className="flex-1">
                <div className="row row--tight">
                  <strong>{result.message}</strong>
                  <StatusPill status={result.status === 'checked_in' ? 'valid' : result.status} />
                </div>

                {result.ticket && (
                  <div className="row mt-3" style={{ gap: 12 }}>
                    <Avatar user={result.ticket.holder} />
                    <div>
                      <div className="medium">{result.ticket.holder?.name}</div>
                      <div className="small muted">
                        {result.ticket.ticket_type} · <span className="mono">{result.ticket.code}</span>
                      </div>
                      <div className="small muted">{result.ticket.event?.title}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Session history */}
          {history.length > 0 && (
            <div className="panel panel--pad">
              <div className="row row--between mb-3">
                <span className="eyebrow"><History size={14} /> This session</span>
                <span className="small muted">{history.length} scans</span>
              </div>

              <div className="stack stack--sm">
                {history.map((entry, index) => (
                  <div className="row row--between" key={`${entry.at}-${index}`} style={{ gap: 12 }}>
                    <span className="row row--tight" style={{ minWidth: 0 }}>
                      <span className="badge">{entry.status.replace(/_/g, ' ')}</span>
                      <span className="truncate small">{entry.ticket?.holder?.name || entry.code}</span>
                    </span>
                    <span className="tiny dim nowrap">{timeAgo(entry.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
