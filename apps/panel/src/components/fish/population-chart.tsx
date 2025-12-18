import React, { useEffect, useRef, useState } from 'react';
import type { FishOverlayHandle } from './fish-overlay';

interface PopulationChartProps {
  fishRef: React.RefObject<FishOverlayHandle | null>;
  isDarkMode: boolean;
  onBack: () => void;
}

const PopulationChart: React.FC<PopulationChartProps> = ({ fishRef, isDarkMode, onBack }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [samples, setSamples] = useState<Array<{ tMs: number; fish: number; sharks: number; food: number }>>([]);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    // Update samples periodically
    const updateSamples = () => {
      if (fishRef.current) {
        const newSamples = fishRef.current.getPopulationSamples();
        setSamples(newSamples);
      }
    };

    updateSamples();
    const interval = setInterval(updateSamples, 1000);

    return () => {
      clearInterval(interval);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [fishRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas size
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      // Clear canvas
      ctx.clearRect(0, 0, rect.width, rect.height);

      if (samples.length < 2) {
        // Show message when no data
        ctx.fillStyle = isDarkMode ? '#9ca3af' : '#6b7280';
        ctx.font = '14px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No population data yet. Add some fish and sharks!', rect.width / 2, rect.height / 2);
        return;
      }

      // Calculate bounds
      const padding = 60;
      const graphWidth = rect.width - padding * 2;
      const graphHeight = rect.height - padding * 2;
      const graphLeft = padding;
      const graphTop = padding;

      // Find max values for scaling
      const maxTime = Math.max(...samples.map(s => s.tMs));
      const maxCount = Math.max(
        ...samples.map(s => Math.max(s.fish, s.sharks, s.food))
      );

      // Draw grid
      ctx.strokeStyle = isDarkMode ? '#374151' : '#e5e7eb';
      ctx.lineWidth = 1;
      
      // Horizontal grid lines
      for (let i = 0; i <= 5; i++) {
        const y = graphTop + (graphHeight * i) / 5;
        ctx.beginPath();
        ctx.moveTo(graphLeft, y);
        ctx.lineTo(graphLeft + graphWidth, y);
        ctx.stroke();
        
        // Y-axis labels
        const value = Math.round(maxCount * (1 - i / 5));
        ctx.fillStyle = isDarkMode ? '#9ca3af' : '#6b7280';
        ctx.font = '12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(value.toString(), graphLeft - 10, y + 4);
      }

      // Vertical grid lines (time)
      for (let i = 0; i <= 6; i++) {
        const x = graphLeft + (graphWidth * i) / 6;
        ctx.beginPath();
        ctx.moveTo(x, graphTop);
        ctx.lineTo(x, graphTop + graphHeight);
        ctx.stroke();
        
        // X-axis labels (time in minutes)
        const minutes = Math.round((maxTime * i) / 6 / 60000);
        ctx.fillStyle = isDarkMode ? '#9ca3af' : '#6b7280';
        ctx.textAlign = 'center';
        ctx.fillText(`${minutes}m`, x, graphTop + graphHeight + 20);
      }

      // Draw axes
      ctx.strokeStyle = isDarkMode ? '#6b7280' : '#374151';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(graphLeft, graphTop);
      ctx.lineTo(graphLeft, graphTop + graphHeight);
      ctx.lineTo(graphLeft + graphWidth, graphTop + graphHeight);
      ctx.stroke();

      // Draw lines
      const drawLine = (
        data: number[],
        color: string,
        label: string,
        yOffset: number
      ) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        samples.forEach((sample, i) => {
          const x = graphLeft + (sample.tMs / maxTime) * graphWidth;
          const y = graphTop + graphHeight - (data[i] / maxCount) * graphHeight;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        
        ctx.stroke();
        
        // Draw label
        ctx.fillStyle = color;
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, graphLeft + graphWidth + 10, graphTop + yOffset);
      };

      // Draw the lines
      drawLine(samples.map(s => s.fish), '#3b82f6', 'Fish', 20);
      drawLine(samples.map(s => s.sharks), '#ef4444', 'Sharks', 40);
      drawLine(samples.map(s => s.food), '#eab308', 'Food', 60);

      // Draw title
      ctx.fillStyle = isDarkMode ? '#f3f4f6' : '#111827';
      ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Predator-Prey Population Dynamics', rect.width / 2, 30);

      // Draw axis labels
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = isDarkMode ? '#d1d5db' : '#4b5563';
      
      // Y-axis label
      ctx.save();
      ctx.translate(20, graphTop + graphHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('Population Count', 0, 0);
      ctx.restore();
      
      // X-axis label
      ctx.textAlign = 'center';
      ctx.fillText('Time (minutes)', graphLeft + graphWidth / 2, rect.height - 10);
    };

    const animate = () => {
      draw();
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [samples, isDarkMode]);

  return (
    <div className="flex flex-col h-full">
      <div className={`flex items-center justify-between p-4 border-b ${isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'}`}>
        <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
          Population Dynamics
        </h2>
        <button
          onClick={onBack}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            isDarkMode 
              ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' 
              : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
          }`}
        >
          Back to Chat
        </button>
      </div>
      
      <div className="flex-1 p-4">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ minHeight: '400px' }}
        />
      </div>
      
      <div className={`p-4 border-t ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
        <div className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
          <p className="mb-2">
            <strong>Tips:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Fish (blue) eat food pellets to survive</li>
            <li>Sharks (red) hunt and eat fish</li>
            <li>Food (yellow) spawns automatically when creatures are present</li>
            <li>Sharks must eat every minute or they die</li>
            <li>Both species breed when close together (3-minute cooldown)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default PopulationChart;
