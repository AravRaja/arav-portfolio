import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './ImageBoard.css';

export default function ImageBoard() {
  const [drawings, setDrawings] = useState([]);
  const [expandedImage, setExpandedImage] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDrawings = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/get-drawings');
      if (response.ok) {
        const data = await response.json();
        setDrawings(data.drawings.slice(0, 100)); // Limit for performance
      }
    } catch (error) {
      console.error('Error fetching drawings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleNewDrawing = () => {
      setTimeout(() => {
        fetchDrawings();
      }, 10);
    };
    window.addEventListener('newDrawingAdded', handleNewDrawing);
    return () => window.removeEventListener('newDrawingAdded', handleNewDrawing);
  }, [fetchDrawings]);

  useEffect(() => {
    fetchDrawings();
  }, [fetchDrawings]);

  return (
    <main className="image-board-page">
  
      <div className="drawings-grid-container">
        {isLoading ? (
          <div className="loading-spinner-container">
            <div className="loading-spinner"></div>
            <p>Loading Drawings...</p>
          </div>
        ) : (
          <div className="drawings-grid">
            {drawings.map((drawing, index) => (
              <div
                key={`${drawing.public_id}-${index}`}
                className="grid-drawing-wrapper"
                style={{
                  animationDelay: `${index * 0.05}s`,
                }}
              >
                <img
                  src={drawing.url}
                  alt="Drawing"
                  className="grid-drawing"
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
            ))}
          </div>
        )}
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
