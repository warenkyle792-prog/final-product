import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Circle, RefreshCw, RotateCcw, Square, Upload, Video, X,
} from 'lucide-react';

import { Notice, Spinner } from './UI';

/**
 * Camera capture sheet.
 *
 * Camera permission is requested only when the visitor opens this component
 * (never on page load). Once open it supports still photos and, where the
 * browser allows it, short video clips via MediaRecorder. If the camera is
 * unavailable or blocked, the component degrades to a file picker instead of
 * trapping the user.
 *
 * Everything is laid out with width: 100% inside the sheet, so the live video
 * can never cause horizontal overflow — including in landscape on phones.
 */
export default function CameraCapture({ mode = 'photo', onCapture, onClose, maxVideoSeconds = 45 }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);

  const [status, setStatus] = useState('starting'); // starting | ready | error | recorded | recording
  const [error, setError] = useState('');
  const [facing, setFacing] = useState(mode === 'video' ? 'environment' : 'user');
  const [flash, setFlash] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [capture, setCapture] = useState(null); // { dataUrl?, blob?, kind }
  const [busy, setBusy] = useState(false);

  const stopStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setStatus('starting');
    setError('');

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('This browser cannot access the camera. You can upload a file instead.');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('error');
      setError('Camera access requires a secure (HTTPS) connection. Upload a file instead.');
      return;
    }

    stopStream();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: mode === 'video',
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission was blocked. Allow it in your browser settings, or upload a file instead.'
          : err?.name === 'NotFoundError'
            ? 'No camera was found on this device. Upload a file instead.'
            : 'The camera could not be started. Upload a file instead.'
      );
    }
  }, [facing, mode, stopStream]);

  useEffect(() => {
    startCamera();
    return () => stopStream();
    // Restart when the user flips the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;

    const maxWidth = 1600;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
    setCapture({ dataUrl, kind: 'photo' });
    setStatus('recorded');
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || !window.MediaRecorder) return;

    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      .find((type) => MediaRecorder.isTypeSupported?.(type)) || '';

    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        setCapture({ blob, url, kind: 'video' });
        setStatus('recorded');
      };

      recorder.start(250);
      setRecordingSeconds(0);
      setStatus('recording');
      timerRef.current = setInterval(() => {
        setRecordingSeconds((seconds) => {
          const next = seconds + 1;
          if (next >= maxVideoSeconds) stopRecording();
          return next;
        });
      }, 1000);
    } catch {
      setError('Video recording is not supported on this device. Take a photo instead.');
      setStatus('error');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const retake = () => {
    if (capture?.url) URL.revokeObjectURL(capture.url);
    setCapture(null);
    setRecordingSeconds(0);
    startCamera();
  };

  const confirm = async () => {
    if (!capture) return;
    setBusy(true);
    try {
      await onCapture(capture);
      stopStream();
      onClose?.();
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCapture({ file, url: URL.createObjectURL(file), kind: file.type.startsWith('video') ? 'video' : 'photo' });
    setStatus('recorded');
    stopStream();
  };

  const canRecordVideo = typeof window !== 'undefined'
    && Boolean(window.MediaRecorder)
    && Boolean(navigator.mediaDevices?.getUserMedia);

  return (
    <div className="camera">
      <div className="camera__stage">
        {status !== 'recorded' && (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label="Camera preview"
            style={flash ? { filter: 'brightness(2.4)' } : undefined}
          />
        )}

        {status === 'recorded' && capture?.url && capture.kind === 'video' && (
          <video src={capture.url} controls playsInline aria-label="Recorded clip preview" />
        )}

        {status === 'recorded' && capture?.dataUrl && (
          <img src={capture.dataUrl} alt="Captured preview" />
        )}

        {status === 'starting' && (
          <div className="center" style={{ position: 'absolute', inset: 0, background: 'rgba(8,8,8,0.72)' }}>
            <Spinner size="lg" label="Starting camera…" />
          </div>
        )}

        {status === 'recording' && (
          <span className="camera__timer">
            <i />
            {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
            {String(recordingSeconds % 60).padStart(2, '0')}
            <span style={{ opacity: 0.6 }}> / {maxVideoSeconds}s</span>
          </span>
        )}
      </div>

      {status === 'error' && (
        <Notice tone="warn" icon={<Camera size={18} />} title="Camera unavailable">
          {error}
        </Notice>
      )}

      <div className="camera__controls">
        {status === 'recorded' ? (
          <>
            <button className="btn btn--secondary" onClick={retake} disabled={busy}>
              <RotateCcw size={16} /> Retake
            </button>
            <button className="btn btn--primary" onClick={confirm} disabled={busy}>
              {busy ? <Spinner /> : <Camera size={16} />}
              Use {capture?.kind === 'video' ? 'video' : 'photo'}
            </button>
          </>
        ) : mode === 'video' ? (
          <>
            {status === 'recording' ? (
              <button className="btn btn--danger btn--lg" onClick={stopRecording}>
                <Square size={15} fill="currentColor" /> Stop recording
              </button>
            ) : (
              <button
                className="camera__shutter"
                onClick={startRecording}
                disabled={status !== 'ready' || !canRecordVideo}
              >
                <Video size={18} /> Start recording
              </button>
            )}
          </>
        ) : (
          <button className="camera__shutter" onClick={takePhoto} disabled={status !== 'ready'}>
            <Circle size={13} fill="currentColor" /> Take photo
          </button>
        )}

        {status !== 'recorded' && (
          <button
            className="icon-btn"
            onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
            aria-label="Switch camera"
            title="Switch between front and rear camera"
          >
            <RefreshCw size={18} />
          </button>
        )}

        {status === 'recorded' && (
          <button className="icon-btn" onClick={retake} aria-label="Discard capture">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="row row--between">
        <label className="btn btn--ghost btn--sm" style={{ cursor: 'pointer' }}>
          <Upload size={15} /> Upload instead
          <input
            type="file"
            accept={mode === 'video' ? 'video/*' : 'image/*'}
            capture={mode === 'video' ? 'environment' : undefined}
            onChange={pickFile}
            hidden
          />
        </label>

        <span className="camera-note">
          {mode === 'video'
            ? `Clips up to ${maxVideoSeconds}s · MP4 or WebM`
            : 'Photos are captured in-browser and uploaded by you'}
        </span>
      </div>
    </div>
  );
}
