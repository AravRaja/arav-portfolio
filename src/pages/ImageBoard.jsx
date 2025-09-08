import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './ImageBoard.css';

export default function ImageBoard() {
  const [floatingDrawings, setFloatingDrawings] = useState([]);
  const [expandedImage, setExpandedImage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const findSmartPositionWithThreshold = useCallback((existingDrawings, drawingSize = 150, minDistance) => {
    const padding = 0; // 30px for top, left, right
    const bottomPadding = 0; // Extra padding for the bottom
    const headerHeight = 0; // Increased to account for the new title
    const maxAttempts = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = Math.random() * (window.innerWidth - drawingSize - 2 * padding) + padding;
      const y = Math.random() * (window.innerHeight - drawingSize - headerHeight - padding - bottomPadding) + headerHeight;

      if (x < padding || x + drawingSize > window.innerWidth - padding) continue;
      if (y < headerHeight + padding || y + drawingSize > window.innerHeight - bottomPadding) continue;

      let hasCollision = false;
      for (const existing of existingDrawings) {
        const centerDistance = Math.sqrt(
          Math.pow((x + drawingSize / 2) - (existing.x + drawingSize / 2), 2) +
          Math.pow((y + drawingSize / 2) - (existing.y + drawingSize / 2), 2)
        );

        const textWidth = 120;
        const textHeight = 25;
        const newTextLeft = x + 5;
        const newTextRight = x + 5 + textWidth;
        const newTextTop = y + drawingSize - 5 - textHeight;
        const newTextBottom = y + drawingSize - 5;
        const existingTextLeft = existing.x + 5;
        const existingTextRight = existing.x + 5 + textWidth;
        const existingTextTop = existing.y + drawingSize - 5 - textHeight;
        const existingTextBottom = existing.y + drawingSize - 5;

        const textOverlap = !(
          newTextRight < existingTextLeft ||
          newTextLeft > existingTextRight ||
          newTextBottom < existingTextTop ||
          newTextTop > existingTextBottom
        );

        if (centerDistance < minDistance || textOverlap) {
          hasCollision = true;
          break;
        }
      }

      if (!hasCollision) {
        return { x, y };
      }
    }
    return null;
  }, []);

  const fetchFloatingDrawings = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/get-drawings');
      if (response.ok) {
        const data = await response.json();
        const drawingsWithPositions = [];
        const drawingSize = 150;
        const limitedDrawings = data.drawings.slice(0, 1000);
        const distanceThresholds = [drawingSize * 1.5, drawingSize * 1.3, drawingSize * 1, drawingSize * 0.8,drawingSize * 0.3];
        let currentThresholdIndex = 0;
        let drawingIndex = 0;

        while (drawingIndex < limitedDrawings.length && currentThresholdIndex < distanceThresholds.length) {
          const drawing = limitedDrawings[drawingIndex];
          const position = findSmartPositionWithThreshold(drawingsWithPositions, drawingSize, distanceThresholds[currentThresholdIndex]);

          if (position) {
            drawingsWithPositions.push({
              ...drawing,
              x: position.x,
              y: position.y,
              rotation: 0,
              scale: 1,
            });
            drawingIndex++;
          } else {
            currentThresholdIndex++;
          }
        }
        setFloatingDrawings(drawingsWithPositions);
      }
    } catch (error) {
      console.error('Error fetching drawings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [findSmartPositionWithThreshold]);

  useEffect(() => {
    const handleNewDrawing = () => {
      setTimeout(() => {
        fetchFloatingDrawings();
      }, 10);
    };
    window.addEventListener('newDrawingAdded', handleNewDrawing);
    return () => window.removeEventListener('newDrawingAdded', handleNewDrawing);
  }, [fetchFloatingDrawings]);

  useEffect(() => {
    fetchFloatingDrawings();
  }, [fetchFloatingDrawings]);

  return (
    <main className="image-board-page">
  
      <div className="floating-drawings-container">
        {isLoading ? (
          <div className="loading-spinner-container">
            <div className="loading-spinner"></div>
            <p>Loading Drawings...</p>
          </div>
        ) : (
          floatingDrawings.map((drawing, index) => (
          <div
            key={`${drawing.public_id}-${index}`}
            className="floating-drawing-wrapper"
            style={{
              left: `${drawing.x}px`,
              top: `${drawing.y}px`,
              animationDelay: `${index * 0.5}s`,
            }}
          >
            <img
              src={drawing.url}
              alt="Floating drawing"
              className="floating-drawing"
              style={{ transform: `scale(${drawing.scale})` }}
              onClick={() => setExpandedImage(drawing)}
            />
            <div className="drawing-name-overlay">
              <div className="artist-name">
                {(() => {
                  const name = drawing.artistName || 'Anony';
                  const formatted = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
                  const truncated = formatted.length > 6 ? formatted.substring(0, 4) + '..' : formatted;
                  return (
                    <>
                      {truncated} @
                      {new Date(drawing.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: '2-digit' })}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )))}
      </div>

      {expandedImage && (
        <div className="image-modal-overlay" onClick={() => setExpandedImage(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-button" onClick={() => setExpandedImage(null)}>×</button>
            <img src={expandedImage.url} alt="Expanded drawing" className="expanded-image" />
            <div className="expanded-info">
              <div className="expanded-artist-name">
                {(expandedImage.artistName || 'anon').toLowerCase()} @ {new Date(expandedImage.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
