import { useState, useEffect, useRef } from 'react';

interface TypewriterTextProps {
  text: string;
  animate?: boolean;
  speed?: number;
  className?: string;
  onComplete?: () => void;
}

export function TypewriterText({ text, animate = false, speed = 30, className = '', onComplete }: TypewriterTextProps) {
  const [displayText, setDisplayText] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const animatedTextRef = useRef<string | null>(null);

  useEffect(() => {
    // If not animating, just show the text immediately
    if (!animate) {
      setDisplayText(text);
      setIsAnimating(false);
      return;
    }

    // If we already animated this exact text, just show it (don't re-animate)
    if (animatedTextRef.current === text) {
      setDisplayText(text);
      return;
    }

    // Start typewriter animation
    animatedTextRef.current = text;
    setIsAnimating(true);
    setDisplayText('');

    let index = 0;
    const timer = setInterval(() => {
      if (index < text.length) {
        setDisplayText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(timer);
        setIsAnimating(false);
        onComplete?.();
      }
    }, speed);

    return () => clearInterval(timer);
  }, [text, animate, speed, onComplete]);

  return (
    <span className={className}>
      {displayText}
      {isAnimating && <span className="animate-pulse">|</span>}
    </span>
  );
}
