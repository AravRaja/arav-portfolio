// The caption's contents (shared by the home page and the lab): the yellow [TAG], then the text with each ' · ' part
// kept whole, so a narrow phone wraps it at the dot rather than mid-phrase (the text content stays the exact string).
import React from 'react';

export default function CaptionText({ caption }) {
  const parts = caption.text.split(' · ');
  return (
    <>
      <span className="dancer-caption-tag">[{caption.tag}]</span>{' '}
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' '}
          <span className="dancer-caption-part">{i < parts.length - 1 ? `${p} ·` : p}</span>
        </React.Fragment>
      ))}
    </>
  );
}
