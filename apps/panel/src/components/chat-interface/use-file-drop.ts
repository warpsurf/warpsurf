import { useState, useCallback, useRef, useEffect } from 'react';
import { ACCEPTED_MIME_TYPES } from '@extension/storage/lib/chat/types';

interface UseFileDropOptions {
  onFilesAdded: (files: File[]) => void;
  disabled?: boolean;
}

export function useFileDrop({ onFilesAdded, disabled }: UseFileDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const dropRef = useRef<HTMLElement>(null);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      dragCounter.current++;
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true);
      }
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      if (disabled || !e.dataTransfer?.files.length) return;

      const files = Array.from(e.dataTransfer.files).filter(f => ACCEPTED_MIME_TYPES.includes(f.type));
      if (files.length > 0) onFilesAdded(files);
    },
    [disabled, onFilesAdded],
  );

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    return () => {
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return { isDragging, dropRef };
}
