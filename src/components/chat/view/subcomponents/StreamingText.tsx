import { useEffect, useRef } from 'react';

import { attachStreamingTextNode, detachStreamingTextNode } from '../../utils/streamingTextBuffer';

interface StreamingTextProps {
  text: string;
  active: boolean;
}

export default function StreamingText({ text, active }: StreamingTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!active || !spanRef.current) {
      return undefined;
    }

    const node = spanRef.current;
    attachStreamingTextNode(node, text);

    return () => {
      detachStreamingTextNode(node);
    };
  }, [active, text]);

  if (!active) {
    return <span>{text}</span>;
  }

  return <span ref={spanRef} className="streaming-cursor">{text}</span>;
}
