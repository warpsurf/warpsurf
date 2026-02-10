import { useState, useRef, useCallback, useEffect } from 'react';
import type { MutableRefObject } from 'react';

export interface UseSpeechToTextOptions {
  portRef: MutableRefObject<chrome.runtime.Port | null>;
  setupConnection?: () => void;
  onTranscription: (text: string) => void;
  onError: (error: string) => void;
  maxDurationMs?: number;
}

export interface UseSpeechToTextReturn {
  isRecording: boolean;
  isProcessing: boolean;
  recordingDurationMs: number;
  audioLevel: number;
  showPermissionOverlay: boolean;
  permissionState: 'prompt' | 'denied' | 'waiting' | null;
  handleMicClick: () => void;
  dismissPermissionOverlay: () => void;
  openPermissionPopup: () => void;
  stopRecording: () => void;
  /** Call when a speech_to_text_result message is received from background */
  handleSttResult: (text: string) => void;
  /** Call when a speech_to_text_error message is received from background */
  handleSttError: (error: string) => void;
}

const MAX_DURATION_DEFAULT = 120_000;

export function useSpeechToText(opts: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const { portRef, setupConnection, onTranscription, onError, maxDurationMs = MAX_DURATION_DEFAULT } = opts;

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingDurationMs, setRecordingDurationMs] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showPermissionOverlay, setShowPermissionOverlay] = useState(false);
  const [permissionState, setPermissionState] = useState<'prompt' | 'denied' | 'waiting' | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stable refs for callbacks to avoid stale closures
  const onTranscriptionRef = useRef(onTranscription);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
  }, [onTranscription]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Handlers called by the consumer when port messages arrive (avoids stale port listener)
  const handleSttResult = useCallback((text: string) => {
    setIsProcessing(false);
    if (text) onTranscriptionRef.current(text);
  }, []);

  const handleSttError = useCallback((error: string) => {
    setIsProcessing(false);
    onErrorRef.current(error || 'Transcription failed');
  }, []);

  const stopTimers = useCallback(() => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {}
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
    setRecordingDurationMs(0);
  }, []);

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const sendAudioToBackground = useCallback(
    (audioBlob: Blob) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (!portRef.current) setupConnection?.();
        try {
          setIsProcessing(true);
          portRef.current?.postMessage({ type: 'speech_to_text', audio: reader.result });
        } catch {
          setIsProcessing(false);
          onErrorRef.current('Failed to send audio for transcription');
        }
      };
      reader.readAsDataURL(audioBlob);
    },
    [portRef, setupConnection],
  );

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        // Stop timers/visualisation but DON'T release stream yet — sendAudioToBackground
        // only needs the already-collected chunks (Blobs), not the live stream.
        stopTimers();
        releaseStream();
        if (audioChunksRef.current.length > 0) {
          sendAudioToBackground(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
        }
      };

      // Audio level analysis
      try {
        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          const rms = Math.sqrt(dataArray.reduce((s, v) => s + v * v, 0) / dataArray.length) / 255;
          setAudioLevel(rms);
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        updateLevel();
      } catch {} // Audio analysis is best-effort

      // Duration timer
      startTimeRef.current = Date.now();
      durationIntervalRef.current = window.setInterval(() => {
        setRecordingDurationMs(Date.now() - startTimeRef.current);
      }, 100);

      // Max duration safety
      recordingTimerRef.current = window.setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
      }, maxDurationMs);

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      stopTimers();
      releaseStream();
      onErrorRef.current('Failed to access microphone');
    }
  }, [stopTimers, releaseStream, sendAudioToBackground, maxDurationMs]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      // Set processing immediately to avoid UI flash between recording and processing states
      if (audioChunksRef.current.length > 0) setIsProcessing(true);
      mediaRecorderRef.current.stop(); // triggers onstop -> sendAudioToBackground
    }
    setIsRecording(false);
  }, []);

  const openPermissionPopup = useCallback(() => {
    setPermissionState('waiting');
    const permissionUrl = chrome.runtime.getURL('permission/index.html');
    chrome.windows.create({ url: permissionUrl, type: 'popup', width: 360, height: 240 }, win => {
      if (!win?.id) return;
      const onClose = (windowId: number) => {
        if (windowId !== win.id) return;
        chrome.windows.onRemoved.removeListener(onClose);
        setTimeout(async () => {
          try {
            const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            if (status.state === 'granted') {
              setShowPermissionOverlay(false);
              setPermissionState(null);
              startRecording();
            } else {
              setPermissionState(status.state === 'denied' ? 'denied' : 'prompt');
            }
          } catch {
            setPermissionState('prompt');
          }
        }, 500);
      };
      chrome.windows.onRemoved.addListener(onClose);
    });
  }, [startRecording]);

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    if (isProcessing) return;

    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      if (status.state === 'denied') {
        setPermissionState('denied');
        setShowPermissionOverlay(true);
        return;
      }
      if (status.state !== 'granted') {
        setPermissionState('prompt');
        setShowPermissionOverlay(true);
        return;
      }
      await startRecording();
    } catch {
      // Permissions API may not be available; try direct getUserMedia
      try {
        await startRecording();
      } catch {
        onErrorRef.current('Microphone access unavailable');
      }
    }
  }, [isRecording, isProcessing, stopRecording, startRecording]);

  const dismissPermissionOverlay = useCallback(() => {
    setShowPermissionOverlay(false);
    setPermissionState(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      stopTimers();
      releaseStream();
    };
  }, [stopTimers, releaseStream]);

  return {
    isRecording,
    isProcessing,
    recordingDurationMs,
    audioLevel,
    showPermissionOverlay,
    permissionState,
    handleMicClick,
    dismissPermissionOverlay,
    openPermissionPopup,
    stopRecording,
    handleSttResult,
    handleSttError,
  };
}
