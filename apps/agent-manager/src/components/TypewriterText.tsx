import { useState, useEffect, useRef } from 'react';

interface TypewriterTextProps {
  text: string;
  animate?: boolean;
  speed?: number;
  className?: string;
  onComplete?: () => void;
}

export function TypewriterText({ text, animate = false, speed = 30, className = '', onComplete }: TypewriterTextProps) {
  const [displayText, setDisplayText] = useState(animate ? '' : text);
  const [isAnimating, setIsAnimating] = useState(animate);
  const prevTextRef = useRef(text);

  useEffect(() => {
    if (!animate || text === prevTextRef.current) {
      setDisplayText(text);
      prevTextRef.current = text;
      return;
    }

    prevTextRef.current = text;
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
