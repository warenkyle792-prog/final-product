import { useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2, Upload, Video } from 'lucide-react';

import { Modal, Spinner } from './UI';
import CameraCapture from './CameraCapture';
import { api, assetUrl } from '../api/client';
import { useToast } from '../context/ToastContext';

/**
 * Media uploader for covers, avatars and event videos.
 *
 * Accepts drag & drop, a file picker, or a live camera capture. Camera
 * permission is only requested after the visitor chooses "Use camera".
 */
export default function MediaUploader({
  kind = 'cover',
  value = '',
  onChange,
  label = 'Cover image',
  hint = 'PNG, JPG or WEBP · up to 8 MB · 16:9 works best',
  allowCamera = true,
  allowVideoCapture = false,
  accept,
  previewAspect,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState('photo');
  const { toast } = useToast();

  const isVideo = kind === 'video';
  const resolvedAccept = accept || (isVideo ? 'video/mp4,video/webm,video/quicktime' : 'image/png,image/jpeg,image/webp,image/gif');

  const uploadFile = async (file) => {
    if (!file) return;

    const limitMb = isVideo ? 80 : 8;
    if (file.size > limitMb * 1024 * 1024) {
      toast(`That file is larger than ${limitMb} MB`, 'error');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await api.upload(`/uploads?kind=${kind}`, form);
      onChange(data.url);
      toast(isVideo ? 'Video uploaded' : 'Image uploaded', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleCapture = async (capture) => {
    if (capture.dataUrl) {
      // Stills are small enough to post as JSON — one round trip, no blobs.
      const data = await api.uploadData(`/uploads/data?kind=${kind === 'video' ? 'misc' : kind}`, capture.dataUrl);
      onChange(data.url);
      toast('Photo uploaded', 'success');
      return;
    }

    if (capture.blob) {
      const extension = capture.blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([capture.blob], `capture-${Date.now()}.${extension}`, { type: capture.blob.type });
      await uploadFile(file);
      return;
    }

    if (capture.file) await uploadFile(capture.file);
  };

  const clear = () => onChange('');

  return (
    <div className="field">
      <div className="field__label">
        <span>{label}</span>
        {value && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={clear} disabled={disabled}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>

      {value ? (
        <div className="media-preview" style={previewAspect ? { aspectRatio: previewAspect } : undefined}>
          {isVideo ? (
            <video src={assetUrl(value)} controls playsInline preload="metadata" />
          ) : (
            <img src={assetUrl(value)} alt="" />
          )}
          <div className="media-preview__bar">
            <span className="truncate" style={{ maxWidth: '60%' }}>{value.split('/').pop()}</span>
            <span className="media-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => inputRef.current?.click()} disabled={disabled}>
                <Upload size={14} /> Replace
              </button>
              {allowCamera && !isVideo && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setCameraMode('photo');
                    setCameraOpen(true);
                  }}
                  disabled={disabled}
                >
                  <Camera size={14} /> Camera
                </button>
              )}
            </span>
          </div>
        </div>
      ) : (
        <div
          className={`dropzone ${dragging ? 'is-drag' : ''}`}
          onClick={() => !disabled && inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
          aria-label={label}
        >
          {uploading ? (
            <Spinner size="lg" label="Uploading…" />
          ) : (
            <>
              {isVideo ? <Video size={26} /> : <ImagePlus size={26} />}
              <span>
                <strong>Drop a file here</strong> or click to browse
              </span>
              <small>{hint}</small>
              <div className="media-actions" onClick={(event) => event.stopPropagation()}>
                {allowCamera && (
                  <>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => {
                        setCameraMode('photo');
                        setCameraOpen(true);
                      }}
                      disabled={disabled}
                    >
                      <Camera size={14} /> Take a photo
                    </button>
                    {allowVideoCapture && (
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        onClick={() => {
                          setCameraMode('video');
                          setCameraOpen(true);
                        }}
                        disabled={disabled}
                      >
                        <Video size={14} /> Record video
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={resolvedAccept}
        hidden
        onChange={(event) => {
          uploadFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {hint && !value && !uploading && <p className="field__hint">{hint}</p>}

      <Modal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        title={cameraMode === 'video' ? 'Record a video' : 'Take a photo'}
        size="wide"
      >
        {cameraOpen && (
          <CameraCapture
            mode={cameraMode}
            onCapture={handleCapture}
            onClose={() => setCameraOpen(false)}
          />
        )}
      </Modal>
    </div>
  );
}
