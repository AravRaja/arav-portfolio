import React, { useRef, useEffect, useState, useCallback } from 'react';
import './DrawingCanvas.css';

const DrawingCanvas = ({ onAlert }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState('pen');
  const [currentColor, setCurrentColor] = useState('#F0FF18'); // accent yellow
  const [brushSize, setBrushSize] = useState(3);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [hasDrawn, setHasDrawn] = useState(false);
  const [artistName, setArtistName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const baseImageRef = useRef(null);

  const colors = [
    { name: 'Yellow', value: '#F0FF18' },
    { name: 'Blue', value: '#0117d5' },
    { name: 'Pink', value: '#FF69B4' },
    { name: 'Grey', value: '#808080' }
  ];

  const brushSizes = [1, 3, 5, 8, 12];

  // Function to draw a custom base image from PNG file
  const drawBaseImage = (ctx, width, height) => {
    if (baseImageRef.current) {
      // Make the image subtle by reducing opacity
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.drawImage(baseImageRef.current, 0, 0, width, height);
      ctx.restore();
    }
  };



  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set canvas size
    canvas.width = 400;
    canvas.height = 300;
    
    // Fill with white background
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Load base image from public folder
    const img = new Image();
    img.src = '/canvas-base.png';
    img.onload = () => {
      baseImageRef.current = img;
      drawBaseImage(ctx, canvas.width, canvas.height);
    };
    img.onerror = () => {
      console.log('No base image found at /canvas-base.png');
    };

    // Set drawing properties
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

  }, []);

  const getMousePos = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }, []);

  const startDrawing = useCallback((e) => {
    if (!hasDrawn) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setHasDrawn(true);
    }

    setIsDrawing(true);
    const pos = getMousePos(e);
    setLastPos(pos);
  }, [getMousePos, hasDrawn]);

  const draw = useCallback((e) => {
    if (!isDrawing) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const currentPos = getMousePos(e);
    
    ctx.globalCompositeOperation = currentTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = currentTool === 'eraser' ? 'rgba(0,0,0,1)' : currentColor;
    ctx.lineWidth = brushSize;
    
    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.stroke();
    
    setLastPos(currentPos);
  }, [isDrawing, getMousePos, currentTool, currentColor, brushSize, lastPos]);

  const stopDrawing = useCallback(() => {
    setIsDrawing(false);
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  // Check if canvas is empty (only white pixels)
  const isCanvasEmpty = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Check if all pixels are white (255, 255, 255, 255)
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
        return false; // Found a non-white pixel
      }
    }
    return true;
  };

  const sendImage = async () => {
    // Check if canvas is empty
    if (isCanvasEmpty()) {
      if (onAlert) onAlert('Please draw something before sending!', 'error');
      return;
    }

    // Check if name is provided
    if (!artistName.trim()) {
      if (onAlert) onAlert('Please enter your name before sending!', 'error');
      return;
    }

    setIsSending(true);
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');

    try {
      const response = await fetch('/api/save-drawing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          imageData: dataUrl,
          artistName: artistName.trim() || 'Anon'
        }),
      });
      
      if (response.ok) {
        const result = await response.json();
        
        // Dispatch custom event to trigger drop animation in Contact.jsx
        window.dispatchEvent(new CustomEvent('newDrawingAdded', {
          detail: { 
            url: result.url,
            artistName: result.artistName || artistName.trim() || 'Anon',
            createdAt: result.createdAt
          }
        }));
        
        if (onAlert) onAlert('✓ Drawing sent successfully!', 'success', { to: '/imageboard', text: 'View Board' });
        clearCanvas();
      } else {
        if (onAlert) onAlert('✗ Failed to send drawing. Please try again.', 'error');
      }
    } catch (error) {
      console.error('Error sending drawing:', error);
      if (onAlert) onAlert('✗ Failed to send drawing. Please try again.', 'error');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="drawing-canvas-container">
      <div className="canvas-header">
        <span className="canvas-title">DRAW A MESSAGE</span>
        <input
          type="text"
          value={artistName}
          onChange={(e) => setArtistName(e.target.value.slice(0, 15))}
          placeholder="Enter your name"
          className="artist-name-input"
          maxLength="15"
          required
        />
      </div>
      
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
      />
      
      <div className="drawing-controls">
        <div className="tool-section">
          <div className="tool-buttons">
            <button
              className={`tool-btn ${currentTool === 'pen' ? 'active' : ''}`}
              onClick={() => setCurrentTool('pen')}
            >
              PEN
            </button>
            <button
              className={`tool-btn ${currentTool === 'eraser' ? 'active' : ''}`}
              onClick={() => setCurrentTool('eraser')}
            >
              ERASER
            </button>
          </div>
        </div>

        <div className="color-section">
          <div className="color-palette">
            {colors.map((color) => (
              <button
                key={color.name}
                className={`color-btn ${currentColor === color.value ? 'active' : ''}`}
                style={{ backgroundColor: color.value }}
                onClick={() => setCurrentColor(color.value)}
                title={color.name}
              />
            ))}
          </div>
        </div>

        <div className="size-section">
          <div className="size-buttons">
            {brushSizes.map((size) => (
              <button
                key={size}
                className={`size-btn ${brushSize === size ? 'active' : ''}`}
                onClick={() => setBrushSize(size)}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="action-section">
          <button 
            className="clear-btn"
            onClick={clearCanvas}
          >
            CLEAR
          </button>
          <button 
            className="send-btn"
            onClick={sendImage}
            disabled={isSending}
          >
            {isSending ? 'SENDING...' : 'SEND'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DrawingCanvas;
