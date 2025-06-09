import React from 'react';
import './Welcome.css';

export default function Welcome() {
  return (
    <section className="welcome-container">
      <div className="welcome-left">
        <p className="intro-heading">
          COMPUTER SCIENTIST & MAKER<br />
          SPECIALISING IN ML & AUDIO TECH<br />
          WHERE ALGORITHMS MEET DESIGN
        </p>
      </div>

      <div className="welcome-right">
        <div className="label-block">[1st @ UNIVERSITY OF BRISTOL CS]</div>
        <div className="label-block">[BASED IN LONDON]</div>
        <div className="label-block">[AGE 20]</div>
      </div>
    </section>
  );
}