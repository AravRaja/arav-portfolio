// Shared timing for the space hold so the deck animation, the space-bar fill and the
// music all agree on when the hold completes. The deck registers how long it still
// needs; the music player registers which bar boundary that should snap to.
export const holdSync = {
  speed: 1, // multiplier the deck applies to its up animation
  drainSpeed: 1, // ...and to its down animation
  songActive: false, // the dropped song is still playing (or fading out)
  openness: () => 0, // how open the low-pass is right now: 0 = muffled, 1 = fully open
  beatPhase: () => null, // 0..1 through the current beat of the intro loop (null when unknown)
  estimateRemaining: () => 3,
  estimateDrain: () => 3,
  pickDuration: (seconds) => seconds,
  pickDrain: (seconds) => seconds,
  // Called at the moment space goes down; returns the hold duration in seconds.
  plan() {
    const natural = this.estimateRemaining();
    const seconds = Math.max(0.05, this.pickDuration(natural));
    this.speed = natural > 0 ? natural / seconds : 1;
    return seconds;
  },
  // Called when the hold is let go (or ended after the drop); returns the drain duration.
  planDrain() {
    const natural = this.estimateDrain();
    const seconds = Math.max(0.05, this.pickDrain(natural));
    this.drainSpeed = natural > 0 ? natural / seconds : 1;
    return seconds;
  },
};
